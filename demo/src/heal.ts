/**
 * Heal hand-edited raw PlainType that no longer compiles.
 *
 * The model gets the broken document and the compiler's error and returns a
 * corrected document. The server compiles it, retries once with the new error
 * if needed, and returns the canonical `formatPlainType` text, so a healed
 * document always follows the formatting rules exactly. The browser then
 * re-links slot values onto the healed text.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { HTTPException } from "hono/http-exception";
import { formatPlainType } from "../../src/index.js";
import type { HealOutput, HealRequest } from "./schemas.js";
import type { ModelCall } from "./translate.js";

const MAX_ATTEMPTS = 2;

export interface HealResult {
  readonly raw: string;
  readonly compileError: string | null;
  readonly attempts: number;
  readonly model: string;
  readonly ms: number;
  readonly usage: { readonly input: number; readonly output: number; readonly cacheRead: number };
}

export type Heal = (request: HealRequest, signal?: AbortSignal) => Promise<HealResult>;

/** What the healer needs to know about the notation it repairs. */
export interface HealLanguage {
  /** The parse error for a document, or null when it is valid. */
  readonly check: (source: string) => string | null;
  /** The canonical text of a valid document. */
  readonly canonical: (source: string) => string;
}

export const PLAINTYPE_LANGUAGE: HealLanguage = {
  check: (source) => errorOf(() => formatPlainType(source)),
  canonical: (source) => formatPlainType(source, { style: "plain" }),
};

export function errorOf(attempt: () => unknown): string | null {
  try {
    attempt();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function createHealer(call: ModelCall<HealOutput>, language: HealLanguage = PLAINTYPE_LANGUAGE): Heal {
  return async (request, signal) => {
    const started = performance.now();
    const usage = { input: 0, output: 0, cacheRead: 0 };
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: healTurn(request.raw, request.error ?? language.check(request.raw)) }];

    for (let attempt = 1; ; attempt += 1) {
      const reply = await call(messages, signal);
      usage.input += reply.usage.input;
      usage.output += reply.usage.output;
      usage.cacheRead += reply.usage.cacheRead;
      if (reply.stopReason === "refusal") throw new HTTPException(422, { message: "The model declined to repair this document." });
      if (reply.stopReason === "max_tokens") throw new HTTPException(502, { message: "The model ran out of output tokens." });
      if (!reply.output) throw new HTTPException(502, { message: "The model returned no structured output." });

      const candidate = reply.output.plaintype;
      const error = language.check(candidate);
      if (error === null || attempt >= MAX_ATTEMPTS) {
        return {
          raw: error === null ? language.canonical(candidate) : candidate,
          compileError: error,
          attempts: attempt,
          model: reply.model,
          ms: Math.round(performance.now() - started),
          usage,
        };
      }
      messages.push(
        { role: "assistant", content: reply.content },
        { role: "user", content: `That still does not compile: ${error}\n\nReturn the corrected full document.` },
      );
    }
  };
}

function healTurn(raw: string, error: string | null): string {
  return ["<plaintype>", raw, "</plaintype>", "<compiler_error>", error ?? "none", "</compiler_error>"].join("\n");
}
