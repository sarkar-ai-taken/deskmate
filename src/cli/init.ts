/**
 * Interactive Setup Wizard
 *
 * Self-contained setup: writes .env, optionally installs a background service
 * (launchd on macOS, systemd on Linux), and guides through macOS permissions.
 *
 * For an alternative shell-based installer, see ./install.sh.
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
  nodePath: string,
  projectDir: string,
  logsDir: string,
  runMode: string,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${projectDir}/dist/index.js</string>
        <string>${runMode}</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${projectDir}</string>

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
  nodePath: string,
  projectDir: string,
  logsDir: string,
  runMode: string,
): string {
  return `[Unit]
Description=Deskmate - Local Machine Assistant
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${nodePath} ${projectDir}/dist/index.js ${runMode}
WorkingDirectory=${projectDir}
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
  projectDir: string,
  logsDir: string,
  runMode: string,
): Promise<void> {
  const nodePath = process.execPath;
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
  await fs.writeFile(dest, buildPlist(nodePath, projectDir, logsDir, runMode), "utf-8");

  execSync(`launchctl load "${dest}"`);
  console.log("\n  Service installed and started via launchd.");
  console.log(`  Plist: ${dest}`);
}

async function installLinuxService(
  projectDir: string,
  logsDir: string,
  runMode: string,
): Promise<void> {
  const nodePath = process.execPath;
  const dest = systemdPath();

  // Stop existing
  try {
    execSync("systemctl --user stop deskmate.service", { stdio: "ignore" });
  } catch {
    // not running — fine
  }

  await fs.mkdir(systemdDir(), { recursive: true });
  await fs.mkdir(logsDir, { recursive: true });
  await fs.writeFile(dest, buildSystemdUnit(nodePath, projectDir, logsDir, runMode), "utf-8");

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

  // ----- Step 1: .env wizard -----

  const env: Record<string, string> = {};
  env.AGENT_PROVIDER = "claude-code";

  const apiKey = await ask(rl, "Anthropic API Key (for Claude Code): ");
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey;

  console.log("\n--- Telegram Configuration ---\n");
  console.log("  Bot token → message @BotFather on Telegram, send /newbot");
  console.log("  User ID   → message @userinfobot on Telegram, copy the number");
  console.log("");

  const token = await ask(rl, "Telegram Bot Token (from @BotFather): ");
  if (token) env.TELEGRAM_BOT_TOKEN = token;

  const userId = await ask(rl, "Your Telegram User ID (from @userinfobot): ");
  if (userId) {
    env.ALLOWED_USER_ID = userId;
    env.ALLOWED_USERS = `telegram:${userId}`;
  }

  console.log("\n--- General Configuration ---\n");
  const workingDir = await ask(
    rl,
    `Working directory (default: ${os.homedir()}): `,
  );
  if (workingDir) env.WORKING_DIR = workingDir;

  const botName = await ask(rl, "Bot name (default: Deskmate): ");
  if (botName) env.BOT_NAME = botName;

  // ----- Step 2: Write .env -----

  const envPath = path.join(process.cwd(), ".env");

  let envContent = "# Deskmate Configuration (generated by deskmate init)\n\n";
  for (const [key, value] of Object.entries(env)) {
    envContent += `${key}=${value}\n`;
  }
  if (!env.LOG_LEVEL) envContent += "LOG_LEVEL=info\n";
  if (!env.REQUIRE_APPROVAL_FOR_ALL)
    envContent += "REQUIRE_APPROVAL_FOR_ALL=false\n";

  try {
    let envExists = false;
    try {
      await fs.access(envPath);
      envExists = true;
    } catch {
      // does not exist
    }

    if (envExists) {
      console.log(`\nWARNING: .env file already exists at ${envPath}`);
      const newPath = envPath + ".new";
      await fs.writeFile(newPath, envContent, "utf-8");
      console.log(`Configuration saved to ${newPath}`);
      console.log("Review and rename it to .env when ready.");
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
      // Determine project root (where package.json lives)
      const projectDir = path.resolve(__dirname, "..");
      const logsDir = path.join(projectDir, "logs");

      const runMode = "gateway";

      try {
        if (platform === "macos") {
          await installMacosService(projectDir, logsDir, runMode);
        } else {
          await installLinuxService(projectDir, logsDir, runMode);
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
  console.log("");
}
