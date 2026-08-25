#!/bin/bash
# Check status of kRouter and Presidio redaction services

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  kRouter + Presidio Redaction Service Status               ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker is not installed${NC}"
    exit 1
fi

# Service status
echo -e "${BLUE}Service Status:${NC}"
echo "─────────────────────────────────────────────────────"

STATUS=$(docker-compose ps 2>/dev/null)

if [ -z "$STATUS" ]; then
    echo -e "${RED}✗ No docker-compose services defined${NC}"
    exit 1
fi

echo "$STATUS"

# Check health
echo ""
echo -e "${BLUE}Health Checks:${NC}"
echo "─────────────────────────────────────────────────────"

# Check kRouter
if curl -s -f http://localhost:20128/health > /dev/null 2>&1; then
    echo -e "  kRouter:       ${GREEN}✓ Healthy${NC} (http://localhost:20128/health)"
else
    echo -e "  kRouter:       ${RED}✗ Unhealthy${NC}"
fi

# Check Presidio Sidecar
if curl -s -f http://localhost:5001/health > /dev/null 2>&1; then
    echo -e "  Presidio:      ${GREEN}✓ Healthy${NC} (http://localhost:5001/health)"
else
    echo -e "  Presidio:      ${RED}✗ Unhealthy${NC}"
fi

echo ""

# Redaction test
echo -e "${BLUE}Redaction Test:${NC}"
echo "─────────────────────────────────────────────────────"

if curl -s -f http://localhost:5001/health > /dev/null 2>&1; then
    TEST_RESPONSE=$(curl -s -X POST http://localhost:5001/redact \
        -H "Content-Type: application/json" \
        -d '{"texts":["test@example.com"]}' 2>/dev/null)

    if echo "$TEST_RESPONSE" | grep -q "redacted_texts"; then
        echo -e "  ${GREEN}✓ Redaction working${NC}"
        echo ""
        echo "  Example:"
        echo "$TEST_RESPONSE" | python3 -m json.tool 2>/dev/null | sed 's/^/    /' || echo "$TEST_RESPONSE" | sed 's/^/    /'
    else
        echo -e "  ${RED}✗ Redaction not responding${NC}"
    fi
else
    echo -e "  ${YELLOW}⊘ Skipped (sidecar not healthy)${NC}"
fi

echo ""
echo -e "${BLUE}Resource Usage:${NC}"
echo "─────────────────────────────────────────────────────"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>/dev/null | grep -E "NAME|krouter|presidio" || echo "  (no running containers)"

echo ""
echo -e "${BLUE}Recent Logs (last 5 lines):${NC}"
echo "─────────────────────────────────────────────────────"
echo -e "${YELLOW}kRouter:${NC}"
docker-compose logs --tail=5 krouter 2>/dev/null | sed 's/^/  /' || echo "  (no logs)"
echo ""
echo -e "${YELLOW}Presidio Sidecar:${NC}"
docker-compose logs --tail=5 presidio-sidecar 2>/dev/null | sed 's/^/  /' || echo "  (no logs)"

echo ""
echo -e "${BLUE}Quick Commands:${NC}"
echo "─────────────────────────────────────────────────────"
echo "  Start services:    ./start-redaction.sh"
echo "  Stop services:     ./stop-redaction.sh"
echo "  View logs:         docker-compose logs -f"
echo "  Restart:           docker-compose restart"
echo ""
