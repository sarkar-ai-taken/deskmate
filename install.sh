#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_NAME="com.deskmate.service"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"
LOGS_DIR="$PROJECT_DIR/logs"
NODE_PATH=$(which node)
CLAUDE_DESKTOP_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"

echo -e "${BLUE}"
echo "╔════════════════════════════════════════╗"
echo "║     Deskmate Installer       ║"
echo "╚════════════════════════════════════════╝"
echo -e "${NC}"

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo -e "${RED}Error: .env file not found. Please create it from .env.example${NC}"
    exit 1
fi

if [ -z "$NODE_PATH" ]; then
    echo -e "${RED}Error: Node.js not found. Please install Node.js first.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Node.js found: $NODE_PATH${NC}"
echo -e "${GREEN}✓ .env file found${NC}"

# Check if Claude Code is installed (required for Agent SDK)
CLAUDE_PATH=$(which claude 2>/dev/null || echo "")
if [ -z "$CLAUDE_PATH" ]; then
    echo -e "${RED}Error: Claude Code CLI not found. Please install it first:${NC}"
    echo -e "${YELLOW}  curl -fsSL https://claude.ai/install.sh | bash${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Claude Code found: $CLAUDE_PATH${NC}"

# Build the project
echo -e "\n${YELLOW}Building project...${NC}"
cd "$PROJECT_DIR"
npm install --legacy-peer-deps
npm run build
echo -e "${GREEN}✓ Build complete${NC}"

# Create logs directory
mkdir -p "$LOGS_DIR"
echo -e "${GREEN}✓ Logs directory created: $LOGS_DIR${NC}"

# =============================================================================
# macOS Permissions Setup
# =============================================================================
echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Setting up macOS permissions...${NC}"
echo ""
echo -e "Deskmate needs the following permissions to work properly:"
echo -e "  • ${GREEN}Screen Recording${NC} - To take screenshots when requested"
echo -e "  • ${GREEN}Accessibility${NC} - To control system functions"
echo -e "  • ${GREEN}Full Disk Access${NC} - To read/write files anywhere"
echo -e "  • ${GREEN}Automation${NC} - To control other applications"
echo ""
read -p "Would you like to configure permissions now? [Y/n]: " SETUP_PERMISSIONS
SETUP_PERMISSIONS=${SETUP_PERMISSIONS:-y}

