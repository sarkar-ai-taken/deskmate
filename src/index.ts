import "dotenv/config";

const mode = process.argv[2] || "telegram";
const BOT_NAME = process.env.BOT_NAME || "Deskmate";

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

    default:
      console.error(`Unknown mode: ${mode}`);
      console.error("Usage: npm start [telegram|mcp|both]");
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
