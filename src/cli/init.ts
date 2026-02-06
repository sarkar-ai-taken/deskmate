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
import * as fsSync from "fs";
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

function checkBinary(binary: string): boolean {
  try {
    execSync(`which ${binary}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Provider metadata
// ---------------------------------------------------------------------------

interface ProviderInfo {
  label: string;
  binary: string;
  envKey?: string;        // API key env var (undefined = provider manages its own auth)
  envPrompt?: string;     // prompt text for the API key
  installUrl: string;
}

const PROVIDER_INFO: Record<string, ProviderInfo> = {
  "claude-code": {
    label: "Claude Code (Anthropic)",
    binary: "claude",
    envKey: "ANTHROPIC_API_KEY",
    envPrompt: "Anthropic API Key",
    installUrl: "https://docs.anthropic.com/en/docs/claude-code",
  },
  codex: {
    label: "Codex (OpenAI)",
    binary: "codex",
    envKey: "OPENAI_API_KEY",
    envPrompt: "OpenAI API Key",
    installUrl: "https://github.com/openai/codex",
  },
  gemini: {
    label: "Gemini CLI (Google)",
    binary: "gemini",
    envKey: "GEMINI_API_KEY",
    envPrompt: "Gemini API Key",
    installUrl: "https://github.com/google-gemini/gemini-cli",
  },
  opencode: {
    label: "OpenCode",
    binary: "opencode",
    installUrl: "https://github.com/opencode-ai/opencode",
  },
};

async function askProviderChoice(
  rl: readline.Interface,
  currentProvider: string,
): Promise<string> {
  const providers = Object.entries(PROVIDER_INFO);

  console.log("\n--- Agent Provider ---\n");
  for (let i = 0; i < providers.length; i++) {
    const [key, info] = providers[i];
    const installed = checkBinary(info.binary) ? "\x1b[32m(installed)\x1b[0m" : "\x1b[31m(not found)\x1b[0m";
    const current = key === currentProvider ? " \x1b[36m<-- current\x1b[0m" : "";
    console.log(`  ${i + 1}. ${info.label} ${installed}${current}`);
  }
  console.log("");

  const answer = await ask(rl, `Choose provider [1-${providers.length}] (Enter to keep current): `);
  if (!answer) return currentProvider;

  const idx = parseInt(answer, 10) - 1;
  if (idx >= 0 && idx < providers.length) {
    const chosen = providers[idx][0];
    const info = providers[idx][1];
    if (!checkBinary(info.binary)) {
      console.log(`\n  WARNING: '${info.binary}' CLI not found in PATH.`);
      console.log(`  Install it from: ${info.installUrl}\n`);
    }
    return chosen;
  }

  console.log("  Invalid choice, keeping current provider.");
  return currentProvider;
}

export type Platform = "macos" | "linux" | "windows" | "unsupported";

export function detectPlatform(): Platform {
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

export interface InstallPaths {
  /** true if installed via npm global (inside node_modules) */
  isGlobalInstall: boolean;
  /** Directory where package.json lives */
  packageDir: string;
  /** Directory where .env and logs go */
  configDir: string;
  /** Path to the deskmate binary or node + index.js for service ExecStart */
  execStart: (runMode: string) => string;
}

export function resolveInstallPaths(): InstallPaths {
  // dist/cli/init.js -> go up two levels to get package root
  const packageDir = path.resolve(__dirname, "..", "..");
  const isGlobal = __dirname.includes("node_modules");

  if (isGlobal) {
    const configDir = path.join(os.homedir(), ".config", "deskmate");
    // Create a hard link named "deskmate" → node so the OS-level process name
    // reported by psutil / ps / top becomes "deskmate" instead of "node".
    // Hard links are required on macOS — symlinks get resolved by the kernel.
    const nodeBin = process.execPath;
    const deskmateLink = path.join(configDir, "deskmate");
    try {
      if (!fsSync.existsSync(configDir)) {
        fsSync.mkdirSync(configDir, { recursive: true });
      }
      if (fsSync.existsSync(deskmateLink)) {
        fsSync.unlinkSync(deskmateLink);
      }
      fsSync.linkSync(nodeBin, deskmateLink);
    } catch {
      // Hard link failed — fall back to plain node
    }
    const execBin = fsSync.existsSync(deskmateLink) ? deskmateLink : nodeBin;

    return {
      isGlobalInstall: true,
      packageDir,
      configDir,
      execStart: (runMode: string) =>
        `${execBin} ${packageDir}/dist/cli.js ${runMode}`,
    };
  }

  // Source install — configDir is the project root
  // Create a hard link named "deskmate" → node so the OS-level process name
  // reported by psutil / ps / top becomes "deskmate" instead of "node".
  // Hard links are required on macOS — symlinks get resolved by the kernel.
  const nodeBin = process.execPath;
  const deskmateLink = path.join(packageDir, "dist", "deskmate");
  try {
    if (fsSync.existsSync(deskmateLink)) {
      fsSync.unlinkSync(deskmateLink);
    }
    fsSync.linkSync(nodeBin, deskmateLink);
  } catch {
    // Hard link failed — fall back to plain node
  }
  const execBin = fsSync.existsSync(deskmateLink) ? deskmateLink : nodeBin;

  return {
    isGlobalInstall: false,
    packageDir,
    configDir: packageDir,
    execStart: (runMode: string) =>
      `${execBin} ${packageDir}/dist/index.js ${runMode}`,
  };
}

// ---------------------------------------------------------------------------
// .env reader
// ---------------------------------------------------------------------------

export async function loadExistingEnv(envPath: string): Promise<Record<string, string>> {
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

export const PLIST_NAME = "com.deskmate.service";

export function plistPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${PLIST_NAME}.plist`);
}

function systemdDir(): string {
  return path.join(os.homedir(), ".config", "systemd", "user");
}

export function systemdPath(): string {
  return path.join(systemdDir(), "deskmate.service");
}

function buildPlist(
  execStart: string,
  workingDir: string,
  logsDir: string,
  useCaffeinate = false,
): string {
  // Split the execStart into program + arguments for ProgramArguments array
  const parts = useCaffeinate
    ? ["/usr/bin/caffeinate", "-i", ...execStart.split(" ")]
    : execStart.split(" ");
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
  useCaffeinate = false,
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
  await fs.writeFile(dest, buildPlist(execStart, workingDir, logsDir, useCaffeinate), "utf-8");

  execSync(`launchctl load "${dest}"`);
  console.log("\n  Service installed and started via launchd.");
  if (useCaffeinate) console.log("  Caffeinate wrapper enabled.");
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
  console.log("    - Background Items (login items)");
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

  if (await askYesNo(rl, "Open Login Items settings?")) {
    execSync(
      'open "x-apple.systempreferences:com.apple.LoginItems-Settings.extension"',
    );
    console.log("  Ensure 'node' or 'deskmate' is enabled under 'Allow in the Background'");
    await ask(rl, "  Press Enter when done...");
  }
}

// ---------------------------------------------------------------------------
// macOS folder access helper
// ---------------------------------------------------------------------------

async function offerMacosFolderAccess(rl: readline.Interface): Promise<string> {
  console.log("\n--- macOS Folder Access ---\n");
  console.log("  macOS will ask for permission when the agent accesses protected folders.");
  console.log("  Select folders to grant access (triggers macOS permission dialogs).\n");

  const folders: string[] = [];
  const home = os.homedir();

  const folderChoices: Array<{ name: string; path: string; defaultYes: boolean }> = [
    { name: "Desktop", path: path.join(home, "Desktop"), defaultYes: true },
    { name: "Documents", path: path.join(home, "Documents"), defaultYes: true },
    { name: "Downloads", path: path.join(home, "Downloads"), defaultYes: true },
    { name: "Pictures", path: path.join(home, "Pictures"), defaultYes: false },
    { name: "Movies", path: path.join(home, "Movies"), defaultYes: false },
    { name: "Music", path: path.join(home, "Music"), defaultYes: false },
  ];

  // Check for iCloud Drive
  const icloudPath = path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs");
  if (fsSync.existsSync(icloudPath)) {
    folderChoices.push({ name: "iCloud Drive", path: icloudPath, defaultYes: false });
  }

  for (const choice of folderChoices) {
    if (await askYesNo(rl, `  Grant access to ${choice.name}?`, choice.defaultYes)) {
      try {
        execSync(`ls "${choice.path}" > /dev/null 2>&1`, { stdio: "ignore", shell: "/bin/bash" });
      } catch {
        // permission dialog may have appeared
      }
      folders.push(choice.path);
      console.log(`  Access requested for ${choice.name}`);
    }
  }

  // Custom folder
  if (await askYesNo(rl, "  Add a custom folder path?", false)) {
    const customPath = await ask(rl, "  Enter folder path: ");
    if (customPath && fsSync.existsSync(customPath)) {
      try {
        execSync(`ls "${customPath}" > /dev/null 2>&1`, { stdio: "ignore", shell: "/bin/bash" });
      } catch {
        // permission dialog may have appeared
      }
      folders.push(customPath);
      console.log(`  Access requested for ${customPath}`);
    } else if (customPath) {
      console.log(`  Folder not found: ${customPath}`);
    }
  }

  console.log("\n  If permission dialogs appeared, make sure to click 'Allow'");

  return folders.join(":");
}

// ---------------------------------------------------------------------------
// Mode selection helper
// ---------------------------------------------------------------------------

async function askModeChoice(rl: readline.Interface): Promise<string> {
  console.log("\n--- Run Mode ---\n");
  console.log("  1. Gateway (recommended)");
  console.log("     Multi-client gateway with Telegram");
  console.log("");
  console.log("  2. MCP only");
  console.log("     Expose as MCP server for Claude Desktop");
  console.log("");
  console.log("  3. Both");
  console.log("     Gateway + MCP server together");
  console.log("");

  const answer = await ask(rl, "Choose mode [1/2/3] (default: 1): ");
  switch (answer) {
    case "2": return "mcp";
    case "3": return "both";
    default: return "gateway";
  }
}

// ---------------------------------------------------------------------------
// Sleep prevention helper (macOS)
// ---------------------------------------------------------------------------

async function configureSleepPrevention(rl: readline.Interface): Promise<boolean> {
  console.log("\n--- Sleep Prevention ---\n");
  console.log("  Preventing system sleep keeps the bot available 24/7.\n");

  if (await askYesNo(rl, "Disable system sleep when plugged in? (requires sudo)")) {
    try {
      execSync("sudo pmset -c sleep 0 displaysleep 10", { stdio: "inherit" });
      console.log("  System configured: sleep disabled when plugged in, display sleeps after 10 min");
    } catch {
      console.log("  Failed to set power management (sudo required)");
    }
  }

  console.log("");
  console.log("  Optional: Use caffeinate for extra sleep protection.");
  console.log("  This wraps the service to prevent sleep while it runs.\n");
  const useCaffeinate = await askYesNo(rl, "Enable caffeinate?", false);
  return useCaffeinate;
}

// ---------------------------------------------------------------------------
// Claude Desktop MCP config helper
// ---------------------------------------------------------------------------

function claudeDesktopConfigPath(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  return path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");
}

async function configureClaudeDesktop(
  nodePath: string,
  entryPoint: string,
  workingDir: string,
): Promise<void> {
  const configPath = claudeDesktopConfigPath();
  const configDir = path.dirname(configPath);

  await fs.mkdir(configDir, { recursive: true });

  let config: any = {};
  try {
    const content = await fs.readFile(configPath, "utf-8");
    config = JSON.parse(content);
  } catch {
    // file doesn't exist or invalid — start fresh
  }

  if (!config.mcpServers) config.mcpServers = {};

  if (config.mcpServers.deskmate) {
    console.log("  deskmate already configured in Claude Desktop — updating.");
  }

  config.mcpServers.deskmate = {
    command: nodePath,
    args: [entryPoint, "mcp"],
    env: { WORKING_DIR: workingDir },
  };

  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  console.log(`  Claude Desktop config updated: ${configPath}`);
  console.log("  Restart Claude Desktop for changes to take effect.");
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

  // Provider selection
  const currentProvider = existing.AGENT_PROVIDER || "claude-code";
  const selectedProvider = await askProviderChoice(rl, currentProvider);
  env.AGENT_PROVIDER = selectedProvider;

  // API key for selected provider
  const providerInfo = PROVIDER_INFO[selectedProvider];
  if (providerInfo?.envKey) {
    const envKey = providerInfo.envKey;
    const existingKey = existing[envKey];
    if (existingKey) {
      const apiKey = await ask(rl, `${providerInfo.envPrompt} [${mask(existingKey)}]: `);
      env[envKey] = apiKey || existingKey;
    } else {
      const apiKey = await ask(rl, `${providerInfo.envPrompt}: `);
      if (apiKey) env[envKey] = apiKey;
    }
  } else {
    console.log(`\n  ${providerInfo?.label || selectedProvider} manages its own authentication — no API key needed.\n`);
  }

  // Carry over API keys for other providers (user might switch back)
  for (const [, info] of Object.entries(PROVIDER_INFO)) {
    if (info.envKey && info.envKey !== providerInfo?.envKey && existing[info.envKey]) {
      env[info.envKey] = existing[info.envKey];
    }
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

  // ----- Step 3: Mode selection -----

  const runMode = await askModeChoice(rl);
  console.log(`  Mode selected: ${runMode}`);

  // ----- Step 4: macOS permissions -----

  if (platform === "macos") {
    const setupPerms = await askYesNo(rl, "\nConfigure macOS permissions?");
    if (setupPerms) {
      await offerMacosPermissions(rl);
    }
  }

  // ----- Step 5: macOS folder access -----

  if (platform === "macos") {
    const setupFolders = await askYesNo(rl, "\nConfigure folder access?");
    if (setupFolders) {
      const foldersStr = await offerMacosFolderAccess(rl);
      if (foldersStr) {
        env.ALLOWED_FOLDERS = foldersStr;
        // Re-write .env with updated folders
        let updatedContent = "# Deskmate Configuration (generated by deskmate init)\n\n";
        for (const [key, value] of Object.entries(env)) {
          updatedContent += `${key}=${value}\n`;
        }
        if (!env.LOG_LEVEL) updatedContent += "LOG_LEVEL=info\n";
        if (!env.REQUIRE_APPROVAL_FOR_ALL) updatedContent += "REQUIRE_APPROVAL_FOR_ALL=false\n";
        await fs.writeFile(envPath, updatedContent, "utf-8");
      }
    }
  }

  // ----- Step 6: Sleep prevention (macOS, gateway/both) -----

  let useCaffeinate = false;
  if (platform === "macos" && (runMode === "gateway" || runMode === "both")) {
    useCaffeinate = await configureSleepPrevention(rl);
  }

  // ----- Step 7: Service installation -----

  if (platform === "macos" || platform === "linux") {
    console.log("");
    const installService = await askYesNo(rl, "Install as background service?");

    if (installService) {
      const logsDir = path.join(paths.configDir, "logs");
      const execStart = paths.execStart(runMode);

      try {
        if (platform === "macos") {
          await installMacosService(execStart, paths.configDir, logsDir, useCaffeinate);
        } else {
          await installLinuxService(execStart, paths.configDir, logsDir);
        }
      } catch (err: any) {
        console.error(`\n  Failed to install service: ${err.message}`);
        console.log("  You can install manually with ./install.sh");
      }

      printManagementCommands(platform, logsDir);
    }
  } else if (platform === "windows") {
    console.log(
      "\nTo run as a service on Windows, open a WSL2 terminal and run: deskmate init",
    );
  }

  // ----- Step 8: Claude Desktop MCP config (mcp/both modes) -----

  if (runMode === "mcp" || runMode === "both") {
    console.log("");
    const configureMcp = await askYesNo(rl, "Configure Claude Desktop for MCP?");
    if (configureMcp) {
      try {
        const nodePath = process.execPath;
        const entryPoint = paths.isGlobalInstall
          ? path.join(paths.packageDir, "dist", "cli.js")
          : path.join(paths.packageDir, "dist", "index.js");
        await configureClaudeDesktop(nodePath, entryPoint, env.WORKING_DIR || os.homedir());
      } catch (err: any) {
        console.error(`  Failed to configure Claude Desktop: ${err.message}`);
      }
    }
  }

  rl.close();

  console.log("\nSetup complete! Your bot is ready.");
  if (paths.isGlobalInstall) {
    console.log(`\nRun "deskmate" to start, or the background service is already running.`);
    console.log(`Config: ${paths.configDir}/.env`);
  }
  console.log("");
}
