import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { createLogger } from "./logger";
import { approvalManager } from "./approval";
import { getScreenshotCommand } from "./platform";

const log = createLogger("Executor");

const execAsync = promisify(exec);

// Screenshot directory
const SCREENSHOT_DIR = path.join(os.tmpdir(), "deskmate-screenshots");

export interface ExecutionResult {
  success: boolean;
  output: string;
  exitCode: number | null;
}

export interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: Date;
}

export class Executor {
  private workingDir: string;

  constructor(workingDir?: string) {
    this.workingDir = workingDir || process.env.WORKING_DIR || process.env.HOME || "/";
  }

  async executeCommand(command: string, cwd?: string): Promise<ExecutionResult> {
    const workingDir = cwd || this.workingDir;

    log.info("Executing command", { command, workingDir });
    log.debug("Command details", { shell: process.platform === "win32" ? "powershell.exe" : "/bin/zsh" });

    try {
      const startTime = Date.now();
      const { stdout, stderr } = await execAsync(command, {
        cwd: workingDir,
        timeout: 120000, // 2 minute timeout
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
        shell: process.platform === "win32" ? "powershell.exe" : "/bin/zsh",
        env: { ...process.env, PATH: process.env.PATH },
      });

      const duration = Date.now() - startTime;
      const output = (stdout || stderr).trim();

      log.info("Command completed successfully", { command, exitCode: 0, durationMs: duration });
      log.debug("Command output", { output: output.slice(0, 500), outputLength: output.length });

      return {
        success: true,
        output: output || "(command completed with no output)",
        exitCode: 0,
      };
    } catch (error: any) {
      log.error("Command failed", {
        command,
        exitCode: error.code ?? 1,
        error: error.message,
      });
      log.debug("Command error details", { stderr: error.stderr, stdout: error.stdout });

      return {
        success: false,
        output: error.stderr || error.stdout || error.message,
        exitCode: error.code ?? 1,
      };
    }
  }

  async readFile(filePath: string): Promise<string> {
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.workingDir, filePath);

    log.debug("Reading file", { filePath, resolvedPath });

    // Check if folder access approval is needed
    const approved = await approvalManager.requestFolderAccess(resolvedPath);
    if (!approved) {
      throw new Error(`Access to ${resolvedPath} was not approved`);
    }

    const content = await fs.readFile(resolvedPath, "utf-8");

    log.info("File read successfully", { filePath: resolvedPath, size: content.length });
    return content;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.workingDir, filePath);

    log.debug("Writing file", { filePath, resolvedPath, contentLength: content.length });

    // Check if folder access approval is needed
    const approved = await approvalManager.requestFolderAccess(resolvedPath);
    if (!approved) {
      throw new Error(`Access to ${resolvedPath} was not approved`);
    }

    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, content, "utf-8");

    log.info("File written successfully", { filePath: resolvedPath, size: content.length });
  }

  async listDirectory(dirPath?: string): Promise<FileInfo[]> {
    const resolvedPath = dirPath
      ? path.isAbsolute(dirPath)
        ? dirPath
        : path.join(this.workingDir, dirPath)
      : this.workingDir;

    log.debug("Listing directory", { dirPath, resolvedPath });

    // Check if folder access approval is needed
    const approved = await approvalManager.requestFolderAccess(resolvedPath);
    if (!approved) {
      throw new Error(`Access to ${resolvedPath} was not approved`);
    }

    const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
    const files: FileInfo[] = [];

    for (const entry of entries) {
      const fullPath = path.join(resolvedPath, entry.name);
      try {
        const stats = await fs.stat(fullPath);
        files.push({
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          size: stats.size,
          modified: stats.mtime,
        });
      } catch {
        // Skip files we can't stat
      }
    }

    log.info("Directory listed", { path: resolvedPath, itemCount: files.length });
    return files;
  }

  async getSystemInfo(): Promise<Record<string, string>> {
    const info: Record<string, string> = {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      workingDir: this.workingDir,
      homeDir: process.env.HOME || "",
      user: process.env.USER || "",
    };

    // Get additional system info
    try {
      const { stdout: hostname } = await execAsync("hostname");
      info.hostname = hostname.trim();
    } catch {}

    try {
      const { stdout: uptime } = await execAsync("uptime");
      info.uptime = uptime.trim();
    } catch {}

    return info;
  }

  getWorkingDir(): string {
    return this.workingDir;
  }

  setWorkingDir(dir: string): void {
    this.workingDir = dir;
  }

  async takeScreenshot(): Promise<string | null> {
    try {
      // Ensure screenshot directory exists
      await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

      const filename = `screenshot-${Date.now()}.png`;
      const filepath = path.join(SCREENSHOT_DIR, filename);

      log.info("Taking screenshot", { filepath });

      await execAsync(getScreenshotCommand(filepath), {
        timeout: 10000,
      });

      // Verify file was created
      await fs.access(filepath);
      log.info("Screenshot saved", { filepath });

      return filepath;
    } catch (error: any) {
      log.error("Screenshot failed", { error: error.message });
      return null;
    }
  }

  async getRecentScreenshots(since: Date): Promise<string[]> {
    try {
      await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
      const files = await fs.readdir(SCREENSHOT_DIR);
      const screenshots: string[] = [];

      for (const file of files) {
        if (!file.endsWith(".png")) continue;
        const filepath = path.join(SCREENSHOT_DIR, file);
        const stats = await fs.stat(filepath);
        if (stats.mtime >= since) {
          screenshots.push(filepath);
        }
      }

      return screenshots.sort();
    } catch {
      return [];
    }
  }

  async cleanupScreenshots(): Promise<void> {
    try {
      const files = await fs.readdir(SCREENSHOT_DIR);
      for (const file of files) {
        if (file.endsWith(".png")) {
          await fs.unlink(path.join(SCREENSHOT_DIR, file)).catch(() => {});
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  getScreenshotDir(): string {
    return SCREENSHOT_DIR;
  }
}
