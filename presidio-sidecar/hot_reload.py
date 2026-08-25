"""
Hot-reload functionality for Presidio sidecar

Implements file watching, configuration validation, and atomic analyzer swapping
to enable zero-downtime configuration updates.
"""

import os
import time
import threading
import yaml
import hashlib
from typing import Optional, Dict, Any
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileModifiedEvent
from presidio_analyzer import AnalyzerEngine, PatternRecognizer, Pattern

# Configuration
CONFIG_PATH = os.environ.get("PRESIDIO_CONFIG_PATH", "/app/config/redaction_config.yaml")
HOT_RELOAD_ENABLED = os.environ.get("PRESIDIO_HOT_RELOAD_ENABLED", "true").lower() == "true"
RELOAD_DEBOUNCE_MS = int(os.environ.get("PRESIDIO_RELOAD_DEBOUNCE_MS", "500"))


class ConfigValidator:
    """Validates Presidio configuration YAML"""
    
    @staticmethod
    def validate(config_yaml: str) -> Dict[str, Any]:
        """
        Validate YAML configuration
        
        Args:
            config_yaml: YAML content as string
            
        Returns:
            Dict with 'valid' (bool) and optional 'error' (str)
        """
        try:
            config = yaml.safe_load(config_yaml)
        except yaml.YAMLError as e:
            return {
                "valid": False,
                "error": f"YAML parse error: {str(e)}"
            }
        
        # Check structure
        if not config or not isinstance(config, dict):
            return {
                "valid": False,
                "error": "YAML root must be an object"
            }
        
        if "rules" not in config or not isinstance(config["rules"], list):
            return {
                "valid": False,
                "error": "Missing required 'rules' array"
            }
        
        # Validate each rule
        entities = []
        for i, rule in enumerate(config["rules"]):
            if not isinstance(rule, dict):
                return {
                    "valid": False,
                    "error": f"Rule at index {i} is not a dictionary"
                }
            
            # Check required fields
            if not rule.get("entity"):
                return {
                    "valid": False,
                    "error": f"Rule at index {i} missing 'entity' field"
                }
            
            if not rule.get("pattern"):
                return {
                    "valid": False,
                    "error": f"Rule at index {i} missing 'pattern' field"
                }
            
            if not rule.get("description"):
                return {
                    "valid": False,
                    "error": f"Rule at index {i} missing 'description' field"
                }
            
            # Validate regex pattern
            import re
            try:
                re.compile(rule["pattern"])
            except re.error as e:
                return {
                    "valid": False,
                    "error": f"Rule at index {i} has invalid regex pattern: {str(e)}"
                }
            
            # Check for duplicate entities
            entity = rule["entity"]
            if entity in entities:
                return {
                    "valid": False,
                    "error": f"Duplicate entity name: {entity}"
                }
            entities.append(entity)
        
        return {
            "valid": True,
            "pattern_count": len(config["rules"]),
            "entities": entities
        }
    
    @staticmethod
    def load_and_validate(config_path: str) -> Dict[str, Any]:
        """
        Load and validate configuration from file
        
        Args:
            config_path: Path to configuration file
            
        Returns:
            Dict with 'valid', 'config', and optional 'error'
        """
        try:
            with open(config_path, 'r') as f:
                config_yaml = f.read()
        except FileNotFoundError:
            return {
                "valid": False,
                "error": f"Configuration file not found: {config_path}"
            }
        except IOError as e:
            return {
                "valid": False,
                "error": f"Failed to read configuration: {str(e)}"
            }
        
        validation = ConfigValidator.validate(config_yaml)
        if not validation["valid"]:
            return validation
        
        config = yaml.safe_load(config_yaml)
        return {
            "valid": True,
            "config": config,
            "pattern_count": validation["pattern_count"],
            "entities": validation["entities"]
        }


