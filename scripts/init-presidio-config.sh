#!/bin/bash
# Initialize Presidio configuration on shared volume
# This script copies the default config to the shared volume on first startup

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

CONFIG_DIR="/app/config"
CONFIG_FILE="$CONFIG_DIR/redaction_config.yaml"
SOURCE_CONFIG="/app/presidio-sidecar/redaction_config.yaml"

echo "Initializing Presidio shared volume configuration..."

# Create config directory if it doesn't exist
if [ ! -d "$CONFIG_DIR" ]; then
    echo "Creating config directory: $CONFIG_DIR"
    mkdir -p "$CONFIG_DIR"
fi

# Copy default config if it doesn't exist
if [ ! -f "$CONFIG_FILE" ]; then
    if [ -f "$SOURCE_CONFIG" ]; then
        echo "Copying default config from $SOURCE_CONFIG to $CONFIG_FILE"
        cp "$SOURCE_CONFIG" "$CONFIG_FILE"
        echo "Default config copied successfully"
    else
        echo "Warning: Source config not found at $SOURCE_CONFIG"
        echo "Creating minimal default config..."
        cat > "$CONFIG_FILE" << 'EOF'
# Presidio Redaction Configuration
# Default rules for PII detection

rules:
  - entity: "EMAIL_REGEX"
    pattern: "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b"
    description: "Email address pattern"
  - entity: "PHONE_US"
    pattern: "\\(?(\\d{3})\\)?[\\s-]?\\d{3}[\\s-]?\\d{4}"
    description: "US phone number pattern"
  - entity: "CREDIT_CARD"
    pattern: "\\b(?:\\d[ -]*?){13,16}\\b"
    description: "Credit card number pattern"
  - entity: "SSN"
    pattern: "\\b\\d{3}-\\d{2}-\\d{4}\\b"
    description: "Social Security Number pattern"
  - entity: "IP_ADDRESS"
    pattern: "\\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\b"
    description: "IPv4 address pattern"
EOF
        echo "Default config created"
    fi
else
    echo "Config file already exists at $CONFIG_FILE"
fi

# Set permissions
chmod 644 "$CONFIG_FILE"

echo "Presidio configuration initialized successfully"