if [ "$SETUP_PERMISSIONS" = "y" ] || [ "$SETUP_PERMISSIONS" = "Y" ]; then

    # Get the terminal app being used
    TERMINAL_APP=$(osascript -e 'tell application "System Events" to get name of first process whose frontmost is true' 2>/dev/null || echo "Terminal")

    echo -e "\n${YELLOW}1. Screen Recording Permission${NC}"
    echo "   This allows taking screenshots when you request them."
    read -p "   Trigger Screen Recording permission dialog? [Y/n]: " TRIGGER_SCREEN
    TRIGGER_SCREEN=${TRIGGER_SCREEN:-y}

    if [ "$TRIGGER_SCREEN" = "y" ] || [ "$TRIGGER_SCREEN" = "Y" ]; then
        echo -e "   ${YELLOW}Triggering permission dialog...${NC}"
        # Attempt to capture screen to trigger the permission dialog
        screencapture -x /tmp/sarkar-test-screenshot.png 2>/dev/null || true
        rm -f /tmp/sarkar-test-screenshot.png 2>/dev/null || true
        echo -e "   ${GREEN}✓ If a dialog appeared, please click 'Allow'${NC}"
        echo -e "   ${YELLOW}   If no dialog appeared, the permission may already be granted${NC}"
        sleep 1
    fi

    echo -e "\n${YELLOW}2. Accessibility Permission${NC}"
    echo "   This allows controlling system functions."
    read -p "   Open Accessibility settings? [Y/n]: " OPEN_ACCESSIBILITY
    OPEN_ACCESSIBILITY=${OPEN_ACCESSIBILITY:-y}

    if [ "$OPEN_ACCESSIBILITY" = "y" ] || [ "$OPEN_ACCESSIBILITY" = "Y" ]; then
        echo -e "   ${YELLOW}Opening System Settings > Privacy & Security > Accessibility...${NC}"
        open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        echo -e "   ${GREEN}Please add '$TERMINAL_APP' and/or 'deskmate' to the list${NC}"
        read -p "   Press Enter when done..."
    fi

    echo -e "\n${YELLOW}3. Full Disk Access Permission${NC}"
    echo "   This allows reading and writing files in protected locations."
    read -p "   Open Full Disk Access settings? [Y/n]: " OPEN_DISK
    OPEN_DISK=${OPEN_DISK:-y}

    if [ "$OPEN_DISK" = "y" ] || [ "$OPEN_DISK" = "Y" ]; then
        echo -e "   ${YELLOW}Opening System Settings > Privacy & Security > Full Disk Access...${NC}"
        open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
        echo -e "   ${GREEN}Please add '$TERMINAL_APP' and/or 'deskmate' to the list${NC}"
        read -p "   Press Enter when done..."
    fi

    echo -e "\n${YELLOW}4. Automation Permission${NC}"
    echo "   This allows controlling other applications via AppleScript."
    read -p "   Open Automation settings? [Y/n]: " OPEN_AUTOMATION
    OPEN_AUTOMATION=${OPEN_AUTOMATION:-y}

    if [ "$OPEN_AUTOMATION" = "y" ] || [ "$OPEN_AUTOMATION" = "Y" ]; then
        echo -e "   ${YELLOW}Opening System Settings > Privacy & Security > Automation...${NC}"
        open "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"
        echo -e "   ${GREEN}Please enable automation for '$TERMINAL_APP' if listed${NC}"
        read -p "   Press Enter when done..."
    fi

    echo -e "\n${YELLOW}5. Background Items (Login Items)${NC}"
    echo "   This allows the service to run in the background and start at login."
    read -p "   Open Login Items settings? [Y/n]: " OPEN_LOGIN
    OPEN_LOGIN=${OPEN_LOGIN:-y}

    if [ "$OPEN_LOGIN" = "y" ] || [ "$OPEN_LOGIN" = "Y" ]; then
        echo -e "   ${YELLOW}Opening System Settings > General > Login Items...${NC}"
        open "x-apple.systempreferences:com.apple.LoginItems-Settings.extension"
        echo -e "   ${GREEN}Ensure 'node' is enabled under 'Allow in the Background'${NC}"
        read -p "   Press Enter when done..."
    fi

    echo -e "\n${GREEN}✓ Permissions setup complete${NC}"
    echo -e "${YELLOW}Note: Some permissions may require restarting the terminal or service${NC}"
else
    echo -e "${YELLOW}Skipping permissions setup. You can configure them later in:${NC}"
    echo -e "  System Settings > Privacy & Security"
fi

# =============================================================================
# Folder Access Configuration
# =============================================================================
echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Configuring folder access...${NC}"
echo ""
echo -e "macOS will ask for permission when the agent accesses protected folders."
echo -e "Let's configure which folders the agent should have access to."
echo ""

# Common protected folders
FOLDERS_TO_CONFIGURE=""

echo -e "${YELLOW}Select folders to grant access (this will trigger macOS permission dialogs):${NC}"
echo ""

# Desktop
read -p "  Grant access to Desktop? [Y/n]: " ACCESS_DESKTOP
ACCESS_DESKTOP=${ACCESS_DESKTOP:-y}
if [ "$ACCESS_DESKTOP" = "y" ] || [ "$ACCESS_DESKTOP" = "Y" ]; then
    echo -e "  ${YELLOW}Triggering Desktop access...${NC}"
    ls "$HOME/Desktop" > /dev/null 2>&1 || true
    FOLDERS_TO_CONFIGURE="$HOME/Desktop"
    echo -e "  ${GREEN}✓ Desktop access requested${NC}"
