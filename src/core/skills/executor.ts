import { createLogger } from "../logger";
import type { IExecutor } from "../executor-interface";
import type { AgentProvider, AgentQueryOptions } from "../agent/types";
import type {
  SkillDefinition,
  SkillExecutionResult,
  StepResult,
} from "./types";

const log = createLogger("SkillExecutor");

export class SkillExecutor {
  private executor: IExecutor;
  private agentProvider: AgentProvider;
  private agentQueryOptions: Partial<AgentQueryOptions>;
  private skillLookup: (name: string) => SkillDefinition | undefined;

  constructor(opts: {
    executor: IExecutor;
    agentProvider: AgentProvider;
    agentQueryOptions?: Partial<AgentQueryOptions>;
    skillLookup: (name: string) => SkillDefinition | undefined;
  }) {
    this.executor = opts.executor;
    this.agentProvider = opts.agentProvider;
    this.agentQueryOptions = opts.agentQueryOptions || {};
    this.skillLookup = opts.skillLookup;
  }

  async execute(
    skill: SkillDefinition,
    params: Record<string, string> = {},
  ): Promise<SkillExecutionResult> {
    const startTime = Date.now();
    const stepResults: StepResult[] = [];
    let overallSuccess = true;

    // Apply default parameter values
    const resolvedParams: Record<string, string> = {};
    if (skill.parameters) {
      for (const p of skill.parameters) {
        if (params[p.name] !== undefined) {
          resolvedParams[p.name] = params[p.name];
        } else if (p.default !== undefined) {
          resolvedParams[p.name] = p.default;
        }
      }
    }
    // Also include any extra params passed
    for (const [k, v] of Object.entries(params)) {
      if (!(k in resolvedParams)) {
        resolvedParams[k] = v;
      }
    }

    log.info("Executing skill", { name: skill.name, params: resolvedParams });

    for (let i = 0; i < skill.steps.length; i++) {
      const step = skill.steps[i];
      const stepStart = Date.now();
      let result: StepResult;

      try {
        switch (step.type) {
          case "command": {
            const cmd = this.interpolate(step.command, resolvedParams);
            const execResult = await this.executor.executeCommand(cmd);
            result = {
              stepIndex: i,
              type: "command",
              success: execResult.success,
              output: execResult.output,
              durationMs: Date.now() - stepStart,
            };
            break;
          }
          case "prompt": {
            const prompt = this.interpolate(step.prompt, resolvedParams);
            const response = await this.agentProvider.query(prompt, {
              ...this.agentQueryOptions,
            });
            result = {
              stepIndex: i,
              type: "prompt",
              success: true,
              output: response.text,
              durationMs: Date.now() - stepStart,
            };
            break;
          }
          case "skill": {
            const nestedSkill = this.skillLookup(step.skillName);
            if (!nestedSkill) {
              result = {
                stepIndex: i,
                type: "skill",
                success: false,
                output: `Skill "${step.skillName}" not found`,
                durationMs: Date.now() - stepStart,
              };
            } else {
              const nestedResult = await this.execute(
                nestedSkill,
                step.params || {},
              );
              result = {
                stepIndex: i,
                type: "skill",
                success: nestedResult.success,
                output: nestedResult.steps
                  .map((s) => s.output)
                  .join("\n"),
                durationMs: Date.now() - stepStart,
              };
            }
            break;
          }
        }
      } catch (err: any) {
        result = {
          stepIndex: i,
          type: step.type,
          success: false,
          output: `Error: ${err.message}`,
          durationMs: Date.now() - stepStart,
        };
      }

      stepResults.push(result);

      if (!result.success) {
        overallSuccess = false;
        const continueOnError =
          step.type === "command" && step.continueOnError;
        if (!continueOnError) {
          log.warn("Skill step failed, stopping execution", {
            skill: skill.name,
            step: i,
          });
          break;
        }
      }
    }

    return {
      skillName: skill.name,
      success: overallSuccess,
      steps: stepResults,
      totalDurationMs: Date.now() - startTime,
    };
  }

  private interpolate(
    template: string,
    params: Record<string, string>,
  ): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return params[key] ?? `{{${key}}}`;
    });
  }
}
