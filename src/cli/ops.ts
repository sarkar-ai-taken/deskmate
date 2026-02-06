/**
 * Operational CLI commands: status, logs, restart, doctor
 */

import * as fs from "fs";
import * as path from "path";
import { execSync, spawn } from "child_process";
import {
  detectPlatform,
  resolveInstallPaths,
  plistPath,
  systemdPath,
  PLIST_NAME,
  loadExistingEnv,
} from "./init";

// ---------------------------------------------------------------------------
// Provider metadata (mirrors init.ts PROVIDER_INFO — kept minimal here)
// ---------------------------------------------------------------------------

const PROVIDER_META: Record<string, { binary: string; envKey?: string }> = {
  "claude-code": { binary: "claude", envKey: "ANTHROPIC_API_KEY" },
  codex:         { binary: "codex",  envKey: "OPENAI_API_KEY" },
  gemini:        { binary: "gemini", envKey: "GEMINI_API_KEY" },
  opencode:      { binary: "opencode" },
};

function resolveProviderMeta(): { provider: string; binary: string; envKey?: string } {
  const provider = process.env.AGENT_PROVIDER || "claude-code";
  const meta = PROVIDER_META[provider] || PROVIDER_META["claude-code"];
  return { provider, ...meta };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getVersion(): string {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf-8"),
  );
  return pkg.version;
}

function check(pass: boolean, label: string, detail?: string): void {
  const icon = pass ? "\x1b[32m✔\x1b[0m" : "\x1b[31m✘\x1b[0m";
  const msg = detail ? `${label} — ${detail}` : label;
  console.log(`  ${icon}  ${msg}`);
}

function warn(label: string, detail?: string): void {
  const msg = detail ? `${label} — ${detail}` : label;
  console.log(`  \x1b[33m⚠\x1b[0m  ${msg}`);
}

function isServiceRunning(): boolean {
  const platform = detectPlatform();
  try {
    if (platform === "macos") {
      const output = execSync("launchctl list", { encoding: "utf-8" });
      return output.includes(PLIST_NAME);
    } else if (platform === "linux") {
      const output = execSync("systemctl --user is-active deskmate.service", {
        encoding: "utf-8",
      });
      return output.trim() === "active";
    }
  } catch {
    // command failed → not running
  }
  return false;
}

