#!/bin/bash
# Quick start script - starts services and exits

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}Starting kRouter + Presidio Redaction...${NC}"

# Start services
docker-compose up -d --build

# Wait for services
echo "Waiting for services to be ready..."
sleep 15

# Check health
if curl -s http://localhost:20128/health > /dev/null && curl -s http://localhost:5001/health > /dev/null; then
    echo -e "${GREEN}✓ Services are running!${NC}"
    echo ""
    echo "kRouter:     http://localhost:20128/dashboard"
    echo "Sidecar:     http://localhost:5001"
    echo ""
    echo "Test redaction:"
    echo '  curl -X POST http://localhost:5001/redact -H "Content-Type: application/json" -d '"'"'{"texts":["My email is test@example.com"]}'"'"
else
    echo -e "${RED}✗ Services failed to start${NC}"
    echo "Check logs: docker-compose logs"
    exit 1
fi