fi

# Documents
read -p "  Grant access to Documents? [Y/n]: " ACCESS_DOCUMENTS
ACCESS_DOCUMENTS=${ACCESS_DOCUMENTS:-y}
if [ "$ACCESS_DOCUMENTS" = "y" ] || [ "$ACCESS_DOCUMENTS" = "Y" ]; then
    echo -e "  ${YELLOW}Triggering Documents access...${NC}"
    ls "$HOME/Documents" > /dev/null 2>&1 || true
    FOLDERS_TO_CONFIGURE="$FOLDERS_TO_CONFIGURE:$HOME/Documents"
    echo -e "  ${GREEN}✓ Documents access requested${NC}"
fi

# Downloads
read -p "  Grant access to Downloads? [Y/n]: " ACCESS_DOWNLOADS
ACCESS_DOWNLOADS=${ACCESS_DOWNLOADS:-y}
if [ "$ACCESS_DOWNLOADS" = "y" ] || [ "$ACCESS_DOWNLOADS" = "Y" ]; then
    echo -e "  ${YELLOW}Triggering Downloads access...${NC}"
    ls "$HOME/Downloads" > /dev/null 2>&1 || true
    FOLDERS_TO_CONFIGURE="$FOLDERS_TO_CONFIGURE:$HOME/Downloads"
    echo -e "  ${GREEN}✓ Downloads access requested${NC}"
fi

# Pictures
read -p "  Grant access to Pictures? [y/N]: " ACCESS_PICTURES
if [ "$ACCESS_PICTURES" = "y" ] || [ "$ACCESS_PICTURES" = "Y" ]; then
    echo -e "  ${YELLOW}Triggering Pictures access...${NC}"
    ls "$HOME/Pictures" > /dev/null 2>&1 || true
    FOLDERS_TO_CONFIGURE="$FOLDERS_TO_CONFIGURE:$HOME/Pictures"
    echo -e "  ${GREEN}✓ Pictures access requested${NC}"
fi

# Movies
read -p "  Grant access to Movies? [y/N]: " ACCESS_MOVIES
if [ "$ACCESS_MOVIES" = "y" ] || [ "$ACCESS_MOVIES" = "Y" ]; then
    echo -e "  ${YELLOW}Triggering Movies access...${NC}"
    ls "$HOME/Movies" > /dev/null 2>&1 || true
    FOLDERS_TO_CONFIGURE="$FOLDERS_TO_CONFIGURE:$HOME/Movies"
    echo -e "  ${GREEN}✓ Movies access requested${NC}"
fi

# Music
read -p "  Grant access to Music? [y/N]: " ACCESS_MUSIC
if [ "$ACCESS_MUSIC" = "y" ] || [ "$ACCESS_MUSIC" = "Y" ]; then
    echo -e "  ${YELLOW}Triggering Music access...${NC}"
    ls "$HOME/Music" > /dev/null 2>&1 || true
    FOLDERS_TO_CONFIGURE="$FOLDERS_TO_CONFIGURE:$HOME/Music"
    echo -e "  ${GREEN}✓ Music access requested${NC}"
fi

# iCloud Drive
if [ -d "$HOME/Library/Mobile Documents/com~apple~CloudDocs" ]; then
    read -p "  Grant access to iCloud Drive? [y/N]: " ACCESS_ICLOUD
    if [ "$ACCESS_ICLOUD" = "y" ] || [ "$ACCESS_ICLOUD" = "Y" ]; then
        echo -e "  ${YELLOW}Triggering iCloud Drive access...${NC}"
        ls "$HOME/Library/Mobile Documents/com~apple~CloudDocs" > /dev/null 2>&1 || true
        FOLDERS_TO_CONFIGURE="$FOLDERS_TO_CONFIGURE:$HOME/Library/Mobile Documents/com~apple~CloudDocs"
        echo -e "  ${GREEN}✓ iCloud Drive access requested${NC}"
    fi
