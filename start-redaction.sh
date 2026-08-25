#!/bin/bash
# Start both Presidio sidecar and kRouter with redaction enabled

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
KROUTER_PORT=20128
SIDECAR_PORT=5001
MAX_WAIT=60
WAIT_INTERVAL=2

echo -e "${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  kRouter + Presidio Redaction Startup Script              ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Error: Docker is not installed or not in PATH${NC}"
    echo "Please install Docker first: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if docker compose is available
if ! command -v docker &> /dev/null || ! docker compose version &> /dev/null; then
    echo -e "${RED}✗ Error: Docker Compose is not available${NC}"
    echo "Please install Docker Compose first"
    exit 1
fi

echo -e "${BLUE}Step 1: Building and starting services...${NC}"
echo "─────────────────────────────────────────────────────"
docker-compose up -d --build

echo ""
echo -e "${BLUE}Step 2: Waiting for services to be healthy...${NC}"
echo "─────────────────────────────────────────────────────"

# Function to check service health
wait_for_service() {
    local url=$1
    local name=$2
    local elapsed=0

    echo -n "  Waiting for $name to be ready..."

    while [ $elapsed -lt $MAX_WAIT ]; do
        if curl -s -f "$url/health" > /dev/null 2>&1; then
            echo -e " ${GREEN}✓${NC}"
            return 0
        fi
        echo -n "."
        sleep $WAIT_INTERVAL
        elapsed=$((elapsed + WAIT_INTERVAL))
    done

    echo -e " ${RED}✗${NC}"
    echo -e "${RED}  Error: $name did not become healthy within ${MAX_WAIT}s${NC}"
    return 1
}

# Wait for both services
wait_for_service "http://localhost:$SIDECAR_PORT" "Presidio Sidecar" || exit 1
wait_for_service "http://localhost:$KROUTER_PORT" "kRouter" || exit 1

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✓ All services are running and healthy!                    ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Display service info
echo -e "${BLUE}Service Endpoints:${NC}"
echo "─────────────────────────────────────────────────────"
echo -e "  kRouter Dashboard:  ${CYAN}http://localhost:$KROUTER_PORT/dashboard${NC}"
echo -e "  kRouter API:        ${CYAN}http://localhost:$KROUTER_PORT/v1/messages${NC}"
echo -e "  Presidio Sidecar:   ${CYAN}http://localhost:$SIDECAR_PORT${NC}"
echo ""

# Display status
echo -e "${BLUE}Service Status:${NC}"
echo "─────────────────────────────────────────────────────"
docker-compose ps
echo ""

# Display test commands
echo -e "${YELLOW}Quick Test Commands:${NC}"
echo "─────────────────────────────────────────────────────"
echo -e "${GREEN}1. Test sidecar directly:${NC}"
echo -e "   ${CYAN}curl -X POST http://localhost:$SIDECAR_PORT/redact \\${NC}"
echo -e "   ${CYAN}     -H 'Content-Type: application/json' \\${NC}"
echo -e "   ${CYAN}     -d '{\"texts\":[\"My email is john@example.com\"]}'${NC}"
echo ""

echo -e "${GREEN}2. Test full kRouter flow:${NC}"
echo -e "   ${CYAN}curl -X POST http://localhost:$KROUTER_PORT/v1/messages \\${NC}"
echo -e "   ${CYAN}     -H 'Content-Type: application/json' \\${NC}"
echo -e "   ${CYAN}     -H 'Authorization: Bearer test-key' \\${NC}"
echo -e "   ${CYAN}     -d '{\"model\":\"gpt-4\",\"messages\":[{\"role\":\"user\",\"content\":\"My email is test@example.com\"}]}'${NC}"
echo ""

echo -e "${GREEN}3. Watch redaction logs in real-time:${NC}"
echo -e "   ${CYAN}docker-compose logs -f | grep -i 'redact\\|email\\|phone'${NC}"
echo ""

echo -e "${YELLOW}Useful Commands:${NC}"
echo "─────────────────────────────────────────────────────"
echo -e "  View all logs:      ${CYAN}docker-compose logs -f${NC}"
echo -e "  kRouter logs:       ${CYAN}docker-compose logs -f krouter${NC}"
echo -e "  Sidecar logs:       ${CYAN}docker-compose logs -f presidio-sidecar${NC}"
echo -e "  Stop services:      ${CYAN}docker-compose down${NC}"
echo -e "  Restart services:   ${CYAN}docker-compose restart${NC}"
echo -e "  Check status:       ${CYAN}docker-compose ps${NC}"
echo ""

# Run a quick test
echo -e "${YELLOW}Running quick redaction test...${NC}"
echo "─────────────────────────────────────────────────────"

TEST_RESPONSE=$(curl -s -X POST "http://localhost:$SIDECAR_PORT/redact" \
  -H "Content-Type: application/json" \
  -d '{"texts":["My email is test@example.com and my phone is 555-123-4567"]}')

if echo "$TEST_RESPONSE" | grep -q "redacted_texts"; then
    echo -e "${GREEN}✓ Redaction is working!${NC}"
    echo ""
    echo "Example output:"
    echo "$TEST_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$TEST_RESPONSE"
else
    echo -e "${RED}✗ Redaction test failed${NC}"
    echo "Response: $TEST_RESPONSE"
fi

echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Startup complete! PII redaction is now active.            ${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "Press ${CYAN}Ctrl+C${NC} to stop viewing logs (services continue running)"
echo -e "Run ${CYAN}docker-compose down${NC} to stop all services"
echo ""

# Offer to follow logs
read -p "Follow logs now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}Following logs (press Ctrl+C to exit)...${NC}"
    docker-compose logs -f
fi
