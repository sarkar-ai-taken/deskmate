import { z } from "zod";

const CronActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("command"),
    command: z.string(),
  }),
  z.object({
    type: z.literal("agent_query"),
    prompt: z.string(),
  }),
  z.object({
    type: z.literal("skill"),
    skillName: z.string(),
    params: z.record(z.string(), z.string()).optional(),
  }),
]);

export const CronJobDefinitionSchema = z.object({
  name: z.string().regex(/^[a-z0-9_-]+$/),
  description: z.string().optional(),
  schedule: z.string(),
  action: CronActionSchema,
  enabled: z.boolean().optional().default(true),
  notify: z.boolean().optional().default(false),
  timezone: z.string().optional(),
});

export const CronConfigSchema = z.object({
  version: z.literal(1),
  jobs: z.array(CronJobDefinitionSchema),
});

export type CronAction = z.infer<typeof CronActionSchema>;
export type CronJobDefinition = z.infer<typeof CronJobDefinitionSchema>;
export type CronConfig = z.infer<typeof CronConfigSchema>;

export interface CronJobState {
  name: string;
  description?: string;
  schedule: string;
  enabled: boolean;
  lastRunAt: Date | null;
  lastResult: string | null;
  lastSuccess: boolean | null;
  nextRunAt: Date | null;
  runCount: number;
  failCount: number;
}
