"""
Unit tests for Presidio hot-reload functionality

Tests cover:
- File watcher event detection
- Debouncing logic
- Pattern validation
- Atomic analyzer swapping
- Error handling
- Concurrent reload handling
"""

import pytest
import yaml
import time
import threading
from unittest.mock import Mock, patch, MagicMock
from pathlib import Path
from watchdog.events import FileModifiedEvent

# Import from sidecar module (will be created in next task)
# For now, we'll mock the functions we're testing


class TestPatternValidator:
    """Tests for pattern validation logic"""

    def test_valid_yaml_with_rules(self):
        """Should validate YAML with valid rules"""
        config_yaml = """
rules:
  - entity: "EMAIL_REGEX"
    pattern: "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b"
    description: "Email pattern"
  - entity: "PHONE_US"
    pattern: "\\(?(\\d{3})\\)?[\\s-]?\\d{3}[\\s-]?\\d{4}"
    description: "Phone pattern"
"""
        result = validate_config(config_yaml)
        assert result["valid"] is True
        assert result["pattern_count"] == 2

    def test_invalid_yaml_syntax(self):
        """Should reject invalid YAML syntax"""
        config_yaml = """
rules:
  - entity: "EMAIL_REGEX"
    pattern: "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b"
    description: "Email pattern"
    invalid: [unclosed array
"""
        result = validate_config(config_yaml)
        assert result["valid"] is False
        assert "syntax" in result["error"].lower()

    def test_missing_rules_array(self):
        """Should reject YAML without rules array"""
        config_yaml = """
config:
  someSetting: value
"""
        result = validate_config(config_yaml)
        assert result["valid"] is False
        assert "rules" in result["error"].lower()

    def test_missing_rule_fields(self):
        """Should reject rules with missing required fields"""
        config_yaml = """
rules:
  - entity: "EMAIL_REGEX"
    pattern: "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b"
"""
        result = validate_config(config_yaml)
        assert result["valid"] is False
        assert "description" in result["error"].lower()

    def test_invalid_regex_pattern(self):
        """Should reject rules with invalid regex"""
        config_yaml = """
rules:
  - entity: "INVALID_REGEX"
    pattern: "[invalid(regex"
    description: "Invalid pattern"
"""
        result = validate_config(config_yaml)
        assert result["valid"] is False
        assert "regex" in result["error"].lower()

    def test_duplicate_entity_names(self):
        """Should reject duplicate entity names"""
        config_yaml = """
rules:
  - entity: "EMAIL_REGEX"
    pattern: "\\S+@\\S+"
    description: "First pattern"
  - entity: "EMAIL_REGEX"
    pattern: "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b"
    description: "Second pattern"
"""
        result = validate_config(config_yaml)
        assert result["valid"] is False
        assert "duplicate" in result["error"].lower()

    def test_empty_rules_array(self):
        """Should accept empty rules array (no custom patterns)"""
        config_yaml = """
rules: []
"""
        result = validate_config(config_yaml)
        assert result["valid"] is True
        assert result["pattern_count"] == 0


class TestFileWatcher:
    """Tests for file watcher functionality"""

    @patch('watchdog.observers.Observer')
    def test_file_watcher_initialization(self, mock_observer):
        """Should initialize file watcher with correct path"""
        config_path = "/app/config/redaction_config.yaml"
        watcher = FileWatcher(config_path)
        
        assert mock_observer.called
        assert watcher.config_path == config_path

    def test_file_modified_event_triggers_reload(self):
        """File modified event should trigger reload"""
        watcher = FileWatcher("/test/config.yaml")
        reload_triggered = []
        
        def on_reload():
            reload_triggered.append(True)
        
        watcher.on_reload = on_reload
        
        event = FileModifiedEvent("/test/config.yaml")
        watcher.on_modified(event)
        
        # Wait for debounce
        time.sleep(0.6)
        
        assert len(reload_triggered) == 1

    def test_debouncing_rapid_changes(self):
        """Should debounce rapid file changes"""
        watcher = FileWatcher("/test/config.yaml")
        reload_count = []
        
        def on_reload():
            reload_count.append(1)
        
        watcher.on_reload = on_reload
        
        # Simulate rapid changes
        for _ in range(5):
            event = FileModifiedEvent("/test/config.yaml")
            watcher.on_modified(event)
            time.sleep(0.05)
        
        # Wait for debounce
        time.sleep(0.6)
        
        # Should only trigger once
        assert len(reload_count) == 1

    def test_ignore_temp_files(self):
        """Should ignore temp file events"""
        watcher = FileWatcher("/test/config.yaml")
        reload_triggered = []
        
        def on_reload():
            reload_triggered.append(True)
        
        watcher.on_reload = on_reload
        
        event = FileModifiedEvent("/test/config.yaml.tmp")
        watcher.on_modified(event)
        
        time.sleep(0.6)
        
        assert len(reload_triggered) == 0

    def test_ignore_non_config_files(self):
        """Should ignore events for other files"""
        watcher = FileWatcher("/test/config.yaml")
        reload_triggered = []
        
        def on_reload():
            reload_triggered.append(True)
        
        watcher.on_reload = on_reload
        
        event = FileModifiedEvent("/test/other_file.txt")
        watcher.on_modified(event)
        
        time.sleep(0.6)
        
        assert len(reload_triggered) == 0


