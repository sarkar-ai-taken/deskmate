import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createLogger } from "../logger";
import { SkillsConfigSchema, type SkillDefinition } from "./types";

const log = createLogger("SkillRegistry");

export class SkillRegistry extends EventEmitter {
  private skills = new Map<string, SkillDefinition>();
  private watchInterval: ReturnType<typeof setInterval> | null = null;
  private lastMtimes = new Map<string, number>();

  private get configPaths(): string[] {
    return [
      path.join(process.cwd(), "skills.json"),
      path.join(os.homedir(), ".config", "deskmate", "skills.json"),
    ];
  }

  load(): void {
    this.skills.clear();

    for (const configPath of this.configPaths) {
      if (!fs.existsSync(configPath)) continue;

      try {
        const raw = fs.readFileSync(configPath, "utf-8");
        const json = JSON.parse(raw);
        const config = SkillsConfigSchema.parse(json);

        for (const skill of config.skills) {
          this.skills.set(skill.name, skill);
        }

        const stat = fs.statSync(configPath);
        this.lastMtimes.set(configPath, stat.mtimeMs);

        log.info("Loaded skills", { path: configPath, count: config.skills.length });
      } catch (err: any) {
        log.warn("Failed to load skills config", {
          path: configPath,
          error: err.message,
        });
      }
    }

    log.info("Total skills registered", { count: this.skills.size });
  }

  startWatching(intervalMs = 30_000): void {
    this.watchInterval = setInterval(() => {
      let changed = false;

      for (const configPath of this.configPaths) {
        if (!fs.existsSync(configPath)) {
          if (this.lastMtimes.has(configPath)) {
            changed = true;
            this.lastMtimes.delete(configPath);
          }
          continue;
        }

        try {
          const stat = fs.statSync(configPath);
          const lastMtime = this.lastMtimes.get(configPath);
          if (lastMtime === undefined || stat.mtimeMs !== lastMtime) {
            changed = true;
          }
        } catch {
          // ignore stat errors
        }
      }

      if (changed) {
        log.info("Skills config changed, reloading");
        this.load();
        this.emit("reloaded");
      }
    }, intervalMs);
  }

  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  getAll(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  list(): Array<{ name: string; description: string }> {
    return this.getAll().map((s) => ({
      name: s.name,
      description: s.description,
    }));
  }

  size(): number {
    return this.skills.size;
  }

  getSystemPromptSection(): string {
    if (this.skills.size === 0) return "";

    const lines = ["\n\nAVAILABLE SKILLS:"];
    for (const skill of this.skills.values()) {
      const params = skill.parameters && skill.parameters.length > 0
        ? ` (params: ${skill.parameters.map((p) => p.name).join(", ")})`
        : "";
      lines.push(`- ${skill.name}: ${skill.description}${params}`);
    }
    lines.push(
      "You can suggest running these skills when relevant to the user's request.",
    );
    return lines.join("\n");
  }

  stop(): void {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }
  }
}
