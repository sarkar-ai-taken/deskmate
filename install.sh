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
    CYGWIN*|MINGW*|MSYS*) PLATFORM="windows" ;;
    *)
        echo -e "${RED}Unsupported platform: $OS_TYPE${NC}"
        echo "Deskmate supports macOS and Linux. On Windows, use WSL2."
        exit 1
        ;;
esac

# Configuration
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOGS_DIR="$PROJECT_DIR/logs"
NODE_PATH=$(which node)

# Platform-specific paths
if [ "$PLATFORM" = "macos" ]; then
    PLIST_NAME="com.deskmate.service"
    PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"
    CLAUDE_DESKTOP_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
elif [ "$PLATFORM" = "linux" ]; then
    SYSTEMD_SERVICE="deskmate.service"
    SYSTEMD_DIR="$HOME/.config/systemd/user"
    SYSTEMD_PATH="$SYSTEMD_DIR/$SYSTEMD_SERVICE"
    CLAUDE_DESKTOP_CONFIG="$HOME/.config/Claude/claude_desktop_config.json"
fi

# Helper: cross-platform sed -i
sed_inplace() {
    if [ "$PLATFORM" = "macos" ]; then
        sed -i '' "$@"
    else
        sed -i "$@"
    fi
}

echo -e "${BLUE}"
echo "╔════════════════════════════════════════╗"
echo "║     Deskmate Installer       ║"
echo "╚════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "Detected platform: ${GREEN}$PLATFORM${NC}"

if [ "$PLATFORM" = "windows" ]; then
    echo -e "${RED}Native Windows is not supported.${NC}"
    echo "Please use WSL2 (Windows Subsystem for Linux) to run Deskmate."
    echo ""
    echo "  1. Install WSL2: wsl --install"
    echo "  2. Open a WSL2 terminal"
    echo "  3. Re-run this installer from inside WSL2"
    exit 1
fi

# =============================================================================
# 1. Prerequisites
# =============================================================================
echo -e "${YELLOW}Checking prerequisites...${NC}"

if [ -z "$NODE_PATH" ]; then
    echo -e "${RED}Error: Node.js not found. Please install Node.js first.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Node.js found: $NODE_PATH${NC}"

# Check if Claude Code is installed (required for Agent SDK)
CLAUDE_PATH=$(which claude 2>/dev/null || echo "")
if [ -z "$CLAUDE_PATH" ]; then
    echo -e "${RED}Error: Claude Code CLI not found. Please install it first:${NC}"
    echo -e "${YELLOW}  curl -fsSL https://claude.ai/install.sh | bash${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Claude Code found: $CLAUDE_PATH${NC}"

# Linux: check for screenshot tool
if [ "$PLATFORM" = "linux" ]; then
    SCREENSHOT_TOOL=""
    if command -v import &>/dev/null; then
        SCREENSHOT_TOOL="import (ImageMagick)"
    elif command -v gnome-screenshot &>/dev/null; then
        SCREENSHOT_TOOL="gnome-screenshot"
    elif command -v scrot &>/dev/null; then
        SCREENSHOT_TOOL="scrot"
    fi

    if [ -n "$SCREENSHOT_TOOL" ]; then
        echo -e "${GREEN}✓ Screenshot tool found: $SCREENSHOT_TOOL${NC}"
    else
        echo -e "${YELLOW}Warning: No screenshot tool found. Install ImageMagick for screenshot support:${NC}"
        echo -e "${YELLOW}  sudo apt install imagemagick   # Debian/Ubuntu${NC}"
        echo -e "${YELLOW}  sudo dnf install ImageMagick   # Fedora${NC}"
        echo -e "${YELLOW}  sudo pacman -S imagemagick      # Arch${NC}"
    fi
fi

# =============================================================================
# 2. .env Configuration
# =============================================================================
echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Configuring environment...${NC}"
echo ""

CONFIGURE_ENV=true

