import { describe, it, expect } from "vitest";
import {
  getScreenshotCommand,
  extractBaseFolder,
  getProtectedFolderPatterns,
  getScreenshotHint,
} from "../src/core/platform";
import * as os from "os";
import * as path from "path";

describe("getScreenshotCommand", () => {
  it("returns a command string containing the filepath", () => {
    const cmd = getScreenshotCommand("/tmp/shot.png");
    expect(cmd).toContain("/tmp/shot.png");
    expect(typeof cmd).toBe("string");
  });

  it("returns platform-specific command on macOS", () => {
    if (process.platform === "darwin") {
      const cmd = getScreenshotCommand("/tmp/shot.png");
      expect(cmd).toMatch(/^screencapture/);
    }
  });

  it("returns platform-specific command on Linux", () => {
    if (process.platform === "linux") {
      const cmd = getScreenshotCommand("/tmp/shot.png");
      expect(cmd).toMatch(/^import/);
    }
  });
});

describe("getProtectedFolderPatterns", () => {
  it("returns an array of RegExp", () => {
    const patterns = getProtectedFolderPatterns();
    expect(Array.isArray(patterns)).toBe(true);
    expect(patterns.length).toBeGreaterThan(0);
    for (const p of patterns) {
      expect(p).toBeInstanceOf(RegExp);
    }
  });

  it("matches known protected folders", () => {
    const patterns = getProtectedFolderPatterns();
    const home = os.homedir();
    const desktopPath = path.join(home, "Desktop", "file.txt");
    expect(patterns.some((p) => p.test(desktopPath))).toBe(true);
  });

  it("does not match arbitrary paths", () => {
    const patterns = getProtectedFolderPatterns();
    expect(patterns.some((p) => p.test("/tmp/random/file.txt"))).toBe(false);
  });
});

describe("extractBaseFolder", () => {
  const home = os.homedir();

  it("returns the base folder for a protected path", () => {
    const result = extractBaseFolder(path.join(home, "Desktop", "file.txt"));
    expect(result).toBe(path.join(home, "Desktop"));
  });

  it("returns the base folder for Documents", () => {
    const result = extractBaseFolder(path.join(home, "Documents", "work", "file.txt"));
    expect(result).toBe(path.join(home, "Documents"));
  });

  it("returns null for non-protected paths", () => {
    expect(extractBaseFolder("/tmp/file.txt")).toBeNull();
    expect(extractBaseFolder("/usr/local/bin/node")).toBeNull();
  });
});

describe("getScreenshotHint", () => {
  it("returns a string containing the screenshot directory", () => {
    const hint = getScreenshotHint("/tmp/screenshots");
    expect(hint).toContain("/tmp/screenshots");
    expect(typeof hint).toBe("string");
  });

  it("contains mkdir on macOS/Linux", () => {
    if (process.platform === "darwin" || process.platform === "linux") {
      const hint = getScreenshotHint("/tmp/screenshots");
      expect(hint).toContain("mkdir");
    }
  });
});
