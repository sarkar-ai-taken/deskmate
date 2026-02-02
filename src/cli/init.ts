/**
 * Interactive Setup Wizard
 *
 * Supports two install paths:
 *   1. npm global: `npm install -g @sarkar-ai/deskmate && deskmate init`
 *      — config stored in ~/.config/deskmate/.env
 *      — service uses the global `deskmate` binary
 *
 *   2. Source clone: `git clone ... && cd deskmate && deskmate init`  (or ./install.sh)
 *      — config stored in project root .env
 *      — service uses `node <projectDir>/dist/index.js`
 *
 * For an alternative shell-based installer (source path only), see ./install.sh.
 */

import * as readline from "readline";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function askYesNo(
  rl: readline.Interface,
  question: string,
  defaultYes = true,
): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await ask(rl, `${question} ${hint}: `);
  if (answer === "") return defaultYes;
  return answer.toLowerCase() === "y";
}

async function checkClaudeCLI(): Promise<boolean> {
  try {
    execSync("which claude", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

type Platform = "macos" | "linux" | "windows" | "unsupported";

function detectPlatform(): Platform {
  switch (process.platform) {
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    default:
      return "unsupported";
  }
}

// ---------------------------------------------------------------------------
// Install path detection
// ---------------------------------------------------------------------------

interface InstallPaths {
  /** true if installed via npm global (inside node_modules) */
  isGlobalInstall: boolean;
  /** Directory where package.json lives */
  packageDir: string;
  /** Directory where .env and logs go */
  configDir: string;
  /** Path to the deskmate binary or node + index.js for service ExecStart */
  execStart: (runMode: string) => string;
}

function resolveInstallPaths(): InstallPaths {
  // dist/cli/init.js -> go up two levels to get package root
  const packageDir = path.resolve(__dirname, "..", "..");
  const isGlobal = __dirname.includes("node_modules");

  if (isGlobal) {
    const configDir = path.join(os.homedir(), ".config", "deskmate");
    // Use the global deskmate binary (which is in PATH)
    const deskmateCmd = process.argv[1] || "deskmate";
    // Resolve to an absolute path so the service always finds it
    let deskmateBin: string;
    try {
      deskmateBin = execSync("which deskmate", { encoding: "utf-8" }).trim();
    } catch {
      deskmateBin = deskmateCmd;
    }
    return {
      isGlobalInstall: true,
      packageDir,
      configDir,
      execStart: (runMode: string) => `${deskmateBin} ${runMode}`,
    };
  }

  // Source install — configDir is the project root
  return {
    isGlobalInstall: false,
    packageDir,
    configDir: packageDir,
    execStart: (runMode: string) =>
      `${process.execPath} ${packageDir}/dist/index.js ${runMode}`,
  };
}

// ---------------------------------------------------------------------------
// .env reader
// ---------------------------------------------------------------------------

async function loadExistingEnv(envPath: string): Promise<Record<string, string>> {
  const existing: Record<string, string> = {};
  try {
    const content = await fs.readFile(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        if (value) existing[key] = value;
      }
    }
  } catch {
    // file doesn't exist — fine
  }
  return existing;
}

function mask(value: string): string {
  if (value.length <= 8) return "****";
  return value.slice(0, 4) + "..." + value.slice(-4);
}

// ---------------------------------------------------------------------------
// Service installation helpers
// ---------------------------------------------------------------------------

const PLIST_NAME = "com.deskmate.service";

function plistPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${PLIST_NAME}.plist`);
}

function systemdDir(): string {
  return path.join(os.homedir(), ".config", "systemd", "user");
}

function systemdPath(): string {
  return path.join(systemdDir(), "deskmate.service");
}

function buildPlist(
  execStart: string,
  workingDir: string,
  logsDir: string,
): string {
  // Split the execStart into program + arguments for ProgramArguments array
  const parts = execStart.split(" ");
  const argsXml = parts.map((p) => `        <string>${p}</string>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>

    <key>ProgramArguments</key>
    <array>
${argsXml}
    </array>

    <key>WorkingDirectory</key>
    <string>${workingDir}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${os.homedir()}/.local/bin</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${logsDir}/stdout.log</string>

    <key>StandardErrorPath</key>
    <string>${logsDir}/stderr.log</string>
</dict>
</plist>`;
}

function buildSystemdUnit(
  execStart: string,
  workingDir: string,
  logsDir: string,
): string {
  return `[Unit]
Description=Deskmate - Local Machine Assistant
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${execStart}
WorkingDirectory=${workingDir}
Environment=PATH=/usr/local/bin:/usr/bin:/bin:${os.homedir()}/.local/bin
Restart=always
RestartSec=5

InhibitDelayMaxSec=5

StandardOutput=append:${logsDir}/stdout.log
StandardError=append:${logsDir}/stderr.log

[Install]
WantedBy=default.target`;
}

async function installMacosService(
  execStart: string,
  workingDir: string,
  logsDir: string,
): Promise<void> {
  const dest = plistPath();

  // Unload existing
  try {
    execSync(`launchctl list 2>/dev/null | grep -q "${PLIST_NAME}" && launchctl unload "${dest}"`, {
      stdio: "ignore",
      shell: "/bin/bash",
    });
  } catch {
    // not loaded — fine
  }

  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.mkdir(logsDir, { recursive: true });
  await fs.writeFile(dest, buildPlist(execStart, workingDir, logsDir), "utf-8");

  execSync(`launchctl load "${dest}"`);
  console.log("\n  Service installed and started via launchd.");
  console.log(`  Plist: ${dest}`);
}

async function installLinuxService(
  execStart: string,
  workingDir: string,
  logsDir: string,
): Promise<void> {
  const dest = systemdPath();

  // Stop existing
  try {
    execSync("systemctl --user stop deskmate.service", { stdio: "ignore" });
  } catch {
    // not running — fine
  }

  await fs.mkdir(systemdDir(), { recursive: true });
  await fs.mkdir(logsDir, { recursive: true });
  await fs.writeFile(dest, buildSystemdUnit(execStart, workingDir, logsDir), "utf-8");

  execSync("systemctl --user daemon-reload");
  execSync("systemctl --user enable deskmate.service");
  execSync("systemctl --user start deskmate.service");

  // Enable lingering so the service survives logout
  try {
    execSync(`loginctl enable-linger "$(whoami)"`, { stdio: "ignore", shell: "/bin/bash" });
  } catch {
    // loginctl may not be available
  }

  console.log("\n  Service installed and started via systemd.");
  console.log(`  Unit file: ${dest}`);
}

// ---------------------------------------------------------------------------
// macOS permissions helper
// ---------------------------------------------------------------------------

async function offerMacosPermissions(rl: readline.Interface): Promise<void> {
  console.log("\n--- macOS Permissions ---\n");
  console.log("  Deskmate works best with the following permissions:");
  console.log("    - Screen Recording (screenshots)");
  console.log("    - Accessibility (system control)");
  console.log("    - Full Disk Access (read/write anywhere)");
  console.log("    - Automation (AppleScript)");
  console.log("");

  if (await askYesNo(rl, "Trigger Screen Recording permission dialog?")) {
    try {
      execSync("screencapture -x /tmp/deskmate-test-screenshot.png", { stdio: "ignore" });
      execSync("rm -f /tmp/deskmate-test-screenshot.png", { stdio: "ignore" });
    } catch {
      // permission dialog may have appeared
    }
    console.log("  If a dialog appeared, click Allow.\n");
  }

  if (await askYesNo(rl, "Open Accessibility settings?")) {
    execSync(
      'open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"',
    );
    await ask(rl, "  Press Enter when done...");
  }

  if (await askYesNo(rl, "Open Full Disk Access settings?")) {
    execSync(
      'open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"',
    );
    await ask(rl, "  Press Enter when done...");
  }

  if (await askYesNo(rl, "Open Automation settings?")) {
    execSync(
      'open "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"',
    );
    await ask(rl, "  Press Enter when done...");
  }
}

// ---------------------------------------------------------------------------
// Management commands summary
// ---------------------------------------------------------------------------

function printManagementCommands(platform: Platform, logsDir: string): void {
  console.log("\nManagement commands:\n");
  console.log(`  View logs:        tail -f ${logsDir}/stdout.log`);

  if (platform === "macos") {
    const dest = plistPath();
    console.log(`  Stop service:     launchctl unload "${dest}"`);
    console.log(`  Start service:    launchctl load "${dest}"`);
    console.log(`  Check status:     launchctl list | grep deskmate`);
  } else if (platform === "linux") {
    console.log("  Stop service:     systemctl --user stop deskmate.service");
    console.log("  Start service:    systemctl --user start deskmate.service");
    console.log("  Restart service:  systemctl --user restart deskmate.service");
    console.log("  Check status:     systemctl --user status deskmate.service");
  } else if (platform === "windows") {
    console.log("  On Windows (WSL2), manage the service from inside your WSL2 terminal.");
    console.log("  Stop service:     systemctl --user stop deskmate.service");
    console.log("  Start service:    systemctl --user start deskmate.service");
  }
}

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------

export async function runInitWizard(): Promise<void> {
  const rl = createPrompt();

  console.log("\n========================================");
  console.log("  Deskmate Setup Wizard");
  console.log("========================================\n");

  const platform = detectPlatform();
  console.log(`Detected platform: ${platform}\n`);

  if (platform === "windows") {
    console.log("Native Windows is not directly supported.");
    console.log("Please run this wizard inside a WSL2 terminal.\n");
  }

  const hasClaude = await checkClaudeCLI();
  if (!hasClaude) {
    console.log("WARNING: 'claude' CLI not found in PATH.");
    console.log("Install it from: https://docs.anthropic.com/en/docs/claude-code");
    console.log("");
  }

  // Detect install type and resolve paths
  const paths = resolveInstallPaths();

  if (paths.isGlobalInstall) {
    console.log(`Install type: npm global`);
    console.log(`Config directory: ${paths.configDir}\n`);
  } else {
    console.log(`Install type: source`);
    console.log(`Project directory: ${paths.packageDir}\n`);
  }

  // Ensure config directory exists
  await fs.mkdir(paths.configDir, { recursive: true });

  // ----- Step 1: .env wizard -----

  const envPath = path.join(paths.configDir, ".env");
  const existing = await loadExistingEnv(envPath);
  const hasExisting = Object.keys(existing).length > 0;

  if (hasExisting) {
    console.log("Found existing .env — values shown below. Press Enter to keep current value.\n");
  }

  const env: Record<string, string> = {};
  env.AGENT_PROVIDER = existing.AGENT_PROVIDER || "claude-code";

  // Anthropic API Key
  if (existing.ANTHROPIC_API_KEY) {
    const apiKey = await ask(rl, `Anthropic API Key [${mask(existing.ANTHROPIC_API_KEY)}]: `);
    env.ANTHROPIC_API_KEY = apiKey || existing.ANTHROPIC_API_KEY;
  } else {
    const apiKey = await ask(rl, "Anthropic API Key (for Claude Code): ");
    if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
  }

  // Telegram
  console.log("\n--- Telegram Configuration ---\n");
  if (!existing.TELEGRAM_BOT_TOKEN) {
    console.log("  Bot token → message @BotFather on Telegram, send /newbot");
    console.log("  User ID   → message @userinfobot on Telegram, copy the number");
    console.log("");
  }

  if (existing.TELEGRAM_BOT_TOKEN) {
    const token = await ask(rl, `Telegram Bot Token [${mask(existing.TELEGRAM_BOT_TOKEN)}]: `);
    env.TELEGRAM_BOT_TOKEN = token || existing.TELEGRAM_BOT_TOKEN;
  } else {
    const token = await ask(rl, "Telegram Bot Token (from @BotFather): ");
    if (token) env.TELEGRAM_BOT_TOKEN = token;
  }

  // User ID / Allowed Users
  const existingUsers = existing.ALLOWED_USERS;
  const existingUserId = existing.ALLOWED_USER_ID;

  if (existingUsers) {
    const users = await ask(rl, `Allowed users [${existingUsers}]: `);
    env.ALLOWED_USERS = users || existingUsers;
  } else if (existingUserId) {
    const userId = await ask(rl, `Telegram User ID [${existingUserId}]: `);
    const id = userId || existingUserId;
    env.ALLOWED_USER_ID = id;
    env.ALLOWED_USERS = `telegram:${id}`;
  } else {
    const userId = await ask(rl, "Your Telegram User ID (from @userinfobot): ");
    if (userId) {
      env.ALLOWED_USER_ID = userId;
      env.ALLOWED_USERS = `telegram:${userId}`;
    }
  }

  // General config
  console.log("\n--- General Configuration ---\n");

  const defaultWorkingDir = existing.WORKING_DIR || os.homedir();
  const workingDir = await ask(rl, `Working directory [${defaultWorkingDir}]: `);
  env.WORKING_DIR = workingDir || defaultWorkingDir;

  const defaultBotName = existing.BOT_NAME || "Deskmate";
  const botName = await ask(rl, `Bot name [${defaultBotName}]: `);
  env.BOT_NAME = botName || defaultBotName;

  // Carry over other existing values that we don't prompt for
  if (existing.LOG_LEVEL) env.LOG_LEVEL = existing.LOG_LEVEL;
  if (existing.REQUIRE_APPROVAL_FOR_ALL) env.REQUIRE_APPROVAL_FOR_ALL = existing.REQUIRE_APPROVAL_FOR_ALL;
  if (existing.ALLOWED_FOLDERS) env.ALLOWED_FOLDERS = existing.ALLOWED_FOLDERS;

  // ----- Step 2: Write .env -----

  let envContent = "# Deskmate Configuration (generated by deskmate init)\n\n";
  for (const [key, value] of Object.entries(env)) {
    envContent += `${key}=${value}\n`;
  }
  if (!env.LOG_LEVEL) envContent += "LOG_LEVEL=info\n";
  if (!env.REQUIRE_APPROVAL_FOR_ALL)
    envContent += "REQUIRE_APPROVAL_FOR_ALL=false\n";

  try {
    if (hasExisting) {
      const overwrite = await askYesNo(rl, "\nOverwrite existing .env with new values?");
      if (overwrite) {
        await fs.writeFile(envPath, envContent, "utf-8");
        console.log(`Configuration saved to ${envPath}`);
      } else {
        const newPath = envPath + ".new";
        await fs.writeFile(newPath, envContent, "utf-8");
        console.log(`Configuration saved to ${newPath}`);
        console.log("Review and rename it to .env when ready.");
      }
    } else {
      await fs.writeFile(envPath, envContent, "utf-8");
      console.log(`\nConfiguration saved to ${envPath}`);
    }
  } catch (error: any) {
    console.error(`\nFailed to write config: ${error.message}`);
    console.log("\nHere is your configuration:\n");
    console.log(envContent);
  }

  // ----- Step 3: Service installation -----

  if (platform === "macos" || platform === "linux") {
    console.log("");
    const installService = await askYesNo(rl, "Install as background service?");

    if (installService) {
      const logsDir = path.join(paths.configDir, "logs");
      const runMode = "gateway";
      const execStart = paths.execStart(runMode);

      try {
        if (platform === "macos") {
          await installMacosService(execStart, paths.configDir, logsDir);
        } else {
          await installLinuxService(execStart, paths.configDir, logsDir);
        }
      } catch (err: any) {
        console.error(`\n  Failed to install service: ${err.message}`);
        console.log("  You can install manually with ./install.sh");
      }

      // macOS permissions
      if (platform === "macos") {
        const setupPerms = await askYesNo(rl, "\nConfigure macOS permissions?");
        if (setupPerms) {
          await offerMacosPermissions(rl);
        }
      }

      printManagementCommands(platform, logsDir);
    }
  } else if (platform === "windows") {
    console.log(
      "\nTo run as a service on Windows, open a WSL2 terminal and run: deskmate init",
    );
  }

  rl.close();

  console.log("\nSetup complete! Your bot is ready.");
  if (paths.isGlobalInstall) {
    console.log(`\nRun "deskmate" to start, or the background service is already running.`);
    console.log(`Config: ${paths.configDir}/.env`);
  }
  console.log("");
}