if [ -f "$PROJECT_DIR/.env" ]; then
    echo -e "${GREEN}Found existing .env file.${NC}"
    read -p "Reconfigure? [y/N]: " RECONFIGURE
    if [ "$RECONFIGURE" != "y" ] && [ "$RECONFIGURE" != "Y" ]; then
        CONFIGURE_ENV=false
        echo -e "${GREEN}✓ Keeping existing .env${NC}"
    fi
fi

if [ "$CONFIGURE_ENV" = true ]; then
    echo ""
    echo -e "${YELLOW}Enter your credentials (press Enter to skip optional fields):${NC}"
    echo ""

    read -p "  Anthropic API Key: " ANTHROPIC_API_KEY
    if [ -z "$ANTHROPIC_API_KEY" ]; then
        echo -e "  ${RED}Warning: No API key entered. You'll need to set ANTHROPIC_API_KEY in .env later.${NC}"
    fi

    echo ""
    echo -e "  ${BLUE}Telegram setup — get these from Telegram:${NC}"
    echo -e "  Bot token → message @BotFather, send /newbot"
    echo -e "  User ID   → message @userinfobot, copy the number"
    echo ""

    read -p "  Telegram Bot Token (from @BotFather): " TELEGRAM_BOT_TOKEN
    read -p "  Telegram User ID (from @userinfobot): " TELEGRAM_USER_ID

    echo ""
    read -p "  Working directory (default: $HOME): " WORKING_DIR
    WORKING_DIR=${WORKING_DIR:-$HOME}

    read -p "  Bot name (default: Deskmate): " BOT_NAME
    BOT_NAME=${BOT_NAME:-Deskmate}

    # Write .env
    cat > "$PROJECT_DIR/.env" << EOF
# Deskmate Configuration (generated by install.sh)

TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
ALLOWED_USER_ID=${TELEGRAM_USER_ID}
ALLOWED_USERS=telegram:${TELEGRAM_USER_ID}
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
AGENT_PROVIDER=claude-code
WORKING_DIR=${WORKING_DIR}
BOT_NAME=${BOT_NAME}
LOG_LEVEL=info
REQUIRE_APPROVAL_FOR_ALL=false
EOF

    echo -e "\n${GREEN}✓ .env file written${NC}"
fi

# =============================================================================
# 3. Build
# =============================================================================
echo -e "\n${YELLOW}Building project...${NC}"
cd "$PROJECT_DIR"
npm install --legacy-peer-deps
npm run build
echo -e "${GREEN}✓ Build complete${NC}"

# Create logs directory
mkdir -p "$LOGS_DIR"
echo -e "${GREEN}✓ Logs directory created: $LOGS_DIR${NC}"

# =============================================================================
# 4. macOS Permissions Setup (macOS only)
# =============================================================================
if [ "$PLATFORM" = "macos" ]; then
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
fi

# =============================================================================
# 5. Folder Access Configuration (macOS only — Linux doesn't have TCC dialogs)
# =============================================================================
if [ "$PLATFORM" = "macos" ]; then
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
            sed_inplace "s|^ALLOWED_FOLDERS=.*|ALLOWED_FOLDERS=$FOLDERS_TO_CONFIGURE|" "$PROJECT_DIR/.env"
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
fi

# =============================================================================
# 6. Mode Selection
# =============================================================================
echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Which mode would you like to install?${NC}"
echo ""
echo -e "  ${GREEN}1)${NC} Gateway (recommended)"
echo "     Multi-client gateway with Telegram"
echo ""
echo -e "  ${GREEN}2)${NC} MCP only"
echo "     Expose as MCP server for Claude Desktop"
echo ""
echo -e "  ${GREEN}3)${NC} Both"
echo "     Gateway + MCP server together"
echo ""
read -p "Choose mode [1/2/3] (default: 1): " MODE_CHOICE
MODE_CHOICE=${MODE_CHOICE:-1}

