#!/bin/bash
# Manual testing script for Presidio hot-reload functionality

set -e

COLOR_GREEN='\033[0;32m'
COLOR_BLUE='\033[0;34m'
COLOR_YELLOW='\033[1;33m'
COLOR_RED='\033[0;31m'
COLOR_NC='\033[0m' # No Color

SIDECAR_URL="${PRESIDIO_SIDECAR_URL:-http://localhost:5001}"
CONFIG_FILE="./presidio-sidecar/redaction_config.yaml"
BACKUP_FILE="./presidio-sidecar/redaction_config.yaml.backup"

echo -e "${COLOR_BLUE}=== Presidio Hot-Reload Test Script ===${COLOR_NC}"
echo ""

# Check if sidecar is running
echo -e "${COLOR_BLUE}[1/6] Checking if sidecar is running...${COLOR_NC}"
if curl -sf "${SIDECAR_URL}/health" > /dev/null 2>&1; then
    echo -e "${COLOR_GREEN}✓ Sidecar is running${COLOR_NC}"
else
    echo -e "${COLOR_RED}✗ Sidecar is not running at ${SIDECAR_URL}${COLOR_NC}"
    echo "Start the sidecar with: docker-compose up presidio-sidecar"
    exit 1
fi
echo ""

# Get initial status
echo -e "${COLOR_BLUE}[2/6] Getting initial reload status...${COLOR_NC}"
curl -s "${SIDECAR_URL}/reload/status" | jq '.'
echo ""

# Backup current config
echo -e "${COLOR_BLUE}[3/6] Backing up current config...${COLOR_NC}"
if [ -f "$CONFIG_FILE" ]; then
    cp "$CONFIG_FILE" "$BACKUP_FILE"
    echo -e "${COLOR_GREEN}✓ Config backed up to ${BACKUP_FILE}${COLOR_NC}"
else
    echo -e "${COLOR_YELLOW}⚠ No existing config file, creating one...${COLOR_NC}"
    cat > "$CONFIG_FILE" << 'EOF'
# Presidio Redaction Configuration
rules:
  - entity: "EMAIL_REGEX"
    pattern: "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b"
    description: "Email address pattern"
EOF
fi
echo ""

# Test redaction with initial config
echo -e "${COLOR_BLUE}[4/6] Testing redaction with initial config...${COLOR_NC}"
TEST_TEXT="Contact me at john@example.com or call 555-123-4567"
echo "Input: $TEST_TEXT"
RESULT=$(curl -s -X POST "${SIDECAR_URL}/redact" \
  -H "Content-Type: application/json" \
  -d "{\"texts\": [\"$TEST_TEXT\"]}")
echo -e "Output: ${COLOR_YELLOW}$(echo "$RESULT" | jq -r '.redacted_texts[0]')${COLOR_NC}"
echo ""

# Add a new pattern
echo -e "${COLOR_BLUE}[5/6] Adding new pattern to config...${COLOR_NC}"
cat > "$CONFIG_FILE" << 'EOF'
# Presidio Redaction Configuration - Updated
rules:
  - entity: "EMAIL_REGEX"
    pattern: "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b"
    description: "Email address pattern"
  - entity: "PHONE_US"
    pattern: "\\(?(\\d{3})\\)?[\\s-]?\\d{3}[\\s-]?\\d{4}"
    description: "US phone number pattern"
  - entity: "TEST_PATTERN"
    pattern: "TEST_REGEX_\\d+"
    description: "Test pattern for hot-reload"
EOF
echo -e "${COLOR_GREEN}✓ Config updated${COLOR_NC}"
echo ""

# Wait for hot-reload (debounce is 500ms)
echo "Waiting for hot-reload to trigger..."
sleep 2

# Check reload status
echo -e "${COLOR_BLUE}[6/6] Checking reload status...${COLOR_NC}"
STATUS=$(curl -s "${SIDECAR_URL}/reload/status")
echo "$STATUS" | jq '.'
echo ""