class TestAtomicSwap:
    """Tests for atomic analyzer swapping"""

    def test_analyzer_swap_is_atomic(self):
        """Analyzer swap should be atomic under concurrent access"""
        global_analyzer = Mock()
        new_analyzer = Mock()
        swap_lock = threading.Lock()
        results = []
        
        def swap_analyzer(new):
            nonlocal global_analyzer
            with swap_lock:
                global_analyzer = new
        
        def read_analyzer():
            return global_analyzer
        
        # Simulate concurrent access
        def worker():
            for _ in range(100):
                analyzer = read_analyzer()
                results.append(analyzer is new_analyzer)
                time.sleep(0.0001)
        
        threads = [threading.Thread(target=worker) for _ in range(10)]
        
        # Start threads
        for t in threads:
            t.start()
        
        # Swap in middle of operations
        time.sleep(0.05)
        swap_analyzer(new_analyzer)
        
        # Wait for completion
        for t in threads:
            t.join()
        
        # After swap, all reads should get new analyzer
        assert all(results) or not any(results)  # All old or all new

    def test_old_analyzer_remains_accessible_in_flight(self):
        """Old analyzer should remain accessible to in-flight requests"""
        old_analyzer = Mock(name="old")
        new_analyzer = Mock(name="new")
        global_analyzer = old_analyzer
        swap_lock = threading.Lock()
        
        in_flight_accessed = []
        
        def in_flight_request():
            time.sleep(0.1)  # Simulate processing
            accessed = global_analyzer
            in_flight_accessed.append(accessed)
        
        def swap_analyzer(new):
            nonlocal global_analyzer
            with swap_lock:
                global_analyzer = new
        
        # Start in-flight request
        t = threading.Thread(target=in_flight_request)
        t.start()
        
        # Swap after short delay
        time.sleep(0.05)
        swap_analyzer(new_analyzer)
        
        # Wait for completion
        t.join()
        
        # In-flight request should have accessed old analyzer
        assert in_flight_accessed[0] == old_analyzer


class TestReloadOrchestrator:
    """Tests for reload orchestration"""

    @patch('builtins.open', new_callable=MagicMock)
    @patch('yaml.safe_load')
    def test_successful_reload(self, mock_yaml_load, mock_open):
        """Successful reload should create new analyzer and swap"""
        mock_yaml_load.return_value = {
            "rules": [
                {
                    "entity": "EMAIL_REGEX",
                    "pattern": "\\S+@\\S+",
                    "description": "Email"
                }
            ]
        }
        
        orchestrator = ReloadOrchestrator("/test/config.yaml")
        result = orchestrator.reload()
        
        assert result["success"] is True
        assert result["pattern_count"] == 1
        assert orchestrator.current_analyzer is not None

    @patch('builtins.open', new_callable=MagicMock, side_effect=FileNotFoundError)
    def test_file_not_found_error(self, mock_open):
        """File not found should keep old analyzer active"""
        orchestrator = ReloadOrchestrator("/test/config.yaml")
        old_analyzer = orchestrator.current_analyzer
        
        result = orchestrator.reload()
        
        assert result["success"] is False
        assert orchestrator.current_analyzer == old_analyzer
        assert "not found" in result["error"].lower()

    @patch('builtins.open', new_callable=MagicMock)
    @patch('yaml.safe_load', side_effect=yaml.YAMLError("Invalid YAML"))
    def test_yaml_parse_error(self, mock_yaml_load, mock_open):
        """YAML parse error should keep old analyzer active"""
        orchestrator = ReloadOrchestrator("/test/config.yaml")
        old_analyzer = orchestrator.current_analyzer
        
        result = orchestrator.reload()
        
        assert result["success"] is False
        assert orchestrator.current_analyzer == old_analyzer
        assert "yaml" in result["error"].lower()

    def test_concurrent_reload_requests(self):
        """Concurrent reload requests should be serialized"""
        orchestrator = ReloadOrchestrator("/test/config.yaml")
        reload_count = []
        
        def mock_reload():
            reload_count.append(1)
            time.sleep(0.1)
            return {"success": True}
        
        orchestrator.reload = mock_reload
        
        def trigger_reload():
            orchestrator.trigger_reload()
        
        # Trigger multiple concurrent reloads
        threads = [threading.Thread(target=trigger_reload) for _ in range(5)]
        
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        
        # Should only execute once (serialized)
        assert len(reload_count) == 1


