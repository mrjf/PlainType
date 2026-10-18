/** Wire formats shared by the server routes and the browser client. */

import { z } from "zod";
import { SLOT_NAME } from "./slots.js";

export const DemoStateSchema = z.object({
  natTemplate: z.string().max(20_000),
  ptTemplate: z.string().max(40_000),
  values: z.record(z.string().regex(SLOT_NAME), z.string().max(2_000)),
});

export const TranslateRequestSchema = z.object({
  natlang: z.string().min(1).max(8_000),
  previous: DemoStateSchema,
});

export type TranslateRequest = z.infer<typeof TranslateRequestSchema>;

export const TranslateResponseSchema = z.object({
  state: DemoStateSchema,
  unmatched: z.array(z.string()),
  compileError: z.string().nullable(),
  attempts: z.number().int(),
  model: z.string(),
  ms: z.number(),
  usage: z.object({ input: z.number(), output: z.number(), cacheRead: z.number() }),
});

export type TranslateResponse = z.infer<typeof TranslateResponseSchema>;

export const ErrorResponseSchema = z.object({ error: z.string(), message: z.string().optional() });

export const HealthSchema = z.object({ ok: z.boolean(), ai: z.boolean(), model: z.string() });

export const HealRequestSchema = z.object({
  raw: z.string().min(1).max(40_000),
  error: z.string().max(2_000).optional(),
});

export type HealRequest = z.infer<typeof HealRequestSchema>;

export const HealResponseSchema = z.object({
  raw: z.string(),
  compileError: z.string().nullable(),
  attempts: z.number().int(),
  model: z.string(),
  ms: z.number(),
  usage: z.object({ input: z.number(), output: z.number(), cacheRead: z.number() }),
});

export type HealResponse = z.infer<typeof HealResponseSchema>;