class ConfigFileHandler(FileSystemEventHandler):
    """File system event handler for configuration file changes"""
    
    def __init__(self, config_path: str, on_reload_callback):
        """
        Initialize file handler
        
        Args:
            config_path: Path to configuration file
            on_reload_callback: Callback function to trigger reload
        """
        self.config_path = config_path
        self.on_reload_callback = on_reload_callback
        self._debounce_timer: Optional[threading.Timer] = None
        self._lock = threading.Lock()
    
    def on_modified(self, event):
        """Handle file modified events"""
        if event.is_directory:
            return
        
        # Check if it's the config file
        if event.src_path != self.config_path:
            return
        
        # Ignore temp files
        if event.src_path.endswith('.tmp'):
            return
        
        # Debounce the reload
        with self._lock:
            if self._debounce_timer:
                self._debounce_timer.cancel()
            
            self._debounce_timer = threading.Timer(
                RELOAD_DEBOUNCE_MS / 1000.0,
                self._trigger_reload
            )
            self._debounce_timer.start()
    
    def _trigger_reload(self):
        """Trigger the reload callback"""
        if self.on_reload_callback:
            try:
                self.on_reload_callback()
            except Exception as e:
                print(f"Error in reload callback: {e}")


class ReloadOrchestrator:
    """Orchestrates the hot-reload process"""
    
    def __init__(self, config_path: str):
        """
        Initialize reload orchestrator
        
        Args:
            config_path: Path to configuration file
        """
        self.config_path = config_path
        self.current_analyzer: Optional[AnalyzerEngine] = None
        self._analyzer_lock = threading.Lock()
        self._reload_lock = threading.Lock()
        
        # Status tracking
        self.last_reload_time: Optional[float] = None
        self.last_reload_success: bool = True
        self.last_reload_error: Optional[str] = None
        self.current_pattern_count: int = 0
        self.current_entities: list = []
        self.current_config_hash: Optional[str] = None
        
        # Watcher
        self.observer: Optional[Observer] = None
    
    def get_config_hash(self, config_yaml: str) -> str:
        """Calculate hash of configuration for comparison"""
        return hashlib.sha256(config_yaml.encode()).hexdigest()
    
    def create_analyzer_with_config(self, config: dict) -> AnalyzerEngine:
        """
        Create a new analyzer engine with the given configuration
        
        Args:
            config: Validated configuration dict
            
        Returns:
            Configured AnalyzerEngine instance
        """
        analyzer = AnalyzerEngine()
        
        # Load custom regex patterns
        for rule in config.get("rules", []):
            entity = rule.get("entity")
            pattern = rule.get("pattern")
            
            if entity and pattern:
                pattern_obj = Pattern(
                    name=f"{entity}_pattern",
                    regex=pattern,
                    score=1.0
                )
                recognizer = PatternRecognizer(
                    supported_entity=entity,
                    patterns=[pattern_obj]
                )
                analyzer.registry.add_recognizer(recognizer)
        
        return analyzer
    
    def reload(self) -> Dict[str, Any]:
        """
        Perform a configuration reload
        
        Returns:
            Dict with 'success' (bool), optional 'error', and metadata
        """
        # Check if already reloading
        if not self._reload_lock.acquire(blocking=False):
            return {
                "success": False,
                "error": "Reload already in progress"
            }
        
        try:
            print(f"Starting configuration reload from {self.config_path}")
            
            # Load and validate configuration
            result = ConfigValidator.load_and_validate(self.config_path)
            
            if not result["valid"]:
                error_msg = result.get("error", "Unknown validation error")
                print(f"Configuration validation failed: {error_msg}")
                self.last_reload_success = False
                self.last_reload_error = error_msg
                return {
                    "success": False,
                    "error": error_msg
                }
            
            config = result["config"]
            config_yaml = yaml.dump(config)
            config_hash = self.get_config_hash(config_yaml)
            
            # Check if config actually changed
            if self.current_config_hash == config_hash:
                print("Configuration unchanged, skipping reload")
                return {
                    "success": True,
                    "message": "Configuration unchanged",
                    "pattern_count": self.current_pattern_count
                }
            
            print(f"Creating new analyzer with {result['pattern_count']} patterns")
            
            # Create new analyzer with new config
            new_analyzer = self.create_analyzer_with_config(config)
            
            # Atomic swap
            with self._analyzer_lock:
                old_analyzer = self.current_analyzer
                self.current_analyzer = new_analyzer
            
            # Update status
            self.last_reload_time = time.time()
            self.last_reload_success = True
            self.last_reload_error = None
            self.current_pattern_count = result["pattern_count"]
            self.current_entities = result.get("entities", [])
            self.current_config_hash = config_hash
            
            print(f"Configuration reload successful: {result['pattern_count']} patterns loaded")
            
            return {
                "success": True,
                "pattern_count": result["pattern_count"],
                "entities": result["entities"],
                "config_hash": config_hash
            }
        
        except Exception as e:
            error_msg = f"Reload failed: {str(e)}"
            print(f"ERROR: {error_msg}")
            self.last_reload_success = False
            self.last_reload_error = error_msg
            return {
                "success": False,
                "error": error_msg
            }
        finally:
            self._reload_lock.release()
    
    def get_analyzer(self) -> Optional[AnalyzerEngine]:
        """
        Get the current analyzer instance (thread-safe)
        
        Returns:
            Current AnalyzerEngine instance or None
        """
        with self._analyzer_lock:
            return self.current_analyzer
    
    def get_status(self) -> Dict[str, Any]:
        """
        Get current reload status
        
        Returns:
            Dict with status information
        """
        import datetime
        
        last_reload_str = None
        if self.last_reload_time:
            last_reload_str = datetime.datetime.fromtimestamp(self.last_reload_time).isoformat()
        
        return {
            # locked() inspects without taking the lock. The original used
            # acquire(blocking=False), which returns True when the lock is FREE
            # -- and having acquired it, never released it. One status call
            # therefore held _reload_lock forever and every subsequent reload
            # bailed at the acquire() in reload_config(), silently killing
            # hot-reload for the life of the process.
            "status": "reloading" if self._reload_lock.locked() else "idle",
            "last_reload_at": last_reload_str,
            "last_reload_success": self.last_reload_success,
            "last_reload_error": self.last_reload_error,
            "config_hash": self.current_config_hash,
            "pattern_count": self.current_pattern_count,
            "entities": self.current_entities,
            "analyzer_loaded": self.current_analyzer is not None
        }
    
    def start_watching(self):
        """Start watching the configuration file for changes"""
        if not HOT_RELOAD_ENABLED:
            print("Hot-reload disabled via PRESIDIO_HOT_RELOAD_ENABLED")
            return
        
        if self.observer:
            print("File watcher already running")
            return
        
        # Ensure config directory exists
        config_dir = os.path.dirname(self.config_path)
        if config_dir and not os.path.exists(config_dir):
            print(f"Creating config directory: {config_dir}")
            os.makedirs(config_dir, exist_ok=True)
        
        # Create observer
        event_handler = ConfigFileHandler(self.config_path, self._trigger_reload)
        self.observer = Observer()
        
        # Watch the config directory
        if config_dir:
            self.observer.schedule(event_handler, config_dir, recursive=False)
            self.observer.start()
            print(f"File watcher started for: {self.config_path}")
        else:
            print("Warning: Could not determine config directory, not starting file watcher")
    
    def stop_watching(self):
        """Stop watching the configuration file"""
        if self.observer:
            self.observer.stop()
            self.observer.join()
            self.observer = None
            print("File watcher stopped")
    
    def _trigger_reload(self):
        """Trigger a reload (called by file watcher)"""
        # Run reload in background thread
        thread = threading.Thread(target=self.reload, daemon=True)
        thread.start()
    
    def set_initial_analyzer(self, analyzer: AnalyzerEngine):
        """
        Set the initial analyzer (called at startup)
        
        Args:
            analyzer: Initial AnalyzerEngine instance
        """
        with self._analyzer_lock:
            self.current_analyzer = analyzer
        print("Initial analyzer set")


# Global orchestrator instance
_orchestrator: Optional[ReloadOrchestrator] = None


def get_orchestrator() -> ReloadOrchestrator:
    """Get or create the global reload orchestrator"""
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = ReloadOrchestrator(CONFIG_PATH)
    return _orchestrator


def get_current_analyzer() -> Optional[AnalyzerEngine]:
    """
    Get the current analyzer instance
    
    Returns:
        Current AnalyzerEngine or None
    """
    orchestrator = get_orchestrator()
    return orchestrator.get_analyzer()