case $MODE_CHOICE in
    2)
        RUN_MODE="mcp"
        echo -e "${GREEN}✓ MCP mode selected${NC}"
        ;;
    3)
        RUN_MODE="both"
        echo -e "${GREEN}✓ Both modes selected${NC}"
        ;;
    *)
        RUN_MODE="gateway"
        echo -e "${GREEN}✓ Gateway mode selected${NC}"
        ;;
esac

# MCP Configuration for Claude Desktop - auto-configure when MCP mode is selected
CONFIGURE_CLAUDE_DESKTOP=false
if [ "$RUN_MODE" = "mcp" ] || [ "$RUN_MODE" = "both" ]; then
    CONFIGURE_CLAUDE_DESKTOP=true
    echo -e "${GREEN}✓ Will configure Claude Desktop for MCP${NC}"
fi

# =============================================================================
# 7. Sleep Prevention (for gateway/both modes)
# =============================================================================
if [ "$RUN_MODE" = "gateway" ] || [ "$RUN_MODE" = "both" ]; then
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Configuring system sleep settings...${NC}"

    USE_CAFFEINATE=false

    if [ "$PLATFORM" = "macos" ]; then
        echo -e "${YELLOW}This requires sudo access to modify power management settings.${NC}"
        sudo pmset -c sleep 0 displaysleep 10
        echo -e "${GREEN}✓ System configured: sleep disabled when plugged in, display sleeps after 10 min${NC}"

        # Ask if user also wants caffeinate as extra protection
        echo ""
        echo -e "${YELLOW}Optional: Also use caffeinate for extra protection?${NC}"
        echo "  This adds an extra layer - prevents sleep specifically while the service runs."
        echo ""
        read -p "Enable caffeinate? [y/N]: " ENABLE_CAFFEINATE

        if [ "$ENABLE_CAFFEINATE" = "y" ] || [ "$ENABLE_CAFFEINATE" = "Y" ]; then
            USE_CAFFEINATE=true
            echo -e "${GREEN}✓ Caffeinate enabled${NC}"
        else
            echo -e "${GREEN}✓ Using system settings only${NC}"
        fi
    elif [ "$PLATFORM" = "linux" ]; then
        echo -e "${YELLOW}On Linux, sleep prevention depends on your desktop environment.${NC}"
        echo -e "  You can use ${GREEN}systemd-inhibit${NC} to prevent sleep while the service runs."
        echo -e "  The systemd service will be configured with the Idle inhibitor."
        echo -e "${GREEN}✓ Sleep prevention will be handled by the systemd service${NC}"
    fi
fi

# =============================================================================
# 8. Service Installation (platform-specific)
# =============================================================================

if [ "$PLATFORM" = "macos" ]; then
    # ── macOS: launchd ──────────────────────────────────────────────────

    # Unload existing service if present
    if launchctl list 2>/dev/null | grep -q "$PLIST_NAME"; then
        echo -e "\n${YELLOW}Stopping existing service...${NC}"
        launchctl unload "$PLIST_PATH" 2>/dev/null || true
        echo -e "${GREEN}✓ Existing service stopped${NC}"
    fi

    # Create the launchd plist file (for gateway or both modes)
    if [ "$RUN_MODE" = "gateway" ] || [ "$RUN_MODE" = "both" ]; then
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

elif [ "$PLATFORM" = "linux" ]; then
    # ── Linux: systemd user service ─────────────────────────────────────

    # Stop existing service if present
    if systemctl --user is-active "$SYSTEMD_SERVICE" &>/dev/null; then
        echo -e "\n${YELLOW}Stopping existing service...${NC}"
        systemctl --user stop "$SYSTEMD_SERVICE" 2>/dev/null || true
        echo -e "${GREEN}✓ Existing service stopped${NC}"
    fi

    # Create the systemd user service (for gateway or both modes)
    if [ "$RUN_MODE" = "gateway" ] || [ "$RUN_MODE" = "both" ]; then
        echo -e "\n${YELLOW}Creating systemd user service...${NC}"

        mkdir -p "$SYSTEMD_DIR"
        cat > "$SYSTEMD_PATH" << EOF
