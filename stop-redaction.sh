#!/bin/bash
# Stop kRouter and Presidio sidecar services

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  kRouter + Presidio Redaction Shutdown Script              ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if services are running
if ! docker-compose ps | grep -q "Up"; then
    echo -e "${YELLOW}No services are currently running.${NC}"
    exit 0
fi

# Show current status
echo -e "${BLUE}Current Service Status:${NC}"
echo "─────────────────────────────────────────────────────"
docker-compose ps
echo ""

# Ask for cleanup level
echo -e "${YELLOW}Select shutdown option:${NC}"
echo "  1) Stop services (keep volumes and images)"
echo "  2) Stop services + remove volumes (reset data)"
echo "  3) Stop services + remove volumes + remove images (clean slate)"
echo "  4) Stop services + remove everything including orphaned containers"
echo ""
read -p "Enter option [1-4] (default: 1): " choice
choice=${choice:-1}

case $choice in
    1)
        echo -e "${BLUE}Stopping services...${NC}"
        docker-compose down
        echo -e "${GREEN}✓ Services stopped (volumes and images preserved)${NC}"
        ;;
    2)
        echo -e "${BLUE}Stopping services and removing volumes...${NC}"
        docker-compose down -v
        echo -e "${GREEN}✓ Services stopped and volumes removed${NC}"
        echo -e "${YELLOW}⚠  Note: All kRouter data will be reset on next start${NC}"
        ;;
    3)
        echo -e "${BLUE}Stopping services and removing volumes and images...${NC}"
        docker-compose down -v --rmi local
        echo -e "${GREEN}✓ Services stopped, volumes and local images removed${NC}"
        echo -e "${YELLOW}⚠  Note: Next start will rebuild images${NC}"
        ;;
    4)
        echo -e "${BLUE}Stopping services and removing everything...${NC}"
        docker-compose down -v --rmi all --remove-orphans
        echo -e "${GREEN}✓ Complete cleanup done${NC}"
        echo -e "${YELLOW}⚠  Note: All containers, volumes, images, and orphaned containers removed${NC}"
        ;;
    *)
        echo -e "${RED}Invalid option. Defaulting to option 1.${NC}"
        docker-compose down
        echo -e "${GREEN}✓ Services stopped${NC}"
        ;;
esac

echo ""
echo -e "${BLUE}Verifying shutdown...${NC}"

# Check if any containers are still running
RUNNING=$(docker-compose ps -q 2>/dev/null | wc -l)
if [ "$RUNNING" -eq 0 ]; then
    echo -e "${GREEN}✓ All services successfully stopped${NC}"
else
    echo -e "${YELLOW}⚠  Some containers may still be running${NC}"
    echo "Run: docker-compose ps"
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Shutdown complete!                                         ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Show remaining resources
echo -e "${BLUE}Remaining Docker Resources:${NC}"
echo "─────────────────────────────────────────────────────"
echo "Volumes:"
docker volume ls | grep -E "krouter|presidio" || echo "  (none)"
echo ""
echo "Images:"
docker images | grep -E "krouter|presidio" || echo "  (none)"
echo ""
echo "Containers:"
docker ps -a | grep -E "krouter|presidio" || echo "  (none)"
echo ""

echo -e "${YELLOW}To start services again:${NC}"
echo "  ./start-redaction.sh          (interactive)"
echo "  ./start-redaction-quick.sh    (quick start)"
echo ""
