import { z } from "zod";

export {
  DemoStateSchema,
  HealRequestSchema,
  InstanceTranslateRequestSchema,
  TranslateRequestSchema,
  type HealRequest,
  type InstanceTranslateRequest,
  type TranslateRequest,
} from "../shared/api.js";

/** What the model returns; the server derives the natural-language template itself. */
export const ModelOutputSchema = z.object({
  plaintypeTemplate: z.string(),
  slots: z.array(z.object({ name: z.string(), value: z.string() })),
});

export type ModelOutput = z.infer<typeof ModelOutputSchema>;

/** What the healer returns: the complete corrected document. */
export const HealOutputSchema = z.object({ plaintype: z.string() });

export type HealOutput = z.infer<typeof HealOutputSchema>;

/** What the instance translator returns; the server derives the natural-language template. */
export const InstanceModelOutputSchema = z.object({
  instanceTemplate: z.string(),
  slots: z.array(z.object({ name: z.string(), value: z.string() })),
});

export type InstanceModelOutput = z.infer<typeof InstanceModelOutputSchema>;