[Unit]
Description=Deskmate - Local Machine Assistant
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$NODE_PATH $PROJECT_DIR/dist/index.js $RUN_MODE
WorkingDirectory=$PROJECT_DIR
Environment=PATH=/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin
Restart=always
RestartSec=5

# Prevent system sleep while running
InhibitDelayMaxSec=5

StandardOutput=append:$LOGS_DIR/stdout.log
StandardError=append:$LOGS_DIR/stderr.log

[Install]
WantedBy=default.target
EOF

        echo -e "${GREEN}✓ Service configuration created${NC}"

        # Reload and start the service
        echo -e "\n${YELLOW}Starting service...${NC}"
        systemctl --user daemon-reload
        systemctl --user enable "$SYSTEMD_SERVICE"
        systemctl --user start "$SYSTEMD_SERVICE"
        sleep 2

        # Check if service is running
        if systemctl --user is-active "$SYSTEMD_SERVICE" &>/dev/null; then
            echo -e "${GREEN}✓ Service started successfully${NC}"
        else
            echo -e "${RED}✗ Service failed to start. Check logs:${NC}"
            echo -e "  journalctl --user -u $SYSTEMD_SERVICE -f"
            echo -e "  tail -f $LOGS_DIR/stderr.log"
            exit 1
        fi

        # Enable lingering so the user service runs without an active login session
        if command -v loginctl &>/dev/null; then
            loginctl enable-linger "$(whoami)" 2>/dev/null || true
            echo -e "${GREEN}✓ Lingering enabled (service runs without active login)${NC}"
        fi
    fi
fi

# =============================================================================
# 9. Claude Desktop MCP Config
# =============================================================================
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

# =============================================================================
# 10. Summary
# =============================================================================
echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Installation complete!${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

case $RUN_MODE in
    gateway)
        echo -e "Your gateway is now running as a background service."
        echo -e "Telegram client is active — open Telegram and message your bot."
        ;;
    mcp)
        echo -e "MCP server configured for Claude Desktop."
        echo -e "Claude Desktop will start the MCP server on demand."
        ;;
    both)
        echo -e "Both gateway and MCP server are configured!"
        echo -e "• Gateway: Running as background service (Telegram active)"
        echo -e "• MCP server: Available to Claude Desktop"
        ;;
esac

echo ""
echo -e "${YELLOW}Useful commands:${NC}"

if [ "$RUN_MODE" = "gateway" ] || [ "$RUN_MODE" = "both" ]; then
    echo -e "  ${GREEN}View logs:${NC}"
    echo "    tail -f $LOGS_DIR/stdout.log"
    echo "    tail -f $LOGS_DIR/stderr.log"
    echo ""

    if [ "$PLATFORM" = "macos" ]; then
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
    elif [ "$PLATFORM" = "linux" ]; then
        echo -e "  ${GREEN}Stop service:${NC}"
        echo "    systemctl --user stop $SYSTEMD_SERVICE"
        echo ""
        echo -e "  ${GREEN}Start service:${NC}"
        echo "    systemctl --user start $SYSTEMD_SERVICE"
        echo ""
        echo -e "  ${GREEN}Restart service:${NC}"
        echo "    systemctl --user restart $SYSTEMD_SERVICE"
        echo ""
        echo -e "  ${GREEN}Check status:${NC}"
        echo "    systemctl --user status $SYSTEMD_SERVICE"
        echo ""
        echo -e "  ${GREEN}View journal logs:${NC}"
        echo "    journalctl --user -u $SYSTEMD_SERVICE -f"
    fi
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
echo -e "  ${GREEN}Reconfigure:${NC}"
echo "    deskmate init"
echo ""

if [ "$PLATFORM" = "macos" ]; then
    echo -e "${YELLOW}Permissions reminder:${NC}"
    echo "  If you skipped permissions setup or need to reconfigure:"
    echo "  System Settings > Privacy & Security > [Screen Recording/Accessibility/Full Disk Access]"
    echo ""
fi

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
