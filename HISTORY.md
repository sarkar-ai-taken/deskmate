# Release History

## v0.2.0 (2026-02-02)

### Features
- **Gateway architecture** — Multi-client gateway with security manager and platform abstraction
- **CLI entry point** — `deskmate` CLI with `init` command for guided setup
- **Telegram client adapter** — Dedicated Telegram client for the gateway architecture
- **Session persistence** — Sessions now persist to disk (JSON file) and survive restarts
- **Platform detection** — Cross-platform support for macOS and Linux screenshot commands

### Bug Fixes
- Prevent duplicate Telegram responses on bot restart
- Fix vitest config ESM loading error in CI (`vitest.config.ts` -> `.mts`)

### Infrastructure
- CI workflow improvements
- npm publish workflow
- Test suite with vitest (approval, CLI, platform, security, session tests)

## v0.1.0 (Initial)

- Telegram bot with natural language command execution
- Claude Agent SDK integration
- Approval system for dangerous commands
- MCP server mode
- Screenshot capture and delivery
