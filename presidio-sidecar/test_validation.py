#!/usr/bin/env python3
"""
Validation script to check test structure without running full tests.
This can be run without installing all Presidio dependencies.
"""

import ast
import sys


def validate_file_syntax(filepath):
    """Validate Python file syntax."""
    try:
        with open(filepath, 'r') as f:
            code = f.read()
        ast.parse(code)
        print(f"✓ {filepath}: Syntax valid")
        return True
    except SyntaxError as e:
        print(f"✗ {filepath}: Syntax error - {e}")
        return False


def check_test_functions(filepath):
    """Check for proper test function definitions."""
    with open(filepath, 'r') as f:
        code = f.read()

    tree = ast.parse(code)
    test_functions = []

    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name.startswith('test_'):
            test_functions.append(node.name)

    print(f"\n✓ Found {len(test_functions)} test functions in {filepath}:")
    for func in sorted(test_functions):
        print(f"  - {func}")

    return len(test_functions) > 0


def check_config_file(filepath):
    """Validate YAML config file."""
    try:
        import yaml
        with open(filepath, 'r') as f:
            config = yaml.safe_load(f)

        if 'rules' in config:
            print(f"\n✓ {filepath}: Valid YAML with {len(config['rules'])} rules")
            for rule in config['rules']:
                entity = rule.get('entity', 'MISSING')
                pattern = rule.get('pattern', 'MISSING')
                print(f"  - {entity}: {pattern[:50]}...")
            return True
        else:
            print(f"✗ {filepath}: Missing 'rules' key")
            return False
    except ImportError:
        print(f"⚠ {filepath}: PyYAML not installed, skipping YAML validation")
        return True
    except Exception as e:
        print(f"✗ {filepath}: {e}")
        return False


def main():
    """Run all validations."""
    print("=" * 60)
    print("Presidio Sidecar Test Validation")
    print("=" * 60)

    files_to_check = [
        'sidecar.py',
        'tests/test_sidecar.py',
    ]

    all_valid = True

    # Check syntax
    print("\n[1] Syntax Validation")
    print("-" * 40)
    for filepath in files_to_check:
        if not validate_file_syntax(filepath):
            all_valid = False

    # Check test functions
    print("\n[2] Test Structure")
    print("-" * 40)
    if not check_test_functions('tests/test_sidecar.py'):
        all_valid = False

    # Check config file
    print("\n[3] Configuration File")
    print("-" * 40)
    if not check_config_file('redaction_config.yaml'):
        all_valid = False

    # Summary
    print("\n" + "=" * 60)
    if all_valid:
        print("✓ All validations passed!")
        print("\nNote: Full test execution requires:")
        print("  - pip install -r requirements.txt")
        print("  - pytest")
        print("=" * 60)
        return 0
    else:
        print("✗ Some validations failed")
        print("=" * 60)
        return 1


if __name__ == '__main__':
    sys.exit(main())
