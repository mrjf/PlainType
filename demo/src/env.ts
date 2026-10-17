import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  /** Optional: without credentials the deterministic panes still work. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_AUTH_TOKEN: z.string().min(1).optional(),
  PLAINTYPE_MODEL: z.string().min(1).default("claude-haiku-5-5"),
  PLAINTYPE_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
});

export type Env = z.infer<typeof EnvSchema>;
export const env: Env = EnvSchema.parse(process.env);
export const aiConfigured = env.ANTHROPIC_API_KEY !== undefined || env.ANTHROPIC_AUTH_TOKEN !== undefined;