fi

# Custom folder
echo ""
read -p "  Add a custom folder path? [y/N]: " ADD_CUSTOM
if [ "$ADD_CUSTOM" = "y" ] || [ "$ADD_CUSTOM" = "Y" ]; then
    read -p "  Enter folder path: " CUSTOM_FOLDER
    if [ -d "$CUSTOM_FOLDER" ]; then
        echo -e "  ${YELLOW}Triggering access to $CUSTOM_FOLDER...${NC}"
        ls "$CUSTOM_FOLDER" > /dev/null 2>&1 || true
        FOLDERS_TO_CONFIGURE="$FOLDERS_TO_CONFIGURE:$CUSTOM_FOLDER"
        echo -e "  ${GREEN}✓ Custom folder access requested${NC}"
    else
        echo -e "  ${RED}✗ Folder not found: $CUSTOM_FOLDER${NC}"
    fi
fi

# Clean up the folders string (remove leading colon)
FOLDERS_TO_CONFIGURE=$(echo "$FOLDERS_TO_CONFIGURE" | sed 's/^://')

# Save to .env if not already there
if [ -n "$FOLDERS_TO_CONFIGURE" ]; then
    # Check if ALLOWED_FOLDERS exists in .env
    if grep -q "^ALLOWED_FOLDERS=" "$PROJECT_DIR/.env" 2>/dev/null; then
        # Update existing
        sed -i '' "s|^ALLOWED_FOLDERS=.*|ALLOWED_FOLDERS=$FOLDERS_TO_CONFIGURE|" "$PROJECT_DIR/.env"
    else
        # Add new
        echo "" >> "$PROJECT_DIR/.env"
        echo "# Folders the agent is allowed to access" >> "$PROJECT_DIR/.env"
        echo "ALLOWED_FOLDERS=$FOLDERS_TO_CONFIGURE" >> "$PROJECT_DIR/.env"
    fi
    echo -e "\n${GREEN}✓ Folder access configuration saved to .env${NC}"
fi

echo -e "${YELLOW}Note: If permission dialogs appeared, make sure to click 'Allow'${NC}"
echo -e "${YELLOW}      You may need to restart the service for changes to take effect${NC}"

# Ask which mode to install
echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Which mode would you like to install?${NC}"
echo ""
echo -e "  ${GREEN}1)${NC} Telegram only"
echo "     Chat with your Mac via Telegram bot"
echo ""
echo -e "  ${GREEN}2)${NC} MCP only"
echo "     Expose as MCP server for Claude Desktop"
echo ""
echo -e "  ${GREEN}3)${NC} Both (recommended)"
echo "     Telegram bot + MCP server together"
echo "     Approve MCP requests from your phone!"
echo ""
read -p "Choose mode [1/2/3] (default: 3): " MODE_CHOICE
MODE_CHOICE=${MODE_CHOICE:-3}

case $MODE_CHOICE in
    1)
        RUN_MODE="telegram"
        echo -e "${GREEN}✓ Telegram mode selected${NC}"
        ;;
    2)
        RUN_MODE="mcp"
        echo -e "${GREEN}✓ MCP mode selected${NC}"
        ;;
    *)
        RUN_MODE="both"
        echo -e "${GREEN}✓ Both modes selected${NC}"
        ;;
esac

# MCP Configuration for Claude Desktop - auto-configure when MCP mode is selected
CONFIGURE_CLAUDE_DESKTOP=false
if [ "$RUN_MODE" = "mcp" ] || [ "$RUN_MODE" = "both" ]; then
    CONFIGURE_CLAUDE_DESKTOP=true
    echo -e "${GREEN}✓ Will configure Claude Desktop for MCP${NC}"
fi

