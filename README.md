# Deskmate

Control your Mac from anywhere using natural language via Telegram or MCP.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](#requirements)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](#requirements)

## What is this?

Deskmate lets you control your Mac remotely through two interfaces:

1. **Telegram Bot** - Chat with your Mac from anywhere using natural language
2. **MCP Server** - Expose your Mac as a tool server for Claude Desktop or any MCP client

Powered by the [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/agent-sdk), it understands what you want to do and executes the appropriate commands.

### Telegram Mode
```
┌─────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ You (phone) │────▶│ Telegram Cloud  │◀────│ Your Mac (bot)  │
│  anywhere   │     │                 │     │ executes tasks  │
└─────────────┘     └─────────────────┘     └─────────────────┘
```

### MCP Server Mode
```
┌─────────────────┐     stdio      ┌─────────────────┐
│ Claude Desktop  │◀─────────────▶│ Your Mac        │
│ (or MCP client) │               │ (MCP server)    │
└─────────────────┘               └─────────────────┘
```

**Example conversation:**
```
You: What's using port 3000?
Bot: Port 3000 is being used by node (PID 12345) running your Next.js dev server.

You: Kill it
Bot: Done. Process 12345 has been terminated.

You: Now start the production build
Bot: Running npm run build... Build completed successfully.
```

## Features

- **Natural Language** - Just describe what you want, no need to remember exact commands
- **Conversation Memory** - Claude remembers context, so you can ask follow-up questions
- **Secure** - Only responds to your Telegram user ID
- **Runs as Service** - Starts on boot, restarts on crash
- **MCP Support** - Can also run as an MCP server for Claude Desktop integration

## Requirements

- macOS (tested on Ventura and Sonoma)
- Node.js 18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed
- Telegram account
- Anthropic API key

### macOS Permissions

The agent requires these permissions to function fully (the installer will guide you through setup):

| Permission | Purpose |
|------------|---------|
| **Screen Recording** | Take screenshots when requested |
| **Accessibility** | Control system functions |
| **Full Disk Access** | Read/write files in protected locations |
| **Automation** | Control other applications via AppleScript |
| **Background Items** | Run as a background service at login |
| **Folder Access** | Access to Desktop, Documents, Downloads, etc. |

You can configure these in **System Settings > Privacy & Security**.

The installer will guide you through granting access to specific folders (Desktop, Documents, Downloads, etc.) and trigger the macOS permission dialogs automatically.

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/deskmate-ai/deskmate.git
cd deskmate
```

### 2. Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the bot token (looks like `123456789:ABCdefGHI...`)

### 3. Get your Telegram User ID

1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. It will reply with your user ID (a number like `123456789`)

### 4. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:
```bash
TELEGRAM_BOT_TOKEN=your_bot_token_here
ALLOWED_USER_ID=your_telegram_user_id
ANTHROPIC_API_KEY=your_anthropic_api_key
WORKING_DIR=/Users/yourusername  # Default directory for commands
LOG_LEVEL=info                   # debug, info, warn, error, silent
BOT_NAME=Deskmate             # Optional: customize the bot's name
```

### 5. Install and run

**Option A: Run as background service (recommended)**
```bash
./install.sh
```

This will:
- Install dependencies and build the project
- Configure macOS to prevent sleep when plugged in
- Set up a launchd service that starts on boot
- Start the bot immediately

**Option B: Run manually**
```bash
npm install --legacy-peer-deps
npm run build
npm start
```

### 6. Start chatting!

Open Telegram, find your bot, and send `/start`.

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Show welcome message |
| `/screenshot` | Take a screenshot and send it |
| `/status` | Show system info and session status |
| `/reset` | Clear conversation memory and start fresh |

## Usage Examples

**System Management:**
- "Show disk usage"
- "What processes are using the most CPU?"
- "List all running Docker containers"

**File Operations:**
- "Show me the contents of package.json"
- "Find all TypeScript files in src/"
- "Create a new file called notes.txt with today's date"

**Development:**
- "Run the tests"
- "What's the git status?"
- "Show me recent commits"

**Troubleshooting:**
- "What's using port 8080?"
- "Show me the last 50 lines of the error log"
- "Check if nginx is running"

**Visual:**
- "Take a screenshot"
- "Show me what's on the screen"

## Running Modes

| Mode | Command | Description |
|------|---------|-------------|
| Telegram | `npm start` | Telegram bot only |
| MCP | `npm run start:mcp` | MCP server for Claude Desktop |
| Both | `npm run start:both` | Both simultaneously |

## MCP Server

The MCP (Model Context Protocol) server exposes your local machine as a tool server that any MCP-compatible client can use. This allows Claude Desktop (or other MCP clients) to execute commands, read/write files, and manage your system.

### MCP Tools Exposed

| Tool | Description |
|------|-------------|
| `execute_command` | Run any shell command on your Mac |
| `read_file` | Read contents of any file |
| `write_file` | Write content to a file (with approval) |
| `list_directory` | List files and folders in a directory |
| `get_system_info` | Get system information (hostname, platform, etc.) |
| `list_pending_approvals` | Show actions waiting for approval |

### Setup with Claude Desktop

1. Build the project:
   ```bash
   npm install --legacy-peer-deps
   npm run build
   ```

2. Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "deskmate": {
         "command": "node",
         "args": ["/path/to/deskmate/dist/index.js", "mcp"],
         "env": {
           "WORKING_DIR": "/Users/yourname"
         }
       }
     }
   }
   ```

3. Restart Claude Desktop

4. You can now ask Claude to interact with your local machine:
   - "List the files in my Documents folder"
   - "Show me the contents of ~/.zshrc"
   - "Run `git status` in my project directory"

### Combined Mode (MCP + Telegram)

Run both modes together with `npm run start:both`. In this mode:
- MCP server handles requests from Claude Desktop
- Telegram bot sends approval notifications to your phone
- You can approve sensitive operations (like file writes) from anywhere

## Service Management

```bash
# View logs
tail -f logs/stdout.log
tail -f logs/stderr.log

# Stop the service
launchctl unload ~/Library/LaunchAgents/com.deskmate.service.plist

# Start the service
launchctl load ~/Library/LaunchAgents/com.deskmate.service.plist

# Check status
launchctl list | grep deskmate

# Uninstall completely
./uninstall.sh
```

## Security Considerations

> **Warning**: This bot can execute arbitrary commands on your machine. Please understand the risks.

**Built-in protections:**
- **User Authentication** - Only the Telegram user ID in `ALLOWED_USER_ID` can interact
- **No sudo by default** - The bot won't use sudo unless you explicitly ask
- **No open ports** - The bot polls Telegram's servers, doesn't expose any ports
- **Structured logging** - All actions are logged for audit

**Recommendations:**
- Use a dedicated Telegram account for the bot
- Regularly review the logs (`logs/stdout.log`)
- Set `WORKING_DIR` to limit command scope
- Keep your `.env` file secure and never commit it

## Troubleshooting

**Bot not responding?**
1. Check logs: `tail -f logs/stderr.log`
2. Verify your `ALLOWED_USER_ID` matches your Telegram ID
3. Ensure Claude Code CLI is installed: `which claude`

**Commands timing out?**
- Default timeout is 2 minutes
- Long-running commands may need adjustment

**Mac going to sleep?**
- Run `./install.sh` to configure sleep prevention
- Or manually: `sudo pmset -c sleep 0`

**Permission denied errors?**
- Re-run `./install.sh` and go through the permissions setup
- Or manually grant permissions in System Settings > Privacy & Security
- Make sure to add both your terminal app AND `deskmate` to the lists

**Screenshots not working?**
- Grant Screen Recording permission in System Settings > Privacy & Security > Screen Recording
- You may need to restart the service after granting permission

## Architecture

The project uses an **abstracted agent provider** system, making it easy to swap AI backends:

```
src/core/agent/
├── types.ts              # AgentProvider interface
├── factory.ts            # Provider factory
├── index.ts              # Exports
└── providers/
    └── claude-code.ts    # Claude Code implementation
```

**Current provider:** Claude Code (via `@anthropic-ai/claude-agent-sdk`)

To use a different provider, set the `AGENT_PROVIDER` environment variable or implement a new provider (see Contributing).

## Future Work / Help Wanted

We're looking for community contributions in these areas:

**1. Additional Agent Providers**
The codebase is designed to support multiple AI backends. We'd love help implementing:
- `openai` - OpenAI GPT-4 with function calling
- `anthropic-direct` - Direct Anthropic API (without Claude Code)
- `ollama` - Local LLMs via Ollama
- `langchain` - LangChain-based agents

See `src/core/agent/providers/` for implementation examples.

**2. More Efficient Background Job Handling**
- The current `launchd` + `caffeinate` approach works but may not be optimal
- Looking for better approaches for different device types (always-on Mac Mini vs MacBook)
- Cross-platform support (Linux systemd, Windows services)

If you're interested in tackling any of these, please open an issue to discuss your approach!

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for architecture details and local setup.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- Built with [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/agent-sdk)
- Telegram integration via [grammY](https://grammy.dev/)
- MCP support via [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk)
