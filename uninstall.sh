#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# =============================================================================
# OS Detection
# =============================================================================
OS_TYPE="$(uname -s)"
case "$OS_TYPE" in
    Darwin)  PLATFORM="macos" ;;
    Linux)   PLATFORM="linux" ;;
    *)       PLATFORM="unknown" ;;
esac

# Platform-specific paths
if [ "$PLATFORM" = "macos" ]; then
    PLIST_NAME="com.deskmate.service"
    PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"
    CLAUDE_DESKTOP_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
elif [ "$PLATFORM" = "linux" ]; then
    SYSTEMD_SERVICE="deskmate.service"
    SYSTEMD_PATH="$HOME/.config/systemd/user/$SYSTEMD_SERVICE"
    CLAUDE_DESKTOP_CONFIG="$HOME/.config/Claude/claude_desktop_config.json"
fi

echo -e "${BLUE}"
echo "╔════════════════════════════════════════╗"
echo "║     Deskmate Uninstaller     ║"
echo "╚════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "Detected platform: ${GREEN}$PLATFORM${NC}"

# =============================================================================
# Stop and remove the service (platform-specific)
# =============================================================================
if [ "$PLATFORM" = "macos" ]; then
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

elif [ "$PLATFORM" = "linux" ]; then
    if systemctl --user is-active "$SYSTEMD_SERVICE" &>/dev/null; then
        echo -e "${YELLOW}Stopping service...${NC}"
        systemctl --user stop "$SYSTEMD_SERVICE" 2>/dev/null || true
        echo -e "${GREEN}✓ Service stopped${NC}"
    else
        echo -e "${YELLOW}Service not running${NC}"
    fi

    if systemctl --user is-enabled "$SYSTEMD_SERVICE" &>/dev/null; then
        systemctl --user disable "$SYSTEMD_SERVICE" 2>/dev/null || true
        echo -e "${GREEN}✓ Service disabled${NC}"
    fi

    # Remove systemd unit file
    if [ -f "$SYSTEMD_PATH" ]; then
        rm "$SYSTEMD_PATH"
        systemctl --user daemon-reload 2>/dev/null || true
        echo -e "${GREEN}✓ Service configuration removed${NC}"
    fi
fi

# =============================================================================
# Ask about Claude Desktop config
# =============================================================================
if [ -f "$CLAUDE_DESKTOP_CONFIG" ] && grep -q '"deskmate"' "$CLAUDE_DESKTOP_CONFIG"; then
    echo ""
    read -p "Remove deskmate from Claude Desktop config? [y/N]: " REMOVE_MCP
    if [ "$REMOVE_MCP" = "y" ] || [ "$REMOVE_MCP" = "Y" ]; then
        # Backup and remove using Python
        cp "$CLAUDE_DESKTOP_CONFIG" "$CLAUDE_DESKTOP_CONFIG.backup"
        python3 << 'PYTHON_EOF'
import json, os

config_path = os.path.expanduser("~/.config/Claude/claude_desktop_config.json") if os.uname().sysname == "Linux" else os.path.expanduser("~/Library/Application Support/Claude/claude_desktop_config.json")
with open(config_path, 'r') as f:
    config = json.load(f)

if 'mcpServers' in config and 'deskmate' in config['mcpServers']:
    del config['mcpServers']['deskmate']
    with open(config_path, 'w') as f:
        json.dump(config, f, indent=2)
    print("Removed deskmate from config")
PYTHON_EOF
        echo -e "${GREEN}✓ Removed from Claude Desktop config${NC}"
        echo -e "${YELLOW}Note: Restart Claude Desktop for changes to take effect${NC}"
    fi
fi

# =============================================================================
# Ask about sleep settings (macOS only)
# =============================================================================
if [ "$PLATFORM" = "macos" ]; then
    echo ""
    read -p "Restore default sleep settings? [y/N]: " RESTORE_SLEEP
    if [ "$RESTORE_SLEEP" = "y" ] || [ "$RESTORE_SLEEP" = "Y" ]; then
        echo -e "${YELLOW}Restoring default sleep settings...${NC}"
        sudo pmset -c sleep 1
        echo -e "${GREEN}✓ Sleep settings restored${NC}"
    fi
fi

echo ""
echo -e "${GREEN}Uninstall complete!${NC}"