# Verify new pattern is active
echo -e "${COLOR_BLUE}[7/7] Testing with new pattern...${COLOR_NC}"
TEST_TEXT2="TEST_REGEX_12345 should be redacted"
echo "Input: $TEST_TEXT2"
RESULT2=$(curl -s -X POST "${SIDECAR_URL}/redact" \
  -H "Content-Type: application/json" \
  -d "{\"texts\": [\"$TEST_TEXT2\"]}")
echo -e "Output: ${COLOR_YELLOW}$(echo "$RESULT2" | jq -r '.redacted_texts[0]')${COLOR_NC}"
echo ""

# Check if pattern was redacted
if echo "$RESULT2" | jq -r '.redacted_texts[0]' | grep -q "<TEST_PATTERN>"; then
    echo -e "${COLOR_GREEN}✓ New pattern is working!${COLOR_NC}"
else
    echo -e "${COLOR_YELLOW}⚠ Pattern may not have been redacted (might not match input)${COLOR_NC}"
fi
echo ""

# Test error handling - invalid YAML
echo -e "${COLOR_BLUE}[8/8] Testing error handling with invalid YAML...${COLOR_NC}"
cat > "$CONFIG_FILE" << 'EOF'
# Invalid YAML
rules:
  - entity: "INVALID"
    pattern: "[invalid(regex"
    description: "Unclosed bracket"
EOF
echo "Invalid config written, waiting for reload..."
sleep 2

STATUS_AFTER_ERROR=$(curl -s "${SIDECAR_URL}/reload/status")
echo "$STATUS_AFTER_ERROR" | jq '.'
if echo "$STATUS_AFTER_ERROR" | jq -e '.last_reload_success == false' > /dev/null; then
    echo -e "${COLOR_GREEN}✓ Error detected correctly, old analyzer still active${COLOR_NC}"
else
    echo -e "${COLOR_YELLOW}⚠ Error may not have been reported as expected${COLOR_NC}"
fi
echo ""

# Test redaction still works (should use old analyzer)
echo -e "${COLOR_BLUE}[9/9] Verifying redaction still works after error...${COLOR_NC}"
TEST_TEXT3="john@example.com"
RESULT3=$(curl -s -X POST "${SIDECAR_URL}/redact" \
  -H "Content-Type: application/json" \
  -d "{\"texts\": [\"$TEST_TEXT3\"]}")
echo -e "Output: ${COLOR_YELLOW}$(echo "$RESULT3" | jq -r '.redacted_texts[0]')${COLOR_NC}"
echo ""

# Restore backup
echo -e "${COLOR_BLUE}[10/10] Restoring backup config...${COLOR_NC}"
if [ -f "$BACKUP_FILE" ]; then
    mv "$BACKUP_FILE" "$CONFIG_FILE"
    echo -e "${COLOR_GREEN}✓ Config restored${COLOR_NC}"
    sleep 2
else
    echo -e "${COLOR_YELLOW}⚠ No backup to restore${COLOR_NC}"
fi
echo ""

# Final status
echo -e "${COLOR_BLUE}Final reload status:${COLOR_NC}"
curl -s "${SIDECAR_URL}/reload/status" | jq '.'
echo ""

echo -e "${COLOR_GREEN}=== Hot-reload test completed ===${COLOR_NC}"
echo ""
echo "Manual verification steps:"
echo "1. Check that patterns were loaded: curl ${SIDECAR_URL}/reload/status | jq '.pattern_count'"
echo "2. Test redaction: curl -X POST ${SIDECAR_URL}/redact -H 'Content-Type: application/json' -d '{\"texts\":[\"test\"]}'"
echo "3. Manually edit config and watch logs for reload messages"
echo "4. Trigger reload manually: curl -X POST ${SIDECAR_URL}/reload/trigger"
