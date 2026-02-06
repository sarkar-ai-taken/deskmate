/**
 * Native macOS system tray for deskmate
 *
 * Compiles a small Swift binary on first run, caches it at
 * ~/.cache/deskmate/tray-mac, and spawns it.  The Swift app creates an
 * NSStatusItem ("DM") and prints actions to stdout which we handle here.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn, execFileSync } from "child_process";
import { detectPlatform, resolveInstallPaths, plistPath } from "./init";
import { createLogger } from "../core/logger";

const log = createLogger("Tray");

function findSwiftSource(): string | null {
  // When running from source (ts-node / tsx): src/cli/tray-mac.swift
  // When running from dist (compiled JS):     the file ships alongside dist
  // npm package includes src/cli/tray-mac.swift via "files" in package.json
  const candidates = [
    path.join(__dirname, "tray-mac.swift"),                        // dist/cli/tray-mac.swift (copied) or src/cli/ (tsx)
    path.join(__dirname, "..", "..", "src", "cli", "tray-mac.swift"), // dist/cli/ → ../../src/cli/
    path.join(__dirname, "..", "src", "cli", "tray-mac.swift"),      // alternate layout
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function startTray(version: string): void {
  try {
    if (detectPlatform() !== "macos") {
      log.info("Tray only supported on macOS");
      return;
    }

    const swiftSource = findSwiftSource();
    if (!swiftSource) {
      log.warn("Swift source (tray-mac.swift) not found — tray disabled");
      return;
    }

    const cacheDir = path.join(os.homedir(), ".cache", "deskmate");
    const binaryPath = path.join(cacheDir, "tray-mac");

    // Compile if binary missing or source is newer
    let needsCompile = !fs.existsSync(binaryPath);
    if (!needsCompile) {
      const srcMtime = fs.statSync(swiftSource).mtimeMs;
      const binMtime = fs.statSync(binaryPath).mtimeMs;
      needsCompile = srcMtime > binMtime;
    }

    if (needsCompile) {
      log.info("Compiling tray binary (first run)...");
      fs.mkdirSync(cacheDir, { recursive: true });
      try {
        execFileSync("swiftc", [
          "-O",
          "-o", binaryPath,
          swiftSource,
        ], { stdio: "pipe", timeout: 60_000 });
        log.info("Tray binary compiled successfully");
      } catch (err: any) {
        log.warn(`Failed to compile tray binary: ${err.message}`);
        return;
      }
    }

    // Resolve runtime paths
    const paths = resolveInstallPaths();
    const logsDir = path.join(paths.configDir, "logs");
    const logFile = path.join(logsDir, "stdout.log");
    const plistFile = plistPath();

    const child = spawn(binaryPath, [
      "--version", version,
      "--log-file", logFile,
      "--plist", plistFile,
      "--pid", String(process.pid),
    ], {
      stdio: ["ignore", "pipe", "ignore"],
    });

    child.stdout.on("data", (data: Buffer) => {
      const lines = data.toString().trim().split("\n");
      for (const line of lines) {
        const action = line.trim();
        if (action === "quit") {
          log.info("Quit requested from tray");
          process.exit(0);
        }
        // "viewlogs" and "restart" are handled directly by the Swift binary
      }
    });

    child.on("error", (err) => {
      log.warn(`Tray process error: ${err.message}`);
    });

    child.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        log.warn(`Tray process exited with code ${code}`);
      }
    });

    // Don't let the tray child keep the Node process alive
    child.unref();

    log.info("System tray started");
  } catch (err: any) {
    log.warn(`System tray unavailable: ${err.message}`);
  }
}
