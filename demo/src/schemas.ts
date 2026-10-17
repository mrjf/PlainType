import { z } from "zod";

export { DemoStateSchema, TranslateRequestSchema, type TranslateRequest } from "../shared/api.js";

/** What the model returns; the server derives the natural-language template itself. */
export const ModelOutputSchema = z.object({
  plaintypeTemplate: z.string(),
  slots: z.array(z.object({ name: z.string(), value: z.string() })),
});

export type ModelOutput = z.infer<typeof ModelOutputSchema>;
