/**
 * YAML Validation Utilities for Presidio Configuration
 *
 * Provides validation functions for Presidio redaction config YAML files
 */

import * as yaml from "js-yaml";

/**
 * Validates YAML syntax and structure for Presidio configuration
 *
 * @param {string} yamlContent - The YAML content to validate
 * @returns {{ valid: boolean, error?: string, parsed?: any }}
 */
export function validateYamlSyntax(yamlContent) {
  try {
    // Parse YAML
    const parsed = yaml.load(yamlContent);

    // Check if parsed is null or undefined
    if (!parsed) {
      return {
        valid: false,
        error: "YAML content is empty or invalid",
      };
    }

    // Check if it's an object (not array, string, etc.)
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        valid: false,
        error: "YAML root must be an object with a 'rules' array",
      };
    }

    // Check for required 'rules' array
    if (!parsed.rules || !Array.isArray(parsed.rules)) {
      return {
        valid: false,
        error: "Missing required 'rules' array in YAML configuration",
      };
    }

    // Validate each rule
    for (let i = 0; i < parsed.rules.length; i++) {
      const rule = parsed.rules[i];
      const ruleErrors = validateRule(rule, i);

      if (ruleErrors.length > 0) {
        return {
          valid: false,
          error: ruleErrors.join("; "),
        };
      }
    }

    // Check for duplicate entity names
    const entityNames = parsed.rules.map((r) => r.entity);
    const duplicates = entityNames.filter((name, index) => entityNames.indexOf(name) !== index);

    if (duplicates.length > 0) {
      return {
        valid: false,
        error: `Duplicate entity names found: ${[...new Set(duplicates)].join(", ")}`,
      };
    }

    return {
      valid: true,
      parsed,
    };
  } catch (error) {
    return {
      valid: false,
      error: `YAML parse error: ${error.message}`,
    };
  }
}

/**
 * Validates a single rule object
 *
 * @param {object} rule - The rule to validate
 * @param {number} index - The rule index for error messages
 * @returns {string[]} Array of error messages (empty if valid)
 */
function validateRule(rule, index) {
  const errors = [];

  if (!rule) {
    errors.push(`Rule at index ${index} is null or undefined`);
    return errors;
  }

  // Check required fields
  if (!rule.entity || typeof rule.entity !== "string" || rule.entity.trim() === "") {
    errors.push(`Rule at index ${index}: missing or invalid 'entity' field`);
  }

  if (!rule.pattern || typeof rule.pattern !== "string" || rule.pattern.trim() === "") {
    errors.push(`Rule at index ${index}: missing or invalid 'pattern' field`);
  } else {
    // Validate regex syntax
    try {
      new RegExp(rule.pattern);
    } catch (error) {
      errors.push(`Rule at index ${index}: invalid regex pattern '${rule.pattern}' - ${error.message}`);
    }
  }

  if (!rule.description || typeof rule.description !== "string" || rule.description.trim() === "") {
    errors.push(`Rule at index ${index}: missing or invalid 'description' field`);
  }

  return errors;
}

/**
 * Validates YAML content without detailed errors (for quick checks)
 *
 * @param {string} yamlContent - The YAML content to validate
 * @returns {boolean} True if valid, false otherwise
 */
export function isValidYaml(yamlContent) {
  return validateYamlSyntax(yamlContent).valid;
}

/**
 * Extracts rule patterns from YAML content
 *
 * @param {string} yamlContent - The YAML content to parse
 * @returns {{ entity: string, pattern: string, description: string }[]} Array of rules
 */
export function extractRules(yamlContent) {
  const validation = validateYamlSyntax(yamlContent);

  if (!validation.valid) {
    return [];
  }

  return validation.parsed.rules.map((rule) => ({
    entity: rule.entity,
    pattern: rule.pattern,
    description: rule.description,
  }));
}
