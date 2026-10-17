/**
 * Natural language -> templated PlainType, via a small fast Claude model.
 *
 * The model proposes a PlainType template plus slot values. The server then
 * checks the proposal deterministically (slot bookkeeping, verbatim values,
 * and a real compile) and, if anything is off, asks the model once more with
 * the exact problems. The natural-language template is never model output: it
 * is computed by linking slot values back onto the user's text.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { HTTPException } from "hono/http-exception";
import { compile, stateFromSlots, type DemoState } from "../shared/state.js";
import { SLOT_NAME, render, slotNames, type SlotValue } from "../shared/slots.js";
import { ModelOutputSchema, type ModelOutput, type TranslateRequest } from "./schemas.js";

const MAX_ATTEMPTS = 2;

export interface TranslateResult {
  readonly state: DemoState;
  readonly unmatched: readonly string[];
  readonly compileError: string | null;
  readonly attempts: number;
  readonly model: string;
  readonly ms: number;
  readonly usage: { readonly input: number; readonly output: number; readonly cacheRead: number };
}

export type Translate = (request: TranslateRequest, signal?: AbortSignal) => Promise<TranslateResult>;

/** One model turn, reduced to what the translator needs. */
export interface ModelReply {
  readonly output: ModelOutput | null;
  readonly stopReason: string | null;
  /** The assistant turn to append when asking for a correction. */
  readonly content: Anthropic.ContentBlockParam[];
  readonly model: string;
  readonly usage: { readonly input: number; readonly output: number; readonly cacheRead: number };
}

export type ModelCall = (messages: readonly Anthropic.MessageParam[], signal?: AbortSignal) => Promise<ModelReply>;

export interface AnthropicCallOptions {
  readonly client: Anthropic;
  readonly systemPrompt: string;
  readonly model: string;
  readonly effort: "low" | "medium" | "high";
}

export function anthropicModelCall(options: AnthropicCallOptions): ModelCall {
  const format = zodOutputFormat(ModelOutputSchema);
  return async (messages, signal) => {
    try {
      const response = await options.client.messages.parse(
        {
          model: options.model,
          max_tokens: 8_000,
          // The system prompt never changes, so every request reuses its cache entry.
          system: [{ type: "text", text: options.systemPrompt, cache_control: { type: "ephemeral" } }],
          messages: [...messages],
          output_config: { effort: options.effort, format },
        },
        signal ? { signal } : {},
      );
      return {
        output: response.parsed_output,
        stopReason: response.stop_reason,
        content: response.content.map(toParam),
        model: response.model,
        usage: {
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
          cacheRead: response.usage.cache_read_input_tokens ?? 0,
        },
      };
    } catch (error) {
      if (error instanceof Anthropic.APIUserAbortError) throw error; // the browser gave up; nobody is listening
      if (error instanceof Anthropic.AuthenticationError) throw new HTTPException(503, { message: "Anthropic credentials were rejected." });
      if (error instanceof Anthropic.RateLimitError) throw new HTTPException(429, { message: "Rate limited by the model API; try again shortly." });
      if (error instanceof Anthropic.APIError) throw new HTTPException(502, { message: `Model API error: ${error.message}` });
      throw error;
    }
  };
}

export function createTranslator(call: ModelCall): Translate {
  return async (request, signal) => {
    const started = performance.now();
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: userTurn(request) }];
    const usage = { input: 0, output: 0, cacheRead: 0 };

    for (let attempt = 1; ; attempt += 1) {
      const reply = await call(messages, signal);
      usage.input += reply.usage.input;
      usage.output += reply.usage.output;
      usage.cacheRead += reply.usage.cacheRead;

      if (reply.stopReason === "refusal") throw new HTTPException(422, { message: "The model declined this description." });
      if (reply.stopReason === "max_tokens") throw new HTTPException(502, { message: "The model ran out of output tokens." });
      if (!reply.output) throw new HTTPException(502, { message: "The model returned no structured output." });

      const review = reviewOutput(request.natlang, reply.output);
      if (review.problems.length === 0 || attempt >= MAX_ATTEMPTS) {
        return {
          state: review.state,
          unmatched: review.unmatched,
          compileError: review.compileError,
          attempts: attempt,
          model: reply.model,
          ms: Math.round(performance.now() - started),
          usage,
        };
      }
      messages.push(
        { role: "assistant", content: reply.content },
        {
          role: "user",
          content: `That output has these problems:\n${review.problems.map((problem) => `- ${problem}`).join("\n")}\n\nReturn the corrected full output.`,
        },
      );
    }
  };
}

/** Echo a response block back as a request block, keeping thinking blocks intact. */
function toParam(block: Anthropic.ContentBlock): Anthropic.ContentBlockParam {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "thinking":
      return { type: "thinking", thinking: block.thinking, signature: block.signature };
    case "redacted_thinking":
      return { type: "redacted_thinking", data: block.data };
    default:
      return { type: "text", text: "" };
  }
}

export interface Review {
  readonly state: DemoState;
  readonly unmatched: readonly string[];
  readonly compileError: string | null;
  readonly problems: readonly string[];
}

export function reviewOutput(natlang: string, output: ModelOutput): Review {
  const problems: string[] = [];
  const slots: SlotValue[] = [];
  const seen = new Set<string>();
  for (const slot of output.slots) {
    if (!SLOT_NAME.test(slot.name)) {
      problems.push(`Slot name ${JSON.stringify(slot.name)} is not a valid identifier.`);
    } else if (seen.has(slot.name)) {
      problems.push(`Slot ${slot.name} is listed more than once.`);
    } else {
      seen.add(slot.name);
      slots.push(slot);
    }
  }

  const used = slotNames(output.plaintypeTemplate);
  for (const name of used) if (!seen.has(name)) problems.push(`Placeholder {{${name}}} has no slot entry.`);
  for (const name of seen) if (!used.includes(name)) problems.push(`Slot ${name} is not used in the template.`);

  const { state, unmatched } = stateFromSlots(natlang, output.plaintypeTemplate, slots);
  for (const name of unmatched) {
    const value = slots.find((slot) => slot.name === name)?.value ?? "";
    problems.push(
      `Slot ${name} has value ${JSON.stringify(value)}, which does not appear verbatim in the description. Copy the value exactly, or write it literally in the template.`,
    );
  }

  const compiled = compile(render(state.ptTemplate, state.values));
  const compileError = compiled.ok ? null : compiled.error;
  if (compileError !== null) problems.push(`With the slot values filled in, the PlainType does not compile: ${compileError}.`);

  return { state, unmatched, compileError, problems };
}

function userTurn(request: TranslateRequest): string {
  const previous = request.previous;
  const previousValues = Object.entries(previous.values).map(([name, value]) => `${name}=${JSON.stringify(value)}`);
  return [
    "<previous_description>",
    render(previous.natTemplate, previous.values).text,
    "</previous_description>",
    "<previous_template>",
    previous.ptTemplate,
    "</previous_template>",
    "<previous_slots>",
    ...previousValues,
    "</previous_slots>",
    "<description>",
    request.natlang,
    "</description>",
  ].join("\n");
}
