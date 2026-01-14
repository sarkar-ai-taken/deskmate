# Development Guide

This document covers the architecture, local setup, and development workflow for Sarkar Local Agent.

## Architecture

```
sarkar-local-agent/
├── src/
│   ├── index.ts              # Entry point - mode selection (telegram/mcp/both)
│   ├── telegram/
│   │   └── bot.ts            # Telegram bot using Claude Agent SDK
│   ├── mcp/
│   │   └── server.ts         # MCP server for Claude Desktop
│   └── core/
│       ├── executor.ts       # Command/file execution utilities
│       ├── approval.ts       # Approval workflow manager
│       └── logger.ts         # Structured logging utility
├── dist/                     # Compiled JavaScript (generated)
├── logs/                     # Runtime logs (generated)
├── install.sh                # macOS service installer
├── uninstall.sh              # macOS service uninstaller
└── .env                      # Configuration (not committed)
```

## Core Components

### Telegram Bot (`src/telegram/bot.ts`)

The main interface for users. Uses the Claude Agent SDK to process natural language requests.

**Key features:**
- Session management for conversation memory
- User authentication via Telegram user ID
- Approval notifications for MCP requests

**Flow:**
```
User Message → Claude Agent SDK → Tool Execution → Response
                     ↓
              Session stored for context
```

### MCP Server (`src/mcp/server.ts`)

Implements the [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) to expose your local machine as a tool server. Any MCP-compatible client (like Claude Desktop) can connect and use these tools.

**How MCP works:**
```
┌─────────────────┐                    ┌─────────────────┐
│ Claude Desktop  │                    │ sarkar-local-agent │
│ (MCP Client)    │                    │ (MCP Server)    │
│                 │   stdio transport  │                 │
│  "List files"   │ ─────────────────▶ │ list_directory  │
│                 │ ◀───────────────── │ [file1, file2]  │
└─────────────────┘                    └─────────────────┘
```

**Communication:** Uses stdio (stdin/stdout) - Claude Desktop spawns the process and communicates via JSON-RPC over stdio. No network ports are opened.

**Available tools:**
| Tool | Description |
|------|-------------|
| `execute_command` | Run shell commands (auto-approves safe commands like `ls`, `git status`) |
| `read_file` | Read file contents |
| `write_file` | Write to files (requires approval via Telegram if running in "both" mode) |
| `list_directory` | List directory contents |
| `get_system_info` | Get system information (hostname, platform, etc.) |
| `list_pending_approvals` | Show pending approval requests |

**Auto-approval:** Safe read-only commands are auto-approved. Dangerous commands (like `rm`, file writes) require explicit approval.

### Executor (`src/core/executor.ts`)

Handles all file system and command operations with built-in logging.

### Approval Manager (`src/core/approval.ts`)

Manages approval workflow for sensitive operations:
- Tracks pending approvals
- Supports auto-approval for safe commands
- Emits events for notifications
- Handles timeouts

### Logger (`src/core/logger.ts`)

Structured logging with configurable levels:
- `debug` - Verbose output
- `info` - Standard operations
- `warn` - Warnings
- `error` - Errors only
- `silent` - No output

## Local Development

### Prerequisites

```bash
# Install Node.js 18+
brew install node

# Install Claude Code CLI (required for Agent SDK)
curl -fsSL https://claude.ai/install.sh | bash
```

### Setup

```bash
# Clone and install
git clone https://github.com/sarkar-ai-taken/sarkar-local-agent.git
cd sarkar-local-agent
npm install --legacy-peer-deps

# Configure
cp .env.example .env
# Edit .env with your credentials

# Build
npm run build
```

### Development Commands

```bash
# Run with hot reload (Telegram mode)
npm run dev

# Run with hot reload (MCP mode)
npm run dev:mcp

# Build TypeScript
npm run build

# Run production (Telegram)
npm start

# Run production (MCP)
npm run start:mcp

# Run both modes
npm run start:both
```

### Testing Changes

1. **Telegram Bot**: Run `npm run dev` and test via Telegram
2. **MCP Server**: Configure Claude Desktop to use your local build
3. **Logging**: Set `LOG_LEVEL=debug` in `.env` for verbose output

## Code Style

- TypeScript strict mode
- ES modules
- Async/await for all I/O
- Structured logging (not console.log)

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `@anthropic-ai/claude-agent-sdk` | AI agent capabilities |
| `grammy` | Telegram bot framework |
| `@modelcontextprotocol/sdk` | MCP server implementation |
| `dotenv` | Environment configuration |
| `zod` | Schema validation |

## Adding New Features

### Adding a new Telegram command

```typescript
// In src/telegram/bot.ts
bot.command("mycommand", async (ctx) => {
  // Your logic here
  await ctx.reply("Response");
});
```

### Adding a new MCP tool

```typescript
// In src/mcp/server.ts
server.tool(
  "my_tool",
  "Description of what it does",
  {
    param: z.string().describe("Parameter description"),
  },
  async ({ param }) => {
    // Your logic here
    return {
      content: [{ type: "text" as const, text: "Result" }],
    };
  }
);
```

### Adding logging to a component

```typescript
import { createLogger } from "../core/logger";

const log = createLogger("MyComponent");

log.info("Operation started", { key: "value" });
log.debug("Detailed info", { data });
log.error("Something failed", { error: err.message });
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | - | Telegram bot token |
| `ALLOWED_USER_ID` | Yes | - | Authorized Telegram user ID |
| `ANTHROPIC_API_KEY` | Yes | - | Anthropic API key |
| `WORKING_DIR` | No | `$HOME` | Default working directory |
| `LOG_LEVEL` | No | `info` | Logging verbosity |
| `BOT_NAME` | No | `Sarkar Local Agent` | Bot display name |
| `ALLOWED_FOLDERS` | No | - | Colon-separated list of folders the agent can access |
| `REQUIRE_APPROVAL_FOR_ALL` | No | `false` | Require Telegram approval for ALL operations |

## Debugging

### View logs

```bash
# Real-time logs
tail -f logs/stdout.log
tail -f logs/stderr.log

# With debug level
LOG_LEVEL=debug npm run dev
```

### Common issues

**"Claude Code CLI not found"**
```bash
# Install Claude Code
curl -fsSL https://claude.ai/install.sh | bash
# Verify
which claude
```

**"Session not found" errors**
- Sessions expire or become invalid
- The bot auto-clears invalid sessions
- Use `/reset` to manually clear

**TypeScript errors after dependency update**
```bash
rm -rf node_modules dist
npm install --legacy-peer-deps
npm run build
```

## Release Process

1. Update version in `package.json`
2. Update CHANGELOG (if exists)
3. Run full build: `npm run build`
4. Test both Telegram and MCP modes
5. Create git tag: `git tag v1.x.x`
6. Push with tags: `git push --tags`
