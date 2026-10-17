import { Hono } from "hono";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { TranslateRequestSchema } from "./schemas.js";
import type { Translate } from "./translate.js";

export interface AppDeps {
  /** Null when no Anthropic credentials are configured. */
  readonly translate: Translate | null;
  readonly model: string;
}

export function createApp(deps: AppDeps) {
  return new Hono()
    .use("/api/*", logger())
    .get("/api/health", (c) => c.json({ ok: true, ai: deps.translate !== null, model: deps.model }))
    .post(
      "/api/translate",
      zValidator("json", TranslateRequestSchema, (result, c) => {
        if (!result.success) return c.json({ error: "invalid_request", message: result.error.message }, 400);
        return undefined;
      }),
      async (c) => {
        if (deps.translate === null) {
          throw new HTTPException(503, {
            message: "No Anthropic credentials. Set ANTHROPIC_API_KEY and restart the server to enable natural-language edits.",
          });
        }
        const result = await deps.translate(c.req.valid("json"), c.req.raw.signal);
        return c.json(result);
      },
    )
    .notFound((c) => c.json({ error: "not_found" }, 404))
    .onError((error, c) => {
      if (error instanceof HTTPException) return c.json({ error: "request_failed", message: error.message }, error.status);
      console.error(error);
      return c.json({ error: "internal_error", message: "Unexpected server error." }, 500);
    });
}

export type AppType = ReturnType<typeof createApp>;