# Sleep prevention (only for background service modes)
if [ "$RUN_MODE" = "telegram" ] || [ "$RUN_MODE" = "both" ]; then
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Configuring system sleep settings...${NC}"
    echo -e "${YELLOW}This requires sudo access to modify power management settings.${NC}"
    sudo pmset -c sleep 0 displaysleep 10
    echo -e "${GREEN}✓ System configured: sleep disabled when plugged in, display sleeps after 10 min${NC}"

    # Ask if user also wants caffeinate as extra protection
    echo ""
    echo -e "${YELLOW}Optional: Also use caffeinate for extra protection?${NC}"
    echo "  This adds an extra layer - prevents sleep specifically while the service runs."
    echo ""
    read -p "Enable caffeinate? [y/N]: " ENABLE_CAFFEINATE
    USE_CAFFEINATE=false

    if [ "$ENABLE_CAFFEINATE" = "y" ] || [ "$ENABLE_CAFFEINATE" = "Y" ]; then
        USE_CAFFEINATE=true
        echo -e "${GREEN}✓ Caffeinate enabled${NC}"
    else
        echo -e "${GREEN}✓ Using system settings only${NC}"
    fi
fi

# Unload existing service if present
if launchctl list 2>/dev/null | grep -q "$PLIST_NAME"; then
    echo -e "\n${YELLOW}Stopping existing service...${NC}"
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    echo -e "${GREEN}✓ Existing service stopped${NC}"
fi

# Create the launchd plist file (for telegram or both modes)
if [ "$RUN_MODE" = "telegram" ] || [ "$RUN_MODE" = "both" ]; then
    echo -e "\n${YELLOW}Creating launchd service...${NC}"

    if [ "$USE_CAFFEINATE" = true ]; then
        cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_NAME</string>

    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/caffeinate</string>
        <string>-i</string>
        <string>$NODE_PATH</string>
        <string>$PROJECT_DIR/dist/index.js</string>
        <string>$RUN_MODE</string>
    </array>

    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>$LOGS_DIR/stdout.log</string>

    <key>StandardErrorPath</key>
    <string>$LOGS_DIR/stderr.log</string>
</dict>
</plist>
EOF
    else
        cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_NAME</string>

    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$PROJECT_DIR/dist/index.js</string>
        <string>$RUN_MODE</string>
    </array>

    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>$LOGS_DIR/stdout.log</string>

    <key>StandardErrorPath</key>
    <string>$LOGS_DIR/stderr.log</string>
</dict>
</plist>
EOF
    fi

    echo -e "${GREEN}✓ Service configuration created${NC}"

    # Load the service
    echo -e "\n${YELLOW}Starting service...${NC}"
    launchctl load "$PLIST_PATH"
    sleep 2

    # Check if service is running
    if launchctl list | grep -q "$PLIST_NAME"; then
        echo -e "${GREEN}✓ Service started successfully${NC}"
    else
        echo -e "${RED}✗ Service failed to start. Check logs:${NC}"
        echo -e "  tail -f $LOGS_DIR/stderr.log"
        exit 1
    fi
fi

# Configure Claude Desktop if requested
if [ "$CONFIGURE_CLAUDE_DESKTOP" = true ]; then
    echo -e "\n${YELLOW}Configuring Claude Desktop...${NC}"

    # Create config directory if it doesn't exist
    mkdir -p "$(dirname "$CLAUDE_DESKTOP_CONFIG")"

    # Get WORKING_DIR from .env or use HOME
    WORKING_DIR=$(grep -E "^WORKING_DIR=" "$PROJECT_DIR/.env" | cut -d'=' -f2 || echo "$HOME")
    WORKING_DIR=${WORKING_DIR:-$HOME}

    # Check if config file exists and has content
    if [ -f "$CLAUDE_DESKTOP_CONFIG" ] && [ -s "$CLAUDE_DESKTOP_CONFIG" ]; then
        # Backup existing config
        cp "$CLAUDE_DESKTOP_CONFIG" "$CLAUDE_DESKTOP_CONFIG.backup"
        echo -e "${GREEN}✓ Backed up existing config${NC}"

        # Check if deskmate already configured
        if grep -q '"deskmate"' "$CLAUDE_DESKTOP_CONFIG"; then
            echo -e "${YELLOW}⚠ deskmate already configured in Claude Desktop${NC}"
            echo "  Please manually update the config if needed."
        else
            # Add to existing config using Python (more reliable JSON handling)
            python3 << PYTHON_EOF
