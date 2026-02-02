# Deskmate

Control your Local Machine from anywhere using natural language.

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="#requirements"><img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20WSL2-lightgrey.svg?style=for-the-badge" alt="Platform"></a>
  <a href="#requirements"><img src="https://img.shields.io/badge/node-%3E%3D18-green.svg?style=for-the-badge" alt="Node"></a>
</p>

Deskmate is a local execution agent that lets you control your personal machine using natural language and talks to you on the channels you already use. Deskmate focuses on execution, not autonomy or orchestration. Send a Telegram message from your phone, and it executes on your machine. Powered by the [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/agent-sdk) with full local tool access — no sandboxed command set, no artificial limits.

A passion project developed, born from a simple goal: staying in creative and developer flow even when I'm not sitting at my desk. Inspired by [gen-shell](https://github.com/sarkarsaurabh27/gen-shell).

[Getting Started](#quick-start) · [Gateway Mode](#gateway-mode) · [Architecture](#architecture) · [Contributing](#contributing)

---

## Demo

<p align="center">
  <img src="assets/deskmate-screenshot.jpeg" alt="Deskmate Screenshot" width="500">
</p>

| Telegram Conversation | Installation |
|:---:|:---:|
| ![Telegram Demo](assets/deskmate-tg.gif) | ![Installation Demo](assets/deskmate-install.gif) |

## How it works

```
Telegram / Discord* / Slack* / ...
            |
            v
  +-------------------+
  |      Gateway      |    auth, sessions, approval routing
  |  (control plane)  |
  +--------+----------+
           |
           v
  +-------------------+
  |   Claude Code     |    full local tool access (Bash, Read, Write, Edit, ...)
  |   Agent (SDK)     |
  +-------------------+
           |
           v
     Your Machine
     (executes tasks)
```
*Discord and Slack adapters are planned — see [Adding a new client](#adding-a-new-client).

The Gateway is the control plane. Each messaging platform is a thin I/O adapter. The agent has unrestricted access to your machine (approve-by-default), with optional approval gating for protected folders.

## Responsibility Boundary

Deskmate’s responsibility is **execution**.

- It turns intent into concrete system actions
- It does not coordinate other agents
- It does not monitor agent health or resource usage

If you want visibility into what agents are doing on your machine,
see **Riva**, the local observability layer.

## Highlights

- **Full local access** — the agent can run any command, read/write any file, take screenshots. No artificial 6-tool sandbox.
- **Multi-channel gateway** — Telegram today, Discord/Slack/WhatsApp tomorrow. One Gateway, many clients.
- **Conversation memory** — session continuity across messages. Ask follow-up questions naturally.
- **Extensible model layer** — Claude Code agent supports any provider that speaks the Anthropic Messages API (including [Ollama](https://ollama.com) for local models). See [Claude Code docs](https://docs.anthropic.com/en/docs/claude-code) for model configuration.
- **Approve-by-default** — safe commands auto-approve. Protected folders (Desktop, Documents, etc.) prompt for confirmation via inline buttons.
- **MCP server** — expose your machine as a tool server for Claude Desktop or any MCP client.
- **Runs as service** — launchd (macOS) or systemd (Linux) integration, starts on boot, restarts on crash.
- **Extensible agent layer** — ships with Claude Code agent. Bring your own via `registerProvider()`.

## Requirements

- **macOS** (tested on Ventura, Sonoma, Sequoia) or **Linux** (with systemd)
- Windows via [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install)
- Node.js 18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed (`which claude`)
- Telegram account (for Telegram mode)
- Anthropic API key (or configure Claude Code CLI for [alternative providers](https://docs.anthropic.com/en/docs/claude-code))

### Linux Prerequisites

- **Screenshots:** Install [ImageMagick](https://imagemagick.org/) (`sudo apt install imagemagick`) for screenshot support
- **Service:** systemd with user session support (`systemctl --user`)

### macOS Permissions

The installer guides you through these (macOS only). You can also configure them manually in **System Settings > Privacy & Security**.

| Permission | Purpose |
|------------|---------|
| **Screen Recording** | Take screenshots when requested |
| **Accessibility** | Control system functions |
| **Full Disk Access** | Read/write files in protected locations |
| **Automation** | Control other applications via AppleScript |
| **Background Items** | Run as a background service at login |
| **Folder Access** | Access to Desktop, Documents, Downloads, etc. |

## Quick Start

### Option A: Install from npm (recommended)

```bash
npm install -g @sarkar-ai/deskmate
deskmate init
```

The wizard walks you through everything: API keys, Telegram credentials,
platform permissions, and background service setup. Config is stored in
`~/.config/deskmate/.env`.

After setup, run manually with `deskmate` or let the background service handle it.

### Option B: Install from source (for contributors)

```bash
git clone https://github.com/sarkar-ai-taken/deskmate.git
cd deskmate
npm install --legacy-peer-deps
npm run build
./install.sh          # interactive: configures .env, service, permissions
```

Or use the TypeScript wizard instead of the shell installer:

```bash
cp .env.example .env  # edit with your credentials
npx deskmate init     # or: npm link && deskmate init
```

To reconfigure later: `deskmate init`

## Running Modes

| Mode | Command | Description |
|------|---------|-------------|
| Gateway | `deskmate` | Multi-client gateway (default) |
| MCP | `deskmate mcp` | MCP server for Claude Desktop |
| Both | `deskmate both` | Gateway + MCP simultaneously |

> **Note:** `deskmate telegram` still works but is a deprecated alias that starts the gateway.

## Gateway Mode

The gateway is the default way to run Deskmate. It separates platform I/O from agent logic, so adding a new messaging client doesn't require touching auth, sessions, or the agent layer.

```bash
# Configure multi-client auth
ALLOWED_USERS=telegram:123456,discord:987654321

# Start
deskmate
```

The gateway auto-registers clients based on available env vars. If `TELEGRAM_BOT_TOKEN` is set, Telegram is active. Future clients (Discord, Slack) follow the same pattern.

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Show welcome message |
| `/screenshot` | Take a screenshot and send it |
| `/status` | Show system info and session status |
| `/reset` | Clear conversation memory and start fresh |

## Usage Examples

**System management** — "Show disk usage", "What processes are using the most CPU?", "List all running Docker containers"

**File operations** — "Show me the contents of package.json", "Find all TypeScript files in src/", "Create a new file called notes.txt with today's date"

**Development** — "Run the tests", "What's the git status?", "Show me recent commits"

**Troubleshooting** — "What's using port 8080?", "Show me the last 50 lines of the error log", "Check if nginx is running"

**Visual** — "Take a screenshot", "Show me what's on the screen"

| Taking a Screenshot | Opening Google Meet |
|:---:|:---:|
| ![Screenshot Demo](assets/deskmate-screenshot.jpeg) | ![Google Meet Demo](assets/deskmate-video-call.jpeg) |

## MCP Server

The MCP server exposes your machine as a tool server for Claude Desktop or any MCP client.

### Setup with Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

Restart Claude Desktop. You can now ask Claude to interact with your local machine.

### Combined Mode (Gateway + MCP)

Run both with `deskmate both`. MCP handles Claude Desktop requests; the gateway handles Telegram (and future clients), sending approval notifications to your phone so you can approve sensitive operations from anywhere.

### Observability

Deskmate focuses on executing actions safely.

For monitoring agent behavior, resource usage, and failures across
multiple local agents, see **Riva** (local-first agent observability).

## Security

> **Important**: The agent can execute arbitrary commands on your machine. This is by design — the strategy is approve-by-default for read-only operations, with approval gating for protected folders and write operations.

### Built-in protections

| Layer | What it does |
|-------|-------------|
| **User authentication** | Allowlist-based access control via `SecurityManager`. Only users in `ALLOWED_USERS` can interact. Supports per-client auth (`telegram:123`, `discord:456`) and wildcards (`*:*`). |
| **Action approval** | `ApprovalManager` gates sensitive operations. Write commands, file writes, and folder access require explicit human approval with configurable timeouts (default 5 min). |
| **Protected folders** | OS-aware folder protection. Desktop, Documents, Downloads, Pictures, Movies/Videos, Music, and iCloud (macOS) require approval. Session-based caching avoids repeated prompts. |
| **Safe command auto-approval** | Read-only commands (`ls`, `cat`, `git status`, `docker ps`, `node -v`, etc.) auto-approve. Full list in `src/core/approval.ts`. |
| **Command execution limits** | 2-minute timeout and 10 MB output buffer per command. Prevents runaway processes and memory exhaustion. |
| **Session isolation** | Sessions keyed by `clientType:channelId`. 30-minute idle timeout with automatic pruning. Optional disk persistence survives restarts. |
| **Input validation** | MCP tools use Zod schema validation. Telegram callbacks validated via regex patterns. |
| **No open ports** | The bot polls Telegram's servers — no inbound ports exposed. |
| **No sudo by default** | The agent won't use sudo unless you explicitly ask. |
| **Structured logging** | All actions logged with timestamps, context hierarchy, and configurable log levels for audit trails. |
| **Stale message protection** | Telegram client drops pending updates on startup (`drop_pending_updates: true`), preventing replay of messages received while offline. |

### Approval workflow

1. User sends a message that triggers a sensitive operation (e.g., writing to `~/Documents`)
2. `ApprovalManager` checks if the action matches a safe auto-approve pattern
3. If not safe, a pending approval is created with a timeout countdown
4. Approval request is broadcast to all clients with recent activity (last 30 min)
5. User taps Approve/Reject via inline buttons (Telegram) or equivalent
6. Action executes on approval, or is cancelled on rejection/timeout

Set `REQUIRE_APPROVAL_FOR_ALL=true` to gate every operation, including reads.

### Recommendations

- Set `WORKING_DIR` to limit default command scope
- Use `ALLOWED_USERS` for multi-client allowlisting
- Use `ALLOWED_FOLDERS` to pre-approve specific directories
- Review logs regularly (`logs/stdout.log`)
- Keep `.env` secure and never commit it
- Use `REQUIRE_APPROVAL_FOR_ALL=true` if you want to approve every operation

### Execution Philosophy

Deskmate follows an **approve-by-default, visible-by-design** model.

- Read-only operations are auto-approved
- Sensitive operations require explicit confirmation
- All actions are logged locally

The goal is speed without hidden behavior.

## Non-goals

Deskmate is intentionally not:
- A multi-agent orchestration framework
- A cloud-hosted control plane
- A long-running autonomous system
- A monitoring or observability tool

These constraints are deliberate.

## Architecture

```
src/
├── core/
│   ├── agent/
│   │   ├── types.ts              # AgentProvider interface
│   │   ├── factory.ts            # Provider factory + registerProvider()
│   │   └── providers/
│   │       └── claude-code.ts    # Claude Code SDK (default)
│   ├── approval.ts               # Approval manager (auto-approve + manual)
│   ├── executor.ts               # Command execution, file I/O, screenshots
│   └── logger.ts                 # Structured logging
├── gateway/
│   ├── types.ts                  # MessagingClient, MessageHandler interfaces
│   ├── gateway.ts                # Central coordinator
│   ├── security.ts               # Multi-client allowlist auth
│   └── session.ts                # Session manager (composite keys, idle pruning)
├── clients/
│   └── telegram.ts               # Telegram adapter (grammY)
└── mcp/
    └── server.ts                 # MCP server
```

**Agent layer** — ships with Claude Code (`@anthropic-ai/claude-agent-sdk`). Full built-in tool access: Bash, Read, Write, Edit, Glob, Grep. Custom agent providers can be registered via `registerProvider()`.

**Gateway layer** — central coordinator handling auth (`SecurityManager`), sessions (`SessionManager`), agent orchestration, approval routing, and screenshot delivery. Platform adapters implement the `MessagingClient` interface and do only I/O.

### Adding a new client

1. Create `src/clients/discord.ts` implementing `MessagingClient` (see `src/gateway/types.ts`)
2. Add `DISCORD_BOT_TOKEN` to `.env`
3. Add `discord:userId` to `ALLOWED_USERS`
4. Register in the gateway startup: `gateway.registerClient(new DiscordClient(token))`

No changes to Gateway, SecurityManager, SessionManager, or the agent layer.

### Bringing your own agent

```typescript
import { AgentProvider, registerProvider } from "./core/agent";

class MyAgent implements AgentProvider {
  readonly name = "my-agent";
  readonly version = "1.0.0";
  // implement query(), queryStream(), isAvailable()
}

registerProvider("my-agent", MyAgent);
// then set AGENT_PROVIDER=my-agent in .env
```

## Service Management

### macOS (launchd)

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
```

### Linux (systemd)

```bash
# View logs
tail -f logs/stdout.log
journalctl --user -u deskmate.service -f

# Stop / start / restart
systemctl --user stop deskmate.service
systemctl --user start deskmate.service
systemctl --user restart deskmate.service

# Check status
systemctl --user status deskmate.service
```

### Uninstall

```bash
./uninstall.sh
```

## Troubleshooting

**Bot not responding?**
1. Check logs: `tail -f logs/stderr.log`
2. Verify your `ALLOWED_USERS` includes your Telegram ID (e.g. `telegram:123456`)
3. Ensure Claude Code CLI is installed: `which claude`

**Commands timing out?**
- Default timeout is 2 minutes
- Long-running commands may need adjustment

**Machine going to sleep?**
- macOS: Run `./install.sh` to configure sleep prevention, or manually: `sudo pmset -c sleep 0`
- Linux: The systemd service uses idle inhibitor. Check your desktop environment's power settings.

**Permission denied errors? (macOS)**
- Re-run `./install.sh` and go through the permissions setup
- Or manually grant permissions in System Settings > Privacy & Security

**Screenshots not working?**
- macOS: Grant Screen Recording permission in System Settings > Privacy & Security > Screen Recording
- Linux: Install ImageMagick (`sudo apt install imagemagick`)
- Restart the service after making changes

## Future Work / Help Wanted

**Additional messaging clients** — the gateway architecture is ready. We'd welcome:
- `discord` — Discord bot via discord.js
- `slack` — Slack app via Bolt SDK
- `whatsapp` — WhatsApp via the Business API

**Background job handling** — the current `launchd` (macOS) + `systemd` (Linux) approach works but could be improved for different device types (always-on Mac Mini vs MacBook, headless Linux servers).

Open an issue to discuss your approach.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

See [DEVELOPMENT.md](DEVELOPMENT.md) for architecture details and local setup.

## License

MIT License — see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/agent-sdk) — agent runtime
- [grammY](https://grammy.dev/) — Telegram bot framework
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk) — MCP support

---

## Share

If you find Deskmate useful, feel free to share:

- [Share on X](https://x.com/intent/post?text=Running%20real%20system%20actions%20with%20a%20local-first%20AI%20agent.%20Deskmate%20lets%20you%20control%20your%20machine%20using%20natural%20language.&url=https%3A%2F%2Fgithub.com%2Fsarkar-ai%2Fdeskmate&via=sarkar_ai)
- [Post to Hacker News](https://news.ycombinator.com/submitlink?u=https%3A%2F%2Fgithub.com%2Fsarkar-ai%2Fdeskmate&t=Deskmate%3A%20A%20local-first%20AI%20agent%20for%20executing%20real%20system%20actions)
