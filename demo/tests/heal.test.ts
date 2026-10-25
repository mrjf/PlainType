import { expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { HTTPException } from "hono/http-exception";
import { createHealer } from "../src/heal.js";
import type { HealOutput } from "../src/schemas.js";
import type { ModelCall, ModelReply } from "../src/translate.js";

const BROKEN = "***plaintype***\n\n***definitions***\n\n- :Button: A control.\n  - label: The label - a string of 1 to 24 characters.";
const FIXED = "***plaintype***\n***definitions***\n- :Button: A control.\n  - label - The label - a string between 1 and 24 characters.";

function reply(plaintype: string | null, stopReason = "end_turn"): ModelReply<HealOutput> {
  return { output: plaintype === null ? null : { plaintype }, stopReason, content: [{ type: "text", text: plaintype ?? "" }], model: "fake", usage: { input: 1, output: 1, cacheRead: 0 } };
}

function scripted(...replies: ModelReply<HealOutput>[]): { call: ModelCall<HealOutput>; seen: Anthropic.MessageParam[][] } {
  const seen: Anthropic.MessageParam[][] = [];
  return {
    seen,
    call: async (messages) => {
      seen.push([...messages]);
      const next = replies.shift();
      if (!next) throw new Error("unexpected extra model call");
      return next;
    },
  };
}

test("sends the compiler error and returns canonical PlainType", async () => {
  const { call, seen } = scripted(reply(FIXED));
  const result = await createHealer(call)({ raw: BROKEN });
  expect(result.compileError).toBeNull();
  expect(result.raw).toBe(
    "***plaintype***\n\n***definitions***\n\n- :Button: A control.\n  - label - The label - a string between 1 and 24 characters.\n",
  );
  expect(JSON.stringify(seen[0])).toContain("<compiler_error>");
  expect(JSON.stringify(seen[0])).toContain("between the attribute name and its description");
});

test("retries once with the new error, then reports what is still wrong", async () => {
  const { call, seen } = scripted(reply("still broken"), reply("still broken"));
  const result = await createHealer(call)({ raw: BROKEN });
  expect(result.attempts).toBe(2);
  expect(result.compileError).not.toBeNull();
  expect(result.raw).toBe("still broken");
  expect(JSON.stringify(seen[1]?.at(-1))).toContain("still does not compile");
});

test("maps refusals to a 422", async () => {
  const { call } = scripted(reply(null, "refusal"));
  const failure = await createHealer(call)({ raw: BROKEN }).catch((error: unknown) => error);
  expect(failure instanceof HTTPException && failure.status).toBe(422);
});