import json

config_path = "$CLAUDE_DESKTOP_CONFIG"
with open(config_path, 'r') as f:
    config = json.load(f)

if 'mcpServers' not in config:
    config['mcpServers'] = {}

config['mcpServers']['deskmate'] = {
    "command": "$NODE_PATH",
    "args": ["$PROJECT_DIR/dist/index.js", "mcp"],
    "env": {
        "WORKING_DIR": "$WORKING_DIR"
    }
}

with open(config_path, 'w') as f:
    json.dump(config, f, indent=2)

print("Config updated successfully")
PYTHON_EOF
            echo -e "${GREEN}✓ Added deskmate to Claude Desktop config${NC}"
        fi
    else
        # Create new config file
        cat > "$CLAUDE_DESKTOP_CONFIG" << EOF
{
  "mcpServers": {
    "deskmate": {
      "command": "$NODE_PATH",
      "args": ["$PROJECT_DIR/dist/index.js", "mcp"],
      "env": {
        "WORKING_DIR": "$WORKING_DIR"
      }
    }
  }
}
EOF
        echo -e "${GREEN}✓ Created Claude Desktop config${NC}"
    fi

    echo -e "${YELLOW}Note: Restart Claude Desktop for changes to take effect${NC}"
fi

# Print summary
echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Installation complete!${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

case $RUN_MODE in
    telegram)
        echo -e "Your Telegram bot is now running as a background service."
        ;;
    mcp)
        echo -e "MCP server configured for Claude Desktop."
        echo -e "Claude Desktop will start the MCP server on demand."
        ;;
    both)
        echo -e "Both Telegram bot and MCP server are configured!"
        echo -e "• Telegram bot: Running as background service"
        echo -e "• MCP server: Available to Claude Desktop"
        ;;
esac

echo ""
echo -e "${YELLOW}Useful commands:${NC}"

if [ "$RUN_MODE" = "telegram" ] || [ "$RUN_MODE" = "both" ]; then
    echo -e "  ${GREEN}View logs:${NC}"
    echo "    tail -f $LOGS_DIR/stdout.log"
    echo "    tail -f $LOGS_DIR/stderr.log"
    echo ""
    echo -e "  ${GREEN}Stop service:${NC}"
    echo "    launchctl unload $PLIST_PATH"
    echo ""
    echo -e "  ${GREEN}Start service:${NC}"
    echo "    launchctl load $PLIST_PATH"
    echo ""
    echo -e "  ${GREEN}Restart service:${NC}"
    echo "    launchctl unload $PLIST_PATH && launchctl load $PLIST_PATH"
    echo ""
    echo -e "  ${GREEN}Check status:${NC}"
    echo "    launchctl list | grep deskmate"
    echo ""
    echo -e "  ${GREEN}Restore default sleep settings:${NC}"
    echo "    sudo pmset -c sleep 1"
fi

if [ "$RUN_MODE" = "mcp" ] || [ "$RUN_MODE" = "both" ]; then
    echo ""
    echo -e "  ${GREEN}Test MCP server manually:${NC}"
    echo "    npm run start:mcp"
    echo ""
    echo -e "  ${GREEN}Claude Desktop config location:${NC}"
    echo "    $CLAUDE_DESKTOP_CONFIG"
fi

echo ""
echo -e "${YELLOW}Permissions reminder:${NC}"
echo "  If you skipped permissions setup or need to reconfigure:"
echo "  System Settings > Privacy & Security > [Screen Recording/Accessibility/Full Disk Access]"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
