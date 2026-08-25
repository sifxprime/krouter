#!/bin/bash
# Quick stop script - stops services immediately

echo "Stopping kRouter + Presidio Redaction..."
docker-compose down

echo "✓ Services stopped"
echo ""
echo "To start again: ./start-redaction-quick.sh"
