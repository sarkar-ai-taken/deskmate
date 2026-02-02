import "dotenv/config";
import type { UserIdentity } from "./gateway/types";

const mode = process.argv[2] || "telegram";
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
  console.log(`🚀 Starting ${BOT_NAME} in ${mode} mode...`);

  switch (mode) {
    case "telegram":
      // Telegram bot mode - natural language interface
      const { startTelegramBot } = await import("./telegram/bot");
      await startTelegramBot();
      break;

    case "mcp":
      // MCP server mode - for Claude.ai / MCP clients
      const { startMcpServer } = await import("./mcp/server");
      await startMcpServer();
      break;

    case "both":
      // Run both (MCP on stdio, Telegram in background)
      console.log("Starting both Telegram bot and MCP server...");
      const [{ startTelegramBot: startBot }, { startMcpServer: startMcp }] = await Promise.all([
        import("./telegram/bot"),
        import("./mcp/server"),
      ]);

      // Start Telegram in background (for approval notifications)
      startBot().catch(console.error);

      // Start MCP (this blocks on stdio)
      await startMcp();
      break;

    case "gateway": {
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
      break;
    }

    default:
      console.error(`Unknown mode: ${mode}`);
      console.error("Usage: npm start [telegram|mcp|both|gateway]");
      process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n👋 Shutting down...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n👋 Shutting down...");
  process.exit(0);
});
