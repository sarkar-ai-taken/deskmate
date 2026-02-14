import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as cron from "node-cron";
import { createLogger } from "../logger";
import { CronConfigSchema, type CronJobDefinition, type CronJobState } from "./types";

const log = createLogger("CronScheduler");

export interface ExecutionBackend {
  runCommand: (command: string) => Promise<{ success: boolean; output: string }>;
  runAgentQuery: (prompt: string) => Promise<{ text: string }>;
  runSkill: (
    skillName: string,
    params?: Record<string, string>,
  ) => Promise<{ success: boolean; output: string }>;
}

type NotifierFn = (jobName: string, result: string) => Promise<void>;

export class CronScheduler extends EventEmitter {
  private tasks = new Map<string, cron.ScheduledTask>();
  private jobStates = new Map<string, CronJobState>();
  private jobDefs = new Map<string, CronJobDefinition>();
  private backend: ExecutionBackend | null = null;
  private notifier: NotifierFn | null = null;

  private get configPaths(): string[] {
    return [
      path.join(process.cwd(), "crons.json"),
      path.join(os.homedir(), ".config", "deskmate", "crons.json"),
    ];
  }

  setExecutionBackend(backend: ExecutionBackend): void {
    this.backend = backend;
  }

  setNotifier(fn: NotifierFn): void {
    this.notifier = fn;
  }

  start(): void {
    this.loadAndSchedule();
    log.info("CronScheduler started", { jobCount: this.tasks.size });
  }

  private loadAndSchedule(): void {
    // Stop existing tasks
    for (const task of this.tasks.values()) {
      task.stop();
    }
    this.tasks.clear();
    this.jobStates.clear();
    this.jobDefs.clear();

    const allJobs: CronJobDefinition[] = [];

    for (const configPath of this.configPaths) {
      if (!fs.existsSync(configPath)) continue;

      try {
        const raw = fs.readFileSync(configPath, "utf-8");
        const json = JSON.parse(raw);
        const config = CronConfigSchema.parse(json);
        allJobs.push(...config.jobs);
        log.info("Loaded cron config", {
          path: configPath,
          count: config.jobs.length,
        });
      } catch (err: any) {
        log.warn("Failed to load cron config", {
          path: configPath,
          error: err.message,
        });
      }
    }

    // Later definitions override earlier ones by name
    const jobMap = new Map<string, CronJobDefinition>();
    for (const job of allJobs) {
      jobMap.set(job.name, job);
    }

    for (const job of jobMap.values()) {
      this.jobDefs.set(job.name, job);

      this.jobStates.set(job.name, {
        name: job.name,
        description: job.description,
        schedule: job.schedule,
        enabled: job.enabled,
        lastRunAt: null,
        lastResult: null,
        lastSuccess: null,
        nextRunAt: null,
        runCount: 0,
        failCount: 0,
      });

      if (!job.enabled) continue;

      if (!cron.validate(job.schedule)) {
        log.warn("Invalid cron expression, skipping", {
          name: job.name,
          schedule: job.schedule,
        });
        continue;
      }

      const options: cron.ScheduleOptions = {
        scheduled: true,
        timezone: job.timezone,
      };

      const task = cron.schedule(
        job.schedule,
        () => {
          this.executeJob(job).catch((err) => {
            log.error("Cron job execution error", {
              name: job.name,
              error: err.message,
            });
          });
        },
        options,
      );

      this.tasks.set(job.name, task);
    }
  }

  private async executeJob(job: CronJobDefinition): Promise<void> {
    if (!this.backend) {
      log.warn("No execution backend set, skipping job", { name: job.name });
      return;
    }

    const state = this.jobStates.get(job.name);
    if (!state) return;

    state.lastRunAt = new Date();
    log.info("Executing cron job", { name: job.name, type: job.action.type });

    try {
      let result: string;

      switch (job.action.type) {
        case "command": {
          const res = await this.backend.runCommand(job.action.command);
          result = res.output;
          if (!res.success) throw new Error(`Command failed: ${result}`);
          break;
        }
        case "agent_query": {
          const res = await this.backend.runAgentQuery(job.action.prompt);
          result = res.text;
          break;
        }
        case "skill": {
          const res = await this.backend.runSkill(
            job.action.skillName,
            job.action.params,
          );
          result = res.output;
          if (!res.success) throw new Error(`Skill failed: ${result}`);
          break;
        }
      }

      state.lastResult = result.slice(0, 2000);
      state.lastSuccess = true;
      state.runCount++;

      this.emit("job-completed", { name: job.name, success: true, result });
      log.info("Cron job completed", { name: job.name });

      if (job.notify && this.notifier) {
        await this.notifier(
          job.name,
          `Cron job *${job.name}* completed:\n\n${result.slice(0, 3000)}`,
        );
      }
    } catch (err: any) {
      state.lastResult = err.message;
      state.lastSuccess = false;
      state.runCount++;
      state.failCount++;

      this.emit("job-completed", {
        name: job.name,
        success: false,
        error: err.message,
      });
      log.error("Cron job failed", { name: job.name, error: err.message });

      if (job.notify && this.notifier) {
        await this.notifier(
          job.name,
          `Cron job *${job.name}* failed:\n\n${err.message}`,
        );
      }
    }
  }

  getJobStates(): CronJobState[] {
    return Array.from(this.jobStates.values());
  }

  getJobState(name: string): CronJobState | undefined {
    return this.jobStates.get(name);
  }

  activeCount(): number {
    return this.tasks.size;
  }

  getNextRunAt(): Date | null {
    // node-cron doesn't expose next run time directly,
    // so we return null for now
    return null;
  }

  stop(): void {
    for (const task of this.tasks.values()) {
      task.stop();
    }
    this.tasks.clear();
    log.info("CronScheduler stopped");
  }
}
