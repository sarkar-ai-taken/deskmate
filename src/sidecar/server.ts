/**
 * Sidecar Server
 *
 * Lightweight HTTP server that listens on a Unix domain socket and exposes
 * the local Executor's capabilities to the containerised Deskmate core.
 *
 * Routes mirror the IExecutor interface so RemoteExecutor can call them 1-to-1.
 */

import * as http from "http";
import * as fs from "fs/promises";
import * as path from "path";
import { Executor } from "../core/executor";
import { createLogger } from "../core/logger";
import { spawn } from "child_process";

const log = createLogger("Sidecar");

const SOCKET_PATH =
  process.env.SIDECAR_SOCKET_PATH || "/var/run/deskmate/sidecar.sock";

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function error(res: http.ServerResponse, msg: string, status = 500): void {
  json(res, { error: msg }, status);
}

export async function startSidecar(): Promise<http.Server> {
  const executor = new Executor();

  const server = http.createServer(async (req, res) => {
    const url = req.url || "/";
    const method = req.method || "GET";

    try {
      // GET /health
      if (method === "GET" && url === "/health") {
        return json(res, { status: "ok", pid: process.pid });
      }

      // POST /execute-command
      if (method === "POST" && url === "/execute-command") {
        const body = JSON.parse(await readBody(req));
        const result = await executor.executeCommand(body.command, body.cwd);
        return json(res, result);
      }

      // POST /read-file
      if (method === "POST" && url === "/read-file") {
        const body = JSON.parse(await readBody(req));
        const content = await executor.readFile(body.filePath);
        return json(res, { content });
      }

      // POST /write-file
      if (method === "POST" && url === "/write-file") {
        const body = JSON.parse(await readBody(req));
        await executor.writeFile(body.filePath, body.content);
        return json(res, { success: true });
      }

      // POST /list-directory
      if (method === "POST" && url === "/list-directory") {
        const body = JSON.parse(await readBody(req));
        const files = await executor.listDirectory(body.dirPath);
        return json(res, files);
      }

      // GET /system-info
      if (method === "GET" && url === "/system-info") {
        const info = await executor.getSystemInfo();
        return json(res, info);
      }

      // POST /take-screenshot
      if (method === "POST" && url === "/take-screenshot") {
        const filepath = await executor.takeScreenshot();
        if (!filepath) {
          return json(res, { filepath: null, data: null });
        }
        const data = await fs.readFile(filepath);
        const base64 = data.toString("base64");
        // Clean up after reading
        await fs.unlink(filepath).catch(() => {});
        return json(res, { filepath: path.basename(filepath), data: base64 });
      }

      // POST /spawn-cli-agent
      if (method === "POST" && url === "/spawn-cli-agent") {
        const body = JSON.parse(await readBody(req));
        const { binary, args, env: procEnv, cwd } = body;

        const result = await new Promise<{
          output: string;
          stderr: string;
          exitCode: number | null;
        }>((resolve) => {
          let stdout = "";
          let stderr = "";

          const child = spawn(binary, args || [], {
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, ...procEnv },
            cwd: cwd || process.env.HOME || "/",
          });

          child.stdout!.on("data", (d: Buffer) => {
            stdout += d.toString();
          });
          child.stderr!.on("data", (d: Buffer) => {
            stderr += d.toString();
          });

          child.on("error", (err) => {
            resolve({ output: "", stderr: err.message, exitCode: 1 });
          });

          child.on("close", (code) => {
            resolve({ output: stdout, stderr, exitCode: code });
          });
        });

        return json(res, result);
      }

      // Not found
      error(res, `Unknown route: ${method} ${url}`, 404);
    } catch (err: any) {
      log.error("Request error", { url, error: err.message });
      error(res, err.message);
    }
  });

  // Remove stale socket, ensure directory exists
  const socketDir = path.dirname(SOCKET_PATH);
  await fs.mkdir(socketDir, { recursive: true });
  await fs.unlink(SOCKET_PATH).catch(() => {});

  return new Promise((resolve) => {
    server.listen(SOCKET_PATH, async () => {
      // Make socket accessible
      await fs.chmod(SOCKET_PATH, 0o666).catch(() => {});
      log.info("Sidecar listening", { socket: SOCKET_PATH, pid: process.pid });
      resolve(server);
    });
  });
}

/**
 * Graceful shutdown helper — called from the CLI entry point.
 */
export function setupGracefulShutdown(server: http.Server): void {
  const shutdown = () => {
    log.info("Shutting down sidecar...");
    server.close(() => {
      fs.unlink(SOCKET_PATH).catch(() => {});
      process.exit(0);
    });
    // Force exit after 3 seconds
    setTimeout(() => process.exit(0), 3000);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
