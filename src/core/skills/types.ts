import { z } from "zod";

const SkillStepSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("command"),
    command: z.string(),
    continueOnError: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("prompt"),
    prompt: z.string(),
  }),
  z.object({
    type: z.literal("skill"),
    skillName: z.string(),
    params: z.record(z.string(), z.string()).optional(),
  }),
]);

const SkillParameterSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  default: z.string().optional(),
});

export const SkillDefinitionSchema = z.object({
  name: z.string().regex(/^[a-z0-9_-]+$/),
  description: z.string(),
  parameters: z.array(SkillParameterSchema).optional().default([]),
  steps: z.array(SkillStepSchema).min(1),
  confirmBeforeRun: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});

export const SkillsConfigSchema = z.object({
  version: z.literal(1),
  skills: z.array(SkillDefinitionSchema),
});

export type SkillStep = z.infer<typeof SkillStepSchema>;
export type SkillParameter = z.infer<typeof SkillParameterSchema>;
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;
export type SkillsConfig = z.infer<typeof SkillsConfigSchema>;

export interface StepResult {
  stepIndex: number;
  type: string;
  success: boolean;
  output: string;
  durationMs: number;
}

export interface SkillExecutionResult {
  skillName: string;
  success: boolean;
  steps: StepResult[];
  totalDurationMs: number;
}
