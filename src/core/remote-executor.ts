/**
 * RemoteExecutor
 *
 * Implements IExecutor by forwarding every call over HTTP to the host sidecar
 * via a Unix domain socket. Used when INSTALL_MODE=container.
 */

import * as http from "http";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import type { IExecutor } from "./executor-interface";
import type { ExecutionResult, FileInfo } from "./executor";
import { createLogger } from "./logger";

const log = createLogger("RemoteExecutor");

const SOCKET_PATH =
  process.env.SIDECAR_SOCKET_PATH || "/var/run/deskmate/sidecar.sock";

// In container mode, screenshots are saved to a local temp dir
const SCREENSHOT_DIR = path.join(os.tmpdir(), "deskmate-screenshots");

export class RemoteExecutor implements IExecutor {
  private workingDir: string;

  constructor(workingDir?: string) {
    this.workingDir =
      workingDir || process.env.WORKING_DIR || process.env.HOME || "/";
  }

  /**
   * Make an HTTP request to the sidecar over the Unix socket.
   * Public so that BaseCliProvider can use it for /spawn-cli-agent.
   */
  public request<T>(
    method: string,
    urlPath: string,
    body?: unknown,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : undefined;

      const options: http.RequestOptions = {
        socketPath: SOCKET_PATH,
        path: urlPath,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      };

      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          try {
            const data = JSON.parse(text);
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(data.error || `Sidecar returned ${res.statusCode}`));
            } else {
              resolve(data as T);
            }
          } catch {
            reject(new Error(`Invalid sidecar response: ${text.slice(0, 200)}`));
          }
        });
      });

      req.on("error", (err) => {
        reject(
          new Error(
            `Sidecar connection failed (${SOCKET_PATH}): ${err.message}`,
          ),
        );
      });

      if (payload) req.write(payload);
      req.end();
    });
  }

  async executeCommand(command: string, cwd?: string): Promise<ExecutionResult> {
    return this.request<ExecutionResult>("POST", "/execute-command", {
      command,
      cwd: cwd || this.workingDir,
    });
  }

  async readFile(filePath: string): Promise<string> {
    const result = await this.request<{ content: string }>(
      "POST",
      "/read-file",
      { filePath },
    );
    return result.content;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await this.request("POST", "/write-file", { filePath, content });
  }

  async listDirectory(dirPath?: string): Promise<FileInfo[]> {
    return this.request<FileInfo[]>("POST", "/list-directory", { dirPath });
  }

  async getSystemInfo(): Promise<Record<string, string>> {
    return this.request<Record<string, string>>("GET", "/system-info");
  }

  getWorkingDir(): string {
    return this.workingDir;
  }

  setWorkingDir(dir: string): void {
    this.workingDir = dir;
  }

  async takeScreenshot(): Promise<string | null> {
    try {
      const result = await this.request<{
        filepath: string | null;
        data: string | null;
      }>("POST", "/take-screenshot");

      if (!result.filepath || !result.data) return null;

      // Write the base64 PNG data to a local temp file
      await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
      const localPath = path.join(SCREENSHOT_DIR, result.filepath);
      await fs.writeFile(localPath, Buffer.from(result.data, "base64"));

      log.info("Screenshot saved locally", { localPath });
      return localPath;
    } catch (err: any) {
      log.error("Remote screenshot failed", { error: err.message });
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
