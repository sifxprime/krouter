"""
Unit tests for Presidio Sidecar

Tests cover:
- Custom regex pattern loading and matching
- ML-based PII detection
- Empty/invalid input handling
- Batch processing order preservation
- API endpoints
"""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
import yaml
import os
import tempfile

# Import the app and functions
from sidecar import app, load_custom_rules

client = TestClient(app)


class TestCustomRegexRules:
    """Test custom regex rule loading and matching."""

    def test_load_custom_rules_from_valid_config(self):
        """Test that custom rules are loaded from a valid config file."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            config = {
                "rules": [
                    {"entity": "TEST_ENTITY", "pattern": "TEST-[0-9]+"}
                ]
            }
            yaml.dump(config, f)
            config_path = f.name

        try:
            # Mock the config file path
            with patch('builtins.open', open(config_path)):
                entities = load_custom_rules()
                assert "TEST_ENTITY" in entities
        finally:
            os.unlink(config_path)

    def test_load_custom_rules_missing_file(self):
        """Test handling of missing config file."""
        with patch('builtins.open', side_effect=FileNotFoundError):
            entities = load_custom_rules()
            assert entities == []

    def test_load_custom_rules_invalid_yaml(self):
        """Test handling of invalid YAML in config."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            f.write("invalid: yaml: content:\n  - broken")
            config_path = f.name

        try:
            with patch('builtins.open', open(config_path)):
                entities = load_custom_rules()
                assert entities == []
        finally:
            os.unlink(config_path)

    def test_load_custom_rules_skip_invalid_entries(self):
        """Test that invalid rule entries are skipped."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            config = {
                "rules": [
                    {"entity": "VALID_RULE", "pattern": "valid-[0-9]+"},
                    {"entity": "NO_PATTERN"},  # Missing pattern
                    {"pattern": "no-entity-[0-9]+"},  # Missing entity
                    {"entity": "VALID_RULE_2", "pattern": "valid2-[A-Z]+"}
                ]
            }
            yaml.dump(config, f)
            config_path = f.name

        try:
            with patch('builtins.open', open(config_path)):
                entities = load_custom_rules()
                assert "VALID_RULE" in entities
                assert "VALID_RULE_2" in entities
                assert len(entities) == 2  # Only valid rules loaded
        finally:
            os.unlink(config_path)


class TestRedactEndpoint:
    """Test the /redact endpoint."""

    def test_redact_single_text_with_pii(self):
        """Test redaction of a single text containing PII."""
        # We need to mock the analyzer and anonymizer since they're not initialized in tests
        with patch('sidecar.analyzer') as mock_analyzer, \
             patch('sidecar.anonymizer') as mock_anonymizer:

            # Mock analysis results
            mock_analysis = MagicMock()
            mock_analysis.text = "My email is john@example.com"
            mock_analysis.start = 13
            mock_analysis.end = 29
            mock_analysis.entity_type = "EMAIL"

            mock_analyzer.analyze.return_value = [mock_analysis]

            # Mock anonymization result
            mock_result = MagicMock()
            mock_result.text = "My email is <EMAIL>"
            mock_anonymizer.anonymize.return_value = mock_result

            response = client.post("/redact", json={"texts": ["My email is john@example.com"]})

            assert response.status_code == 200
            data = response.json()
            assert "redacted_texts" in data
            assert len(data["redacted_texts"]) == 1
            assert data["redacted_texts"][0] == "My email is <EMAIL>"

    def test_redact_multiple_texts(self):
        """Test redaction of multiple texts in one request."""
        with patch('sidecar.analyzer') as mock_analyzer, \
             patch('sidecar.anonymizer') as mock_anonymizer:

            # Set up mocks for first text
            mock_result1 = MagicMock()
            mock_result1.text = "Hello <NAME>"

            # Set up mocks for second text
            mock_result2 = MagicMock()
            mock_result2.text = "Call me at <PHONE_NUMBER>"

            mock_anonymizer.anonymize.side_effect = [mock_result1, mock_result2]

            response = client.post(
                "/redact",
                json={
                    "texts": [
                        "Hello John Doe",
                        "Call me at 555-123-4567"
                    ]
                }
            )

            assert response.status_code == 200
            data = response.json()
            assert len(data["redacted_texts"]) == 2
            assert data["redacted_texts"][0] == "Hello <NAME>"
            assert data["redacted_texts"][1] == "Call me at <PHONE_NUMBER>"

    def test_redact_empty_text(self):
        """Test that empty texts are handled gracefully."""
        with patch('sidecar.analyzer') as mock_analyzer:
            response = client.post("/redact", json={"texts": ["", "not empty", ""]})

            assert response.status_code == 200
            data = response.json()
            assert data["redacted_texts"][0] == ""
            assert data["redacted_texts"][2] == ""
            # Analyzer should only be called for non-empty text
            assert mock_analyzer.analyze.call_count == 1

    def test_redact_preserves_order(self):
        """Test that redacted texts maintain the same order as input."""
        with patch('sidecar.analyzer') as mock_analyzer, \
             patch('sidecar.anonymizer') as mock_anonymizer:

            # Create distinct results for each input
            mock_results = [
                MagicMock(text=f"Redacted {i}")
                for i in range(5)
            ]
            mock_anonymizer.anonymize.side_effect = mock_results

            input_texts = [f"Text {i}" for i in range(5)]

            response = client.post("/redact", json={"texts": input_texts})

            assert response.status_code == 200
            data = response.json()
            assert len(data["redacted_texts"]) == 5

            for i in range(5):
                assert data["redacted_texts"][i] == f"Redacted {i}"

    def test_redact_empty_list(self):
        """Test handling of empty text list."""
        response = client.post("/redact", json={"texts": []})

        assert response.status_code == 200
        data = response.json()
        assert data["redacted_texts"] == []

    def test_redact_invalid_request_body(self):
        """Test handling of invalid request body."""
        response = client.post("/redact", json={"invalid": "data"})

        assert response.status_code == 422  # Validation error


class TestHealthEndpoints:
    """Test health check endpoints."""

    def test_root_endpoint(self):
        """Test the root endpoint returns service info."""
        response = client.get("/")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["service"] == "presidio-sidecar"

    def test_health_endpoint(self):
        """Test the health check endpoint."""
        response = client.get("/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"


class TestRegexPatternMatching:
    """Test specific regex pattern matching when real analyzer is available."""

    @pytest.mark.integration
    def test_openai_key_pattern(self):
        """Test that OPENAI_KEY pattern is detected."""
        # This test requires a real analyzer with loaded config
        pytest.skip("Integration test - requires real Presidio setup")

    @pytest.mark.integration
    def test_credit_card_pattern(self):
        """Test that CREDIT_CARD pattern is detected."""
        pytest.skip("Integration test - requires real Presidio setup")

    @pytest.mark.integration
    def test_email_detection(self):
        """Test ML-based email detection."""
        pytest.skip("Integration test - requires real Presidio setup")


class TestErrorHandling:
    """Test error handling in edge cases."""

    def test_analyzer_failure_fails_gracefully(self):
        """Test that analyzer failures are handled."""
        with patch('sidecar.analyzer') as mock_analyzer:
            mock_analyzer.analyze.side_effect = Exception("Analyzer error")

            response = client.post("/redact", json={"texts": ["Test text"]})

            # Should return 500 on internal error
            assert response.status_code == 500

    def test_anonymizer_failure_fails_gracefully(self):
        """Test that anonymizer failures are handled."""
        with patch('sidecar.analyzer') as mock_analyzer, \
             patch('sidecar.anonymizer') as mock_anonymizer:

            mock_analyzer.analyze.return_value = []
            mock_anonymizer.anonymize.side_effect = Exception("Anonymizer error")

            response = client.post("/redact", json={"texts": ["Test text"]})

            # Should return 500 on internal error
            assert response.status_code == 500