function isServiceInstalled(): boolean {
  const platform = detectPlatform();
  if (platform === "macos") return fs.existsSync(plistPath());
  if (platform === "linux") return fs.existsSync(systemdPath());
  return false;
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export async function runStatus(): Promise<void> {
  const version = getVersion();
  const platform = detectPlatform();
  const paths = resolveInstallPaths();
  const envPath = path.join(paths.configDir, ".env");

  console.log(`\nDeskmate v${version}`);
  console.log(`Platform: ${platform}`);
  console.log(`Install type: ${paths.isGlobalInstall ? "npm global" : "source"}`);
  console.log(`Config dir: ${paths.configDir}\n`);

  // Service status
  const installed = isServiceInstalled();
  check(installed, "Service file installed");

  const running = isServiceRunning();
  check(running, "Service running");

  // Config validation
  console.log("");
  const envExists = fs.existsSync(envPath);
  check(envExists, ".env file exists", envExists ? envPath : "not found");

  if (envExists) {
    const env = await loadExistingEnv(envPath);
    const { provider, envKey } = resolveProviderMeta();

    console.log(`  Agent provider: ${provider}`);

    const hasUsers = !!(env.ALLOWED_USERS || env.ALLOWED_USER_ID);
    check(hasUsers, "ALLOWED_USERS configured");

    const hasToken = !!env.TELEGRAM_BOT_TOKEN;
    check(hasToken, "TELEGRAM_BOT_TOKEN set");

    if (envKey) {
      const hasApiKey = !!env[envKey];
      check(hasApiKey, `${envKey} set`);
    } else {
      check(true, "API key", "provider manages its own auth");
    }
  }

  console.log("");
}

// ---------------------------------------------------------------------------
// logs
// ---------------------------------------------------------------------------

export async function runLogs(flags: Set<string>): Promise<void> {
  const paths = resolveInstallPaths();
  const logsDir = path.join(paths.configDir, "logs");
  const logFile = flags.has("--stderr") ? "stderr.log" : "stdout.log";
  const logPath = path.join(logsDir, logFile);

  if (!fs.existsSync(logPath)) {
    console.error(`Log file not found: ${logPath}`);
    console.error(
      `Run "deskmate init" to set up the service, or check that the logs directory exists.`,
    );
    process.exit(1);
  }

  console.log(`Tailing ${logPath} (Ctrl+C to exit)\n`);

  const tail = spawn("tail", ["-f", logPath], { stdio: "inherit" });

  tail.on("error", (err) => {
    console.error(`Failed to tail logs: ${err.message}`);
    process.exit(1);
  });

  tail.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

// ---------------------------------------------------------------------------
// restart
// ---------------------------------------------------------------------------

export async function runRestart(): Promise<void> {
  const platform = detectPlatform();

  if (platform !== "macos" && platform !== "linux") {
    console.error(`Restart is not supported on platform: ${platform}`);
    process.exit(1);
  }

  if (!isServiceInstalled()) {
    console.error(
      `Service is not installed. Run "deskmate init" to install it first.`,
    );
    process.exit(1);
  }

  console.log("Restarting deskmate service...\n");

  try {
    if (platform === "macos") {
      const plist = plistPath();
      execSync(`launchctl unload "${plist}"`, { stdio: "inherit" });
      execSync(`launchctl load "${plist}"`, { stdio: "inherit" });
    } else {
      execSync("systemctl --user restart deskmate.service", {
        stdio: "inherit",
      });
    }
    console.log("\nService restarted successfully.");
  } catch (err: any) {
    console.error(`\nFailed to restart service: ${err.message}`);
    process.exit(1);
  }

  // Show a few lines of recent logs
  const paths = resolveInstallPaths();
  const logPath = path.join(paths.configDir, "logs", "stdout.log");
  if (fs.existsSync(logPath)) {
    // Brief delay to let the service write initial output
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const output = execSync(`tail -5 "${logPath}"`, { encoding: "utf-8" });
      if (output.trim()) {
        console.log("\nRecent logs:");
        console.log(output);
      }
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

export async function runDoctor(): Promise<void> {
  console.log("\nDeskmate Doctor\n");

  const platform = detectPlatform();
  const paths = resolveInstallPaths();
  const envPath = path.join(paths.configDir, ".env");
  const logsDir = path.join(paths.configDir, "logs");

  // 1. Node.js version
  const nodeVersion = process.versions.node;
  const nodeMajor = parseInt(nodeVersion.split(".")[0], 10);
  check(nodeMajor >= 18, "Node.js version", `v${nodeVersion}`);

  // 2. Agent CLI installed
  const { provider, binary, envKey } = resolveProviderMeta();
  let hasBinary = false;
  try {
    execSync(`which ${binary}`, { stdio: "ignore" });
    hasBinary = true;
  } catch {
    // not found
  }
  check(hasBinary, `${binary} CLI installed`, `provider: ${provider}`);

  // 3. .env file exists
  const envExists = fs.existsSync(envPath);
  check(envExists, ".env file exists", envExists ? envPath : "not found");

  // 4. Required env vars
  if (envExists) {
    const env = await loadExistingEnv(envPath);
    const hasUsers = !!(env.ALLOWED_USERS || env.ALLOWED_USER_ID);
    check(hasUsers, "ALLOWED_USERS configured");

    const hasToken = !!env.TELEGRAM_BOT_TOKEN;
    check(hasToken, "TELEGRAM_BOT_TOKEN set");

    if (envKey) {
      const hasApiKey = !!env[envKey];
      check(hasApiKey, `${envKey} set`);
    } else {
      check(true, "API key", "provider manages its own auth");
    }
  } else {
    check(false, "ALLOWED_USERS configured", "no .env file");
    check(false, "TELEGRAM_BOT_TOKEN set", "no .env file");
    if (envKey) {
      check(false, `${envKey} set`, "no .env file");
    }
  }

  // 5. dist/ build exists
  const distDir = path.join(paths.packageDir, "dist");
  const distExists =
    fs.existsSync(distDir) && fs.existsSync(path.join(distDir, "cli.js"));
  check(distExists, "dist/ build exists");

  // 6. Service file installed
  const installed = isServiceInstalled();
  check(installed, "Service file installed", platform);

  // 7. Service running
  const running = isServiceRunning();
  check(running, "Service running");

  // 8. Log directory exists and writable
  let logsOk = false;
  if (fs.existsSync(logsDir)) {
    try {
      fs.accessSync(logsDir, fs.constants.W_OK);
      logsOk = true;
    } catch {
      // not writable
    }
  }
  check(logsOk, "Log directory exists and writable", logsDir);

  // 9. Recent errors in stderr.log
  const stderrPath = path.join(logsDir, "stderr.log");
  if (fs.existsSync(stderrPath)) {
    try {
      const tail = execSync(`tail -20 "${stderrPath}"`, { encoding: "utf-8" });
      const errorLines = tail
        .split("\n")
        .filter((l) => /error|fatal/i.test(l));
      if (errorLines.length > 0) {
        warn("Recent errors in stderr.log", `${errorLines.length} error(s)`);
        for (const line of errorLines.slice(0, 5)) {
          console.log(`      ${line.trim()}`);
        }
      } else {
        check(true, "No recent errors in stderr.log");
      }
    } catch {
      warn("Could not read stderr.log");
    }
  } else {
    check(true, "No stderr.log (service may not have run yet)");
  }

  console.log("");
}
