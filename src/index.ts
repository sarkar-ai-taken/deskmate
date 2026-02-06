process.title = "deskmate";

import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { UserIdentity } from "./gateway/types";

const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
);
const VERSION: string = pkg.version;

// Load .env: try cwd first (source install / service), then ~/.config/deskmate/ (npm global)
const cwdEnv = path.join(process.cwd(), ".env");
const configEnv = path.join(os.homedir(), ".config", "deskmate", ".env");

if (fs.existsSync(cwdEnv)) {
  dotenv.config({ path: cwdEnv });
} else if (fs.existsSync(configEnv)) {
  dotenv.config({ path: configEnv });
}

const mode = process.argv[2] || "gateway";
const BOT_NAME = process.env.BOT_NAME || "Deskmate";

/** Parse ALLOWED_USERS (multi-client) and ALLOWED_USER_ID (legacy) into UserIdentity[] */
function buildAllowedUsers(): UserIdentity[] {
  const users: UserIdentity[] = [];

  // New multi-client format: "telegram:123,discord:456,slack:U789"
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

  // Legacy single-user format
  const legacyId = process.env.ALLOWED_USER_ID;
  if (legacyId && legacyId !== "0") {
    // Only add if not already covered by ALLOWED_USERS
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
  switch (mode) {
    case "telegram":
      console.warn(
        '[deprecated] "telegram" mode is deprecated. The gateway is now the default. Starting gateway...',
      );
    // fall through
    case "gateway": {
      console.log(`Starting ${BOT_NAME} in gateway mode...`);
      const { Gateway } = await import("./gateway");
      const { TelegramClient } = await import("./clients/telegram");

      const allowedUsers = buildAllowedUsers();
      if (allowedUsers.length === 0) {
        throw new Error(
          "No allowed users configured. Set ALLOWED_USERS or ALLOWED_USER_ID in your .env",
        );
      }

      const gateway = new Gateway({
        botName: BOT_NAME,
        workingDir: process.env.WORKING_DIR || process.env.HOME || "/",
        allowedUsers,
        maxTurns: 10,
      });

      // Auto-register clients based on available env vars
      if (process.env.TELEGRAM_BOT_TOKEN) {
        gateway.registerClient(new TelegramClient(process.env.TELEGRAM_BOT_TOKEN));
      }
      // Future: Discord, Slack, etc.

      await gateway.start();

      const { startTray } = await import("./cli/tray");
      startTray(VERSION);
      break;
    }

    case "mcp": {
      console.log(`Starting ${BOT_NAME} in mcp mode...`);
      const { startMcpServer } = await import("./mcp/server");
      await startMcpServer();
      break;
    }

    case "both": {
      console.log(`Starting ${BOT_NAME} in gateway + mcp mode...`);
      const { Gateway } = await import("./gateway");
      const { TelegramClient } = await import("./clients/telegram");
      const { startMcpServer } = await import("./mcp/server");

      const allowedUsers = buildAllowedUsers();
      if (allowedUsers.length === 0) {
        throw new Error(
          "No allowed users configured. Set ALLOWED_USERS or ALLOWED_USER_ID in your .env",
        );
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

      // Start gateway in background, MCP on stdio
      gateway.start().catch(console.error);

      const { startTray: startTrayBoth } = await import("./cli/tray");
      startTrayBoth(VERSION);

      await startMcpServer();
      break;
    }

    default:
      console.error(`Unknown mode: ${mode}`);
      console.error("Usage: npm start [gateway|mcp|both]");
      process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\nShutting down...");
  process.exit(0);
});
