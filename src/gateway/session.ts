import * as fs from "fs";
import * as path from "path";
import { createLogger } from "../core/logger";

const log = createLogger("SessionManager");

export interface SessionEntry {
  agentSessionId: string;
  createdAt: Date;
  lastActivity: Date;
}

interface SerializedSessionEntry {
  agentSessionId: string;
  createdAt: string;
  lastActivity: string;
}

export class SessionManager {
  /** Composite key: `clientType:channelId` -> session */
  private sessions = new Map<string, SessionEntry>();
  private idleTimeoutMs: number;
  private pruneInterval: ReturnType<typeof setInterval> | null = null;
  private storagePath: string | null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly DEBOUNCE_MS = 500;

  constructor(options?: {
    idleTimeoutMs?: number;
    storagePath?: string;
  }) {
    const idleTimeoutMs = options?.idleTimeoutMs ?? 30 * 60 * 1000;
    this.idleTimeoutMs = idleTimeoutMs;
    this.storagePath = options?.storagePath ?? null;

    if (this.storagePath) {
      this.loadFromDisk();
    }

    this.pruneInterval = setInterval(() => this.pruneIdle(), 60_000);
    log.info("SessionManager initialized", { idleTimeoutMs, storagePath: this.storagePath });
  }

  private key(clientType: string, channelId: string): string {
    return `${clientType}:${channelId}`;
  }

  get(clientType: string, channelId: string): string | undefined {
    const entry = this.sessions.get(this.key(clientType, channelId));
    if (entry) {
      entry.lastActivity = new Date();
      this.scheduleSave();
      return entry.agentSessionId;
    }
    return undefined;
  }

  set(clientType: string, channelId: string, agentSessionId: string): void {
    const k = this.key(clientType, channelId);
    this.sessions.set(k, {
      agentSessionId,
      createdAt: new Date(),
      lastActivity: new Date(),
    });
    log.debug("Session stored", { key: k, agentSessionId });
    this.scheduleSave();
  }

  delete(clientType: string, channelId: string): boolean {
    const k = this.key(clientType, channelId);
    const had = this.sessions.has(k);
    this.sessions.delete(k);
    if (had) {
      log.debug("Session deleted", { key: k });
      this.scheduleSave();
    }
    return had;
  }

  has(clientType: string, channelId: string): boolean {
    return this.sessions.has(this.key(clientType, channelId));
  }

  /** Remove sessions that have been idle longer than idleTimeoutMs */
  private pruneIdle(): void {
    const now = Date.now();
    let pruned = 0;
    for (const [k, entry] of this.sessions) {
      if (now - entry.lastActivity.getTime() > this.idleTimeoutMs) {
        this.sessions.delete(k);
        pruned++;
      }
    }
    if (pruned > 0) {
      log.info("Pruned idle sessions", { pruned, remaining: this.sessions.size });
      this.scheduleSave();
    }
  }

  /** Get all channel IDs with recent activity (within the last N ms) */
  getRecentChannels(withinMs: number): Array<{ clientType: string; channelId: string }> {
    const cutoff = Date.now() - withinMs;
    const result: Array<{ clientType: string; channelId: string }> = [];
    for (const [k, entry] of this.sessions) {
      if (entry.lastActivity.getTime() >= cutoff) {
        const [clientType, ...rest] = k.split(":");
        result.push({ clientType, channelId: rest.join(":") });
      }
    }
    return result;
  }

  stop(): void {
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = null;
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    // Flush any pending save synchronously on stop
    if (this.storagePath) {
      this.saveToDiskSync();
    }
  }

  // ── Persistence ──────────────────────────────────────────────

  private loadFromDisk(): void {
    if (!this.storagePath) return;
    try {
      const raw = fs.readFileSync(this.storagePath, "utf-8");
      const data: Record<string, SerializedSessionEntry> = JSON.parse(raw);
      for (const [key, entry] of Object.entries(data)) {
        this.sessions.set(key, {
          agentSessionId: entry.agentSessionId,
          createdAt: new Date(entry.createdAt),
          lastActivity: new Date(entry.lastActivity),
        });
      }
      log.info("Loaded sessions from disk", { count: this.sessions.size, path: this.storagePath });
    } catch (err: any) {
      if (err.code === "ENOENT") {
        log.info("No existing session file, starting fresh", { path: this.storagePath });
      } else {
        log.warn("Failed to load sessions from disk, starting fresh", { error: err.message, path: this.storagePath });
      }
    }
  }

  private serialize(): Record<string, SerializedSessionEntry> {
    const data: Record<string, SerializedSessionEntry> = {};
    for (const [key, entry] of this.sessions) {
      data[key] = {
        agentSessionId: entry.agentSessionId,
        createdAt: entry.createdAt.toISOString(),
        lastActivity: entry.lastActivity.toISOString(),
      };
    }
    return data;
  }

  private saveToDiskSync(): void {
    if (!this.storagePath) return;
    try {
      const dir = path.dirname(this.storagePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.storagePath, JSON.stringify(this.serialize(), null, 2));
    } catch (err: any) {
      log.error("Failed to save sessions to disk", { error: err.message, path: this.storagePath });
    }
  }

  private scheduleSave(): void {
    if (!this.storagePath) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveToDiskSync();
    }, SessionManager.DEBOUNCE_MS);
  }
}
