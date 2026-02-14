#!/usr/bin/env node
/**
 * Standalone sidecar entry point.
 *
 * Usage:
 *   node dist/sidecar/cli.js
 *   deskmate sidecar
 *
 * Loads .env, starts the HTTP-over-Unix-socket sidecar server,
 * and sets up graceful shutdown handlers.
 */

import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Load .env: try cwd first, then ~/.config/deskmate/
const cwdEnv = path.join(process.cwd(), ".env");
const configEnv = path.join(os.homedir(), ".config", "deskmate", ".env");

if (fs.existsSync(cwdEnv)) {
  dotenv.config({ path: cwdEnv });
} else if (fs.existsSync(configEnv)) {
  dotenv.config({ path: configEnv });
}

async function main() {
  const { startSidecar, setupGracefulShutdown } = await import("./server");
  const server = await startSidecar();
  setupGracefulShutdown(server);
  console.log("Sidecar running. Press Ctrl+C to stop.");
}

main().catch((err) => {
  console.error("Sidecar failed to start:", err);
  process.exit(1);
});
