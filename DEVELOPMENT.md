# Development Guide

This document covers the architecture, local setup, and development workflow for Deskmate.

## Architecture

```
deskmate/
├── src/
│   ├── index.ts              # Entry point - mode selection (telegram/mcp/both/gateway)
│   ├── cli.ts                # CLI entry point (deskmate command)
│   ├── cli/
│   │   └── init.ts           # Interactive setup wizard (deskmate init)
│   ├── gateway/
│   │   ├── gateway.ts        # Central coordinator
│   │   ├── security.ts       # Multi-client allowlist auth
│   │   ├── session.ts        # Session manager (composite keys, idle pruning)
│   │   ├── types.ts          # MessagingClient, MessageHandler interfaces
│   │   └── index.ts          # Gateway barrel export
│   ├── clients/
│   │   └── telegram.ts       # Telegram adapter (grammY) for gateway
│   ├── telegram/
│   │   └── bot.ts            # Legacy standalone Telegram bot
│   ├── mcp/
│   │   └── server.ts         # MCP server for Claude Desktop
│   └── core/
│       ├── agent/
│       │   ├── types.ts      # AgentProvider interface
│       │   ├── factory.ts    # Provider factory + registerProvider()
│       │   ├── index.ts      # Agent barrel export
│       │   └── providers/
│       │       └── claude-code.ts  # Claude Code SDK (default)
│       ├── platform.ts       # Cross-platform helpers (screenshots, protected folders)
│       ├── executor.ts       # Command/file execution utilities
│       ├── approval.ts       # Approval workflow manager
│       └── logger.ts         # Structured logging utility
├── dist/                     # Compiled JavaScript (generated)
├── logs/                     # Runtime logs (generated)
├── install.sh                # Cross-platform service installer (alternative to deskmate init)
├── uninstall.sh              # Cross-platform service uninstaller
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
│ Claude Desktop  │                    │ deskmate │
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
# macOS
brew install node
# Linux (Debian/Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
# Windows — use WSL2, then follow the Linux instructions above

# Install Claude Code CLI (required for Agent SDK)
curl -fsSL https://claude.ai/install.sh | bash
```

### Setup

```bash
# Clone and install
git clone https://github.com/sarkar-ai-taken/deskmate.git
cd deskmate
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

### Adding a new Agent Provider

The project uses an abstracted agent system. To add a new AI backend:

1. **Create the provider file** in `src/core/agent/providers/`:

```typescript
// src/core/agent/providers/my-provider.ts
import {
  AgentProvider,
  AgentResponse,
  AgentStreamEvent,
  AgentQueryOptions,
} from "../types";

export class MyProvider implements AgentProvider {
  readonly name = "my-provider";
  readonly version = "1.0.0";

  async query(prompt: string, options?: AgentQueryOptions): Promise<AgentResponse> {
    // Implement non-streaming query
  }

  async *queryStream(
    prompt: string,
    options?: AgentQueryOptions
  ): AsyncGenerator<AgentStreamEvent, void, unknown> {
    // Implement streaming query
    yield { type: "thinking" };

    // Your AI logic here...

    yield { type: "text", text: "Response text" };
    yield { type: "done", response: { text: "Final response" } };
  }

  async isAvailable(): Promise<boolean> {
    // Check if provider is configured correctly
    return true;
  }
}
```

2. **Register the provider** in `src/core/agent/factory.ts`:

```typescript
import { MyProvider } from "./providers/my-provider";

const providerRegistry: Map<AgentProviderType, new () => AgentProvider> = new Map([
  ["claude-code", ClaudeCodeProvider],
  ["my-provider", MyProvider],  // Add your provider
]);
```

3. **Update types** if needed in `src/core/agent/types.ts`:

```typescript
export type AgentProviderType = "claude-code" | "my-provider" | ...;
```

4. **Use it** by setting the environment variable:

```bash
AGENT_PROVIDER=my-provider npm start
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | - | Telegram bot token |
| `ALLOWED_USER_ID` | Yes | - | Authorized Telegram user ID |
| `ANTHROPIC_API_KEY` | Yes | - | Anthropic API key |
| `AGENT_PROVIDER` | No | `claude-code` | AI provider to use (claude-code, openai, ollama, etc.) |
| `WORKING_DIR` | No | `$HOME` | Default working directory |
| `LOG_LEVEL` | No | `info` | Logging verbosity |
| `BOT_NAME` | No | `Deskmate` | Bot display name |
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
5. Verify npm package: `npm pack` — inspect the tarball contents
6. Publish to npm: `npm publish`
7. Create git tag: `git tag v1.x.x`
8. Push with tags: `git push --tags`
