/**
 * Natural language -> a PlainType data instance of the current schema.
 *
 * Same shape as the schema translator: the model proposes a template with
 * slots, the server checks it deterministically (slot bookkeeping, verbatim
 * values, parsing, and validation against the schema) and asks once more with
 * the exact problems. Long strings are folded in everything the model sees; a
 * slot handed back in its folded form gets its full value back.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { HTTPException } from "hono/http-exception";
import { foldValues } from "../shared/fold.js";
import { formatInstance, parseInstance } from "../shared/instance-notation.js";
import { deriveInstance, slotLongStrings, unfoldReturnedValues } from "../shared/instance-state.js";
import { SLOT_NAME, lookup, render, slotNames, type SlotValue } from "../shared/slots.js";
import { stateFromSlots, type DemoState } from "../shared/state.js";
import { compileValidator } from "../shared/validate.js";
import { errorOf, type HealLanguage } from "./heal.js";
import type { InstanceModelOutput, InstanceTranslateRequest } from "./schemas.js";
import type { ModelCall, TranslateResult } from "./translate.js";

const MAX_ATTEMPTS = 2;

export type InstanceTranslate = (request: InstanceTranslateRequest, signal?: AbortSignal) => Promise<TranslateResult>;

export const INSTANCE_LANGUAGE: HealLanguage = {
  check: (source) => errorOf(() => parseInstance(source)),
  canonical: (source) => {
    const { name, value } = parseInstance(source);
    return formatInstance(value, name);
  },
};

export function createInstanceTranslator(call: ModelCall<InstanceModelOutput>): InstanceTranslate {
  return async (request, signal) => {
    const started = performance.now();
    const usage = { input: 0, output: 0, cacheRead: 0 };
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: userTurn(request) }];
    for (let attempt = 1; ; attempt += 1) {
      const reply = await call(messages, signal);
      usage.input += reply.usage.input;
      usage.output += reply.usage.output;
      usage.cacheRead += reply.usage.cacheRead;
      if (reply.stopReason === "refusal") throw new HTTPException(422, { message: "The model declined this description." });
      if (reply.stopReason === "max_tokens") throw new HTTPException(502, { message: "The model ran out of output tokens." });
      if (!reply.output) throw new HTTPException(502, { message: "The model returned no structured output." });

      const review = reviewInstance(request, reply.output);
      if (review.problems.length === 0 || attempt >= MAX_ATTEMPTS) {
        return {
          state: review.state,
          unmatched: review.unmatched,
          compileError: review.parseError,
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

export interface InstanceReview {
  readonly state: DemoState;
  readonly unmatched: readonly string[];
  readonly parseError: string | null;
  readonly problems: readonly string[];
}

export function reviewInstance(request: InstanceTranslateRequest, output: InstanceModelOutput): InstanceReview {
  const problems: string[] = [];
  const returned: Record<string, string> = {};
  for (const slot of output.slots) {
    if (!SLOT_NAME.test(slot.name)) problems.push(`Slot name ${JSON.stringify(slot.name)} is not a valid identifier.`);
    else if (Object.hasOwn(returned, slot.name)) problems.push(`Slot ${slot.name} is listed more than once.`);
    else returned[slot.name] = slot.value;
  }
  const used = slotNames(output.instanceTemplate);
  for (const name of used) if (!Object.hasOwn(returned, name)) problems.push(`Placeholder {{${name}}} has no slot entry.`);
  for (const name of Object.keys(returned)) if (!used.includes(name)) problems.push(`Slot ${name} is not used in the template.`);

  const values = unfoldReturnedValues(returned, request.previous.values);
  const restored = new Set(Object.keys(values).filter((name) => values[name] !== returned[name]));
  const slots: SlotValue[] = Object.entries(values).map(([name, value]) => ({ name, value }));
  const linked = stateFromSlots(request.natlang, output.instanceTemplate, slots);
  const unmatched = linked.unmatched.filter((name) => !restored.has(name));
  for (const name of unmatched) {
    problems.push(
      `Slot ${name} has value ${JSON.stringify(lookup(values, name) ?? "")}, which does not appear verbatim in the description. Copy the value exactly, or write it literally in the template.`,
    );
  }

  const state = slotLongStrings(linked.state);
  const view = deriveInstance(state, { title: request.schema.title, validator: compileValidator(request.schema.json) });
  const parseError = view.parsed.ok ? null : view.parsed.error;
  if (parseError !== null) problems.push(`With the slot values filled in, the instance does not parse: ${parseError}.`);
  for (const issue of view.issues ?? []) {
    problems.push(
      `Schema validation: ${issue.path || "the root"} ${issue.message}. If the description itself asks for this value, keep it; otherwise fix the member name, nesting, or JSON type.`,
    );
  }
  return { state, unmatched, parseError, problems };
}

function userTurn(request: InstanceTranslateRequest): string {
  const previous = request.previous;
  const shown = foldValues(previous.values);
  return [
    "<schema>",
    request.schema.plaintype.trim(),
    "</schema>",
    "<previous_description>",
    render(previous.natTemplate, shown).text,
    "</previous_description>",
    "<previous_template>",
    previous.ptTemplate,
    "</previous_template>",
    "<previous_slots note=\"values ending in … are folded long strings; return them unchanged under the same slot name to keep the full text\">",
    ...Object.entries(shown).map(([name, value]) => `${name}=${JSON.stringify(value)}`),
    "</previous_slots>",
    "<description>",
    request.natlang,
    "</description>",
  ].join("\n");
}
