#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PLIST_NAME="com.sarkar-local-agent.service"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"
CLAUDE_DESKTOP_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"

echo -e "${BLUE}"
echo "╔════════════════════════════════════════╗"
echo "║     Sarkar Local Agent Uninstaller     ║"
echo "╚════════════════════════════════════════╝"
echo -e "${NC}"

# Stop and remove the service
if launchctl list 2>/dev/null | grep -q "$PLIST_NAME"; then
    echo -e "${YELLOW}Stopping service...${NC}"
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    echo -e "${GREEN}✓ Service stopped${NC}"
else
    echo -e "${YELLOW}Service not running${NC}"
fi

# Remove plist file
if [ -f "$PLIST_PATH" ]; then
    rm "$PLIST_PATH"
    echo -e "${GREEN}✓ Service configuration removed${NC}"
fi

# Ask about Claude Desktop config
if [ -f "$CLAUDE_DESKTOP_CONFIG" ] && grep -q '"sarkar-local-agent"' "$CLAUDE_DESKTOP_CONFIG"; then
    echo ""
    read -p "Remove sarkar-local-agent from Claude Desktop config? [y/N]: " REMOVE_MCP
    if [ "$REMOVE_MCP" = "y" ] || [ "$REMOVE_MCP" = "Y" ]; then
        # Backup and remove using Python
        cp "$CLAUDE_DESKTOP_CONFIG" "$CLAUDE_DESKTOP_CONFIG.backup"
        python3 << 'PYTHON_EOF'
import json

config_path = "$HOME/Library/Application Support/Claude/claude_desktop_config.json".replace("$HOME", __import__("os").environ["HOME"])
with open(config_path, 'r') as f:
    config = json.load(f)

if 'mcpServers' in config and 'sarkar-local-agent' in config['mcpServers']:
    del config['mcpServers']['sarkar-local-agent']
    with open(config_path, 'w') as f:
        json.dump(config, f, indent=2)
    print("Removed sarkar-local-agent from config")
PYTHON_EOF
        echo -e "${GREEN}✓ Removed from Claude Desktop config${NC}"
        echo -e "${YELLOW}Note: Restart Claude Desktop for changes to take effect${NC}"
    fi
fi

# Ask about sleep settings
echo ""
read -p "Restore default sleep settings? [y/N]: " RESTORE_SLEEP
if [ "$RESTORE_SLEEP" = "y" ] || [ "$RESTORE_SLEEP" = "Y" ]; then
    echo -e "${YELLOW}Restoring default sleep settings...${NC}"
    sudo pmset -c sleep 1
    echo -e "${GREEN}✓ Sleep settings restored${NC}"
fi

echo ""
echo -e "${GREEN}Uninstall complete!${NC}"
echo -e "${YELLOW}Note: Project files were not removed. Delete manually if needed:${NC}"
echo "  rm -rf $(cd "$(dirname "$0")" && pwd)"