class TestReloadStatus:
    """Tests for reload status endpoint"""

    def test_status_returns_current_state(self):
        """Status endpoint should return current reload state"""
        orchestrator = ReloadOrchestrator("/test/config.yaml")
        
        status = orchestrator.get_status()
        
        assert "status" in status
        assert "last_reload_at" in status
        assert "pattern_count" in status
        assert "last_reload_success" in status

    def test_status_after_successful_reload(self):
        """Status should reflect successful reload"""
        orchestrator = ReloadOrchestrator("/test/config.yaml")
        
        # Mock successful reload
        with patch.object(orchestrator, 'reload', return_value={"success": True, "pattern_count": 5}):
            orchestrator.trigger_reload()
            time.sleep(0.2)  # Wait for async completion
        
        status = orchestrator.get_status()
        
        assert status["status"] == "idle"
        assert status["last_reload_success"] is True
        assert status["pattern_count"] == 5

    def test_status_after_failed_reload(self):
        """Status should reflect failed reload"""
        orchestrator = ReloadOrchestrator("/test/config.yaml")
        
        # Mock failed reload
        with patch.object(orchestrator, 'reload', return_value={"success": False, "error": "Test error"}):
            orchestrator.trigger_reload()
            time.sleep(0.2)
        
        status = orchestrator.get_status()
        
        assert status["status"] == "idle"
        assert status["last_reload_success"] is False
        assert "error" in status["last_reload_error"]


# Mock implementations for testing (will be replaced with real implementation)

def validate_config(config_yaml):
    """Mock validator - to be replaced with real implementation"""
    try:
        config = yaml.safe_load(config_yaml)
    except yaml.YAMLError as e:
        return {"valid": False, "error": f"YAML syntax error: {str(e)}"}
    
    if not config or not isinstance(config, dict):
        return {"valid": False, "error": "Invalid config structure"}
    
    if "rules" not in config or not isinstance(config["rules"], list):
        return {"valid": False, "error": "Missing or invalid rules array"}
    
    entities = []
    for i, rule in enumerate(config["rules"]):
        if not isinstance(rule, dict):
            return {"valid": False, "error": f"Rule {i} is not a dictionary"}
        
        if "entity" not in rule or not rule["entity"]:
            return {"valid": False, "error": f"Rule {i} missing entity"}
        
        if "pattern" not in rule or not rule["pattern"]:
            return {"valid": False, "error": f"Rule {i} missing pattern"}
        
        if "description" not in rule or not rule["description"]:
            return {"valid": False, "error": f"Rule {i} missing description"}
        
        # Validate regex
        try:
            import re
            re.compile(rule["pattern"])
        except re.error as e:
            return {"valid": False, "error": f"Rule {i} has invalid regex: {str(e)}"}
        
        # Check duplicates
        if rule["entity"] in entities:
            return {"valid": False, "error": f"Duplicate entity: {rule['entity']}"}
        entities.append(rule["entity"])
    
    return {"valid": True, "pattern_count": len(config["rules"])}


class FileWatcher:
    """Mock file watcher - to be replaced with real implementation"""
    
    def __init__(self, config_path):
        self.config_path = config_path
        self.on_reload = None
        self._debounce_timer = None
    
    def on_modified(self, event):
        if not event.is_directory:
            # Check if it's the config file
            if event.src_path == self.config_path and not event.src_path.endswith('.tmp'):
                self._debounce_reload()
    
    def _debounce_reload(self):
        if self._debounce_timer:
            self._debounce_timer.cancel()
        
        import threading
        self._debounce_timer = threading.Timer(0.5, self._trigger_reload)
        self._debounce_timer.start()
    
    def _trigger_reload(self):
        if self.on_reload:
            self.on_reload()


class ReloadOrchestrator:
    """Mock reload orchestrator - to be replaced with real implementation"""
    
    def __init__(self, config_path):
        self.config_path = config_path
        self.current_analyzer = Mock()
        self.last_reload_time = None
        self.last_reload_success = True
        self.last_reload_error = None
        self._reload_lock = threading.Lock()
        self.pattern_count = 0
    
    def reload(self):
        """Reload configuration - mock implementation"""
        # This is a mock - real implementation will:
        # 1. Read config file
        # 2. Validate config
        # 3. Create new analyzer
        # 4. Load patterns
        # 5. Atomic swap
        
        # For testing, just return success
        import yaml
        try:
            with open(self.config_path, 'r') as f:
                config = yaml.safe_load(f)
            
            validation = validate_config(yaml.dump(config))
            if not validation["valid"]:
                return {"success": False, "error": validation["error"]}
            
            self.pattern_count = validation["pattern_count"]
            self.last_reload_time = time.time()
            self.last_reload_success = True
            self.last_reload_error = None
            
            return {"success": True, "pattern_count": self.pattern_count}
        except Exception as e:
            self.last_reload_success = False
            self.last_reload_error = str(e)
            return {"success": False, "error": str(e)}
    
    def trigger_reload(self):
        """Trigger reload (thread-safe)"""
        with self._reload_lock:
            return self.reload()
    
    def get_status(self):
        """Get current reload status"""
        import datetime
        return {
            "status": "idle",
            "last_reload_at": self.last_reload_time,
            "last_reload_success": self.last_reload_success,
            "last_reload_error": self.last_reload_error,
            "pattern_count": self.pattern_count,
        }


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
