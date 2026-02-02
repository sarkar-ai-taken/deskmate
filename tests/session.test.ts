import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../src/gateway/session";

describe("SessionManager", () => {
  let sm: SessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    sm = new SessionManager({ idleTimeoutMs: 60_000 }); // 1 minute idle timeout
  });

  afterEach(() => {
    sm.stop();
    vi.useRealTimers();
  });

  it("set / get / has / delete basic CRUD", () => {
    expect(sm.has("telegram", "chan1")).toBe(false);
    expect(sm.get("telegram", "chan1")).toBeUndefined();

    sm.set("telegram", "chan1", "session-abc");
    expect(sm.has("telegram", "chan1")).toBe(true);
    expect(sm.get("telegram", "chan1")).toBe("session-abc");

    expect(sm.delete("telegram", "chan1")).toBe(true);
    expect(sm.has("telegram", "chan1")).toBe(false);
    expect(sm.delete("telegram", "chan1")).toBe(false);
  });

  it("get() updates lastActivity and keeps session alive through prune", () => {
    sm.set("telegram", "chan1", "session-abc");

    // Advance 55s — just under idle timeout
    vi.advanceTimersByTime(55_000);

    // Access the session to refresh lastActivity
    expect(sm.get("telegram", "chan1")).toBe("session-abc");

    // At t=60s the first prune fires. Session was accessed at t=55s,
    // so only 5s idle — well under 60s timeout. Should survive.
    vi.advanceTimersByTime(5_000);

    expect(sm.has("telegram", "chan1")).toBe(true);

    // Now advance another 55s (t=115s). Session last accessed at t=55s,
    // so 60s idle. Prune condition is > idleTimeoutMs, so exactly 60s is NOT pruned.
    vi.advanceTimersByTime(55_000);

    // At t=120s second prune fires. 65s since last access — should be pruned.
    vi.advanceTimersByTime(5_000);

    expect(sm.has("telegram", "chan1")).toBe(false);
  });

  it("getRecentChannels() filters by time", () => {
    sm.set("telegram", "chan1", "s1");
    sm.set("discord", "chan2", "s2");

    vi.advanceTimersByTime(30_000);
    sm.set("telegram", "chan3", "s3"); // This one is more recent

    const recent = sm.getRecentChannels(15_000);
    // Only chan3 should be within 15s window
    expect(recent).toEqual([{ clientType: "telegram", channelId: "chan3" }]);

    const allRecent = sm.getRecentChannels(60_000);
    expect(allRecent.length).toBe(3);
  });

  it("prunes idle sessions", () => {
    sm.set("telegram", "chan1", "s1");

    // Advance past idle timeout + prune interval
    vi.advanceTimersByTime(61_000); // past idle timeout
    vi.advanceTimersByTime(60_000); // trigger prune interval

    expect(sm.has("telegram", "chan1")).toBe(false);
  });

  it("stop() clears the prune interval", () => {
    sm.set("telegram", "chan1", "s1");
    sm.stop();

    // Advance way past idle timeout + prune intervals
    vi.advanceTimersByTime(300_000);

    // Session should still exist because pruning was stopped
    expect(sm.has("telegram", "chan1")).toBe(true);
  });
});

describe("SessionManager persistence", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.useRealTimers();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saves and loads sessions across instances", async () => {
    const storagePath = path.join(tmpDir, "sessions.json");

    const sm1 = new SessionManager({ idleTimeoutMs: 600_000, storagePath });
    sm1.set("telegram", "123", "sess-aaa");
    sm1.set("discord", "456", "sess-bbb");
    sm1.stop(); // flushes to disk

    // New instance should load the sessions
    const sm2 = new SessionManager({ idleTimeoutMs: 600_000, storagePath });
    expect(sm2.get("telegram", "123")).toBe("sess-aaa");
    expect(sm2.get("discord", "456")).toBe("sess-bbb");
    sm2.stop();
  });

  it("starts fresh when file does not exist", () => {
    const storagePath = path.join(tmpDir, "nonexistent", "sessions.json");

    const sm = new SessionManager({ idleTimeoutMs: 600_000, storagePath });
    expect(sm.has("telegram", "123")).toBe(false);
    sm.stop();
  });

  it("starts fresh when file is corrupted", () => {
    const storagePath = path.join(tmpDir, "sessions.json");
    fs.writeFileSync(storagePath, "NOT VALID JSON {{{{");

    const sm = new SessionManager({ idleTimeoutMs: 600_000, storagePath });
    expect(sm.has("telegram", "123")).toBe(false);
    // Should still work normally
    sm.set("telegram", "123", "sess-new");
    expect(sm.get("telegram", "123")).toBe("sess-new");
    sm.stop();
  });

  it("creates the data directory if it doesn't exist", () => {
    const storagePath = path.join(tmpDir, "nested", "deep", "sessions.json");

    const sm = new SessionManager({ idleTimeoutMs: 600_000, storagePath });
    sm.set("telegram", "123", "sess-aaa");
    sm.stop();

    // File should have been created
    expect(fs.existsSync(storagePath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(storagePath, "utf-8"));
    expect(data["telegram:123"].agentSessionId).toBe("sess-aaa");
  });

  it("persists deletions", () => {
    const storagePath = path.join(tmpDir, "sessions.json");

    const sm1 = new SessionManager({ idleTimeoutMs: 600_000, storagePath });
    sm1.set("telegram", "123", "sess-aaa");
    sm1.set("discord", "456", "sess-bbb");
    sm1.stop();

    const sm2 = new SessionManager({ idleTimeoutMs: 600_000, storagePath });
    sm2.delete("telegram", "123");
    sm2.stop();

    const sm3 = new SessionManager({ idleTimeoutMs: 600_000, storagePath });
    expect(sm3.has("telegram", "123")).toBe(false);
    expect(sm3.get("discord", "456")).toBe("sess-bbb");
    sm3.stop();
  });
});
