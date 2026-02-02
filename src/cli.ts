#!/usr/bin/env node

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import type { UserIdentity } from "./gateway/types";

const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
);
const VERSION: string = pkg.version;
const BOT_NAME = process.env.BOT_NAME || "Deskmate";

function printHelp() {
  console.log(`
${BOT_NAME} - Control your machine from anywhere using natural language

Usage:
  deskmate <command> [options]

Commands:
  telegram    Start the Telegram bot (default)
  mcp         Start the MCP server
  both        Start both Telegram bot and MCP server
  gateway     Start the multi-client gateway
  init        Interactive setup wizard

Options:
  -h, --help      Show this help message
  -v, --version   Show version number

Examples:
  deskmate                  Start in Telegram mode
  deskmate telegram         Start the Telegram bot
  deskmate mcp              Start the MCP server
  deskmate gateway          Start multi-client gateway
  deskmate init             Run the setup wizard
  deskmate --version        Print version

Environment:
  AGENT_PROVIDER            Agent provider (default: claude-code)
  TELEGRAM_BOT_TOKEN        Telegram bot token
  ANTHROPIC_API_KEY         Anthropic API key
  ALLOWED_USERS             Multi-client allowlist (e.g. telegram:123,discord:456)
`);
}

export function buildAllowedUsers(): UserIdentity[] {
  const users: UserIdentity[] = [];

  const multiClient = process.env.ALLOWED_USERS;
  if (multiClient) {
    for (const entry of multiClient.split(",").map((s) => s.trim()).filter(Boolean)) {
      const colonIdx = entry.indexOf(":");
      if (colonIdx > 0) {
        users.push({
          clientType: entry.slice(0, colonIdx),
          platformUserId: entry.slice(colonIdx + 1),
        });
      }
    }
  }

  const legacyId = process.env.ALLOWED_USER_ID;
  if (legacyId && legacyId !== "0") {
    const alreadyHas = users.some(
      (u) => u.clientType === "telegram" && u.platformUserId === legacyId,
    );
    if (!alreadyHas) {
      users.push({ clientType: "telegram", platformUserId: legacyId });
    }
  }

  return users;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.find((a) => !a.startsWith("-")) || "telegram";
  const flags = new Set(args.filter((a) => a.startsWith("-")));

  if (flags.has("--help") || flags.has("-h")) {
    printHelp();
    process.exit(0);
  }

  if (flags.has("--version") || flags.has("-v")) {
    console.log(VERSION);
    process.exit(0);
  }

  // If no explicit command and no .env found, suggest running init
  if (
    !args.find((a) => !a.startsWith("-")) &&
    !fs.existsSync(path.join(process.cwd(), ".env"))
  ) {
    console.log(`No .env file found. Run "deskmate init" to get started.\n`);
  }

  switch (command) {
    case "telegram": {
      console.log(`Starting ${BOT_NAME} in telegram mode...`);
      const { startTelegramBot } = await import("./telegram/bot");
      await startTelegramBot();
      break;
    }

    case "mcp": {
      console.log(`Starting ${BOT_NAME} in mcp mode...`);
      const { startMcpServer } = await import("./mcp/server");
      await startMcpServer();
      break;
    }

    case "both": {
      console.log(`Starting ${BOT_NAME} in both mode...`);
      const [{ startTelegramBot: startBot }, { startMcpServer: startMcp }] =
        await Promise.all([
          import("./telegram/bot"),
          import("./mcp/server"),
        ]);
      startBot().catch(console.error);
      await startMcp();
      break;
    }

    case "gateway": {
      console.log(`Starting ${BOT_NAME} in gateway mode...`);
      const { Gateway } = await import("./gateway");
      const { TelegramClient } = await import("./clients/telegram");

      const allowedUsers = buildAllowedUsers();
      if (allowedUsers.length === 0) {
        console.error(
          "No allowed users configured. Set ALLOWED_USERS or ALLOWED_USER_ID in your .env",
        );
        process.exit(1);
      }

      const gateway = new Gateway({
        botName: BOT_NAME,
        workingDir: process.env.WORKING_DIR || process.env.HOME || "/",
        allowedUsers,
        maxTurns: 10,
      });

      if (process.env.TELEGRAM_BOT_TOKEN) {
        gateway.registerClient(new TelegramClient(process.env.TELEGRAM_BOT_TOKEN));
      }

      await gateway.start();
      break;
    }

    case "setup":
    case "init": {
      const { runInitWizard } = await import("./cli/init");
      await runInitWizard();
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run "deskmate --help" for usage information.');
      process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\nShutting down...");
  process.exit(0);
});
