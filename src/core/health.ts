import { EventEmitter } from "events";
import * as os from "os";
import { execSync } from "child_process";
import { createLogger } from "./logger";

const log = createLogger("HealthManager");

export interface AgentHealthInfo {
  name: string;
  version: string;
  available: boolean;
  lastCheckedAt: Date;
}

export interface ResourceMetrics {
  cpuLoadPercent: number;
  memoryUsedPercent: number;
  memoryUsedMB: number;
  memoryTotalMB: number;
  diskUsedPercent: number;
  processUptimeSeconds: number;
  nodeHeapUsedMB: number;
}

export interface GatewayHealthInfo {
  uptimeMs: number;
  startedAt: Date;
  activeSessionsCount: number;
  pendingApprovalsCount: number;
  registeredClients: string[];
}

export interface HealthStatus {
  overall: "healthy" | "degraded" | "unhealthy";
  agentProvider: AgentHealthInfo;
  resources: ResourceMetrics;
  gateway: GatewayHealthInfo;
  skills?: { registeredCount: number };
  cron?: { activeJobsCount: number; nextRunAt: Date | null };
  lastHeartbeatAt: Date;
  consecutiveFailures: number;
}

type HealthCheckFn = () => Promise<Partial<HealthStatus>>;

export class HealthManager extends EventEmitter {
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatIntervalMs: number;
  private checks: HealthCheckFn[] = [];
  private cachedStatus: HealthStatus | null = null;
  private consecutiveFailures = 0;

  constructor(options?: { heartbeatIntervalMs?: number }) {
    super();
    this.heartbeatIntervalMs = options?.heartbeatIntervalMs ?? 30_000;
  }

  registerCheck(fn: HealthCheckFn): void {
    this.checks.push(fn);
  }

  async start(): Promise<void> {
    await this.checkNow();
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.checkNow();
      } catch (err: any) {
        log.error("Heartbeat check failed", { error: err.message });
      }
    }, this.heartbeatIntervalMs);
    log.info("HealthManager started", { intervalMs: this.heartbeatIntervalMs });
  }

  getStatus(): HealthStatus | null {
    return this.cachedStatus;
  }

  async checkNow(): Promise<HealthStatus> {
    try {
      const resources = this.collectResourceMetrics();

      // Start with a base status
      let status: HealthStatus = {
        overall: "healthy",
        agentProvider: {
          name: "unknown",
          version: "0.0.0",
          available: false,
          lastCheckedAt: new Date(),
        },
        resources,
        gateway: {
          uptimeMs: 0,
          startedAt: new Date(),
          activeSessionsCount: 0,
          pendingApprovalsCount: 0,
          registeredClients: [],
        },
        lastHeartbeatAt: new Date(),
        consecutiveFailures: 0,
      };

      // Merge in registered checks
      for (const check of this.checks) {
        const partial = await check();
        status = this.mergeStatus(status, partial);
      }

      // Determine overall status
      status.overall = this.determineOverall(status);
      status.consecutiveFailures = this.consecutiveFailures = 0;

      this.cachedStatus = status;
      this.emit("heartbeat", status);
      return status;
    } catch (err: any) {
      this.consecutiveFailures++;
      log.error("Health check failed", {
        error: err.message,
        consecutiveFailures: this.consecutiveFailures,
      });
      if (this.cachedStatus) {
        this.cachedStatus.consecutiveFailures = this.consecutiveFailures;
        this.cachedStatus.overall = this.determineOverall(this.cachedStatus);
      }
      throw err;
    }
  }

  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    log.info("HealthManager stopped");
  }

  private collectResourceMetrics(): ResourceMetrics {
    const loadAvg = os.loadavg();
    const cpuCount = os.cpus().length;
    const cpuLoadPercent = Math.round((loadAvg[0] / cpuCount) * 100);

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memoryUsedPercent = Math.round((usedMem / totalMem) * 100);
    const memoryUsedMB = Math.round(usedMem / (1024 * 1024));
    const memoryTotalMB = Math.round(totalMem / (1024 * 1024));

    const heapUsed = process.memoryUsage().heapUsed;
    const nodeHeapUsedMB = Math.round(heapUsed / (1024 * 1024));

    let diskUsedPercent = 0;
    try {
      const dfOutput = execSync("df -h / | tail -1", {
        encoding: "utf-8",
        timeout: 5000,
      });
      const match = dfOutput.match(/(\d+)%/);
      if (match) {
        diskUsedPercent = parseInt(match[1], 10);
      }
    } catch {
      // disk check failed, leave at 0
    }

    return {
      cpuLoadPercent,
      memoryUsedPercent,
      memoryUsedMB,
      memoryTotalMB,
      diskUsedPercent,
      processUptimeSeconds: Math.round(process.uptime()),
      nodeHeapUsedMB,
    };
  }

  private determineOverall(
    status: HealthStatus,
  ): "healthy" | "degraded" | "unhealthy" {
    // Unhealthy conditions
    if (!status.agentProvider.available) return "unhealthy";
    if (status.resources.memoryUsedPercent > 95) return "unhealthy";
    if (status.consecutiveFailures > 3) return "unhealthy";

    // Degraded conditions
    if (status.resources.memoryUsedPercent > 80) return "degraded";
    if (status.resources.cpuLoadPercent > 90) return "degraded";
    if (status.resources.diskUsedPercent > 90) return "degraded";
    if (status.consecutiveFailures > 0) return "degraded";

    return "healthy";
  }

  private mergeStatus(
    base: HealthStatus,
    partial: Partial<HealthStatus>,
  ): HealthStatus {
    return {
      ...base,
      ...partial,
      agentProvider: partial.agentProvider
        ? { ...base.agentProvider, ...partial.agentProvider }
        : base.agentProvider,
      resources: partial.resources
        ? { ...base.resources, ...partial.resources }
        : base.resources,
      gateway: partial.gateway
        ? { ...base.gateway, ...partial.gateway }
        : base.gateway,
      skills: partial.skills ?? base.skills,
      cron: partial.cron ?? base.cron,
    };
  }
}

export function formatHealthStatus(status: HealthStatus): string {
  const label = status.overall.charAt(0).toUpperCase() + status.overall.slice(1);
  const uptimeStr = formatUptime(status.gateway.uptimeMs);
  const memGB = (status.resources.memoryUsedMB / 1024).toFixed(1);
  const totalGB = (status.resources.memoryTotalMB / 1024).toFixed(1);

  let text =
    `*System Health: ${label}*\n\n` +
    `Agent: ${status.agentProvider.name} v${status.agentProvider.version} (${status.agentProvider.available ? "available" : "unavailable"})\n` +
    `Uptime: ${uptimeStr}\n` +
    `CPU: ${status.resources.cpuLoadPercent}% | Memory: ${status.resources.memoryUsedPercent}% (${memGB}/${totalGB} GB)\n` +
    `Disk: ${status.resources.diskUsedPercent}%\n` +
    `Sessions: ${status.gateway.activeSessionsCount} | Pending approvals: ${status.gateway.pendingApprovalsCount}`;

  if (status.skills) {
    text += `\nSkills: ${status.skills.registeredCount}`;
  }
  if (status.cron) {
    text += ` | Cron jobs: ${status.cron.activeJobsCount} active`;
  }

  return text;
}

function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
