import { describe, expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { HTTPException } from "hono/http-exception";
import { SEED } from "../shared/state.js";
import { createTranslator, reviewOutput, type ModelCall, type ModelReply } from "../src/translate.js";
import type { ModelOutput } from "../src/schemas.js";

const NATLANG = "A Badge has a caption of at most 12 characters and a green outline.";
const GOOD: ModelOutput = {
  plaintypeTemplate: [
    "***plaintype***",
    "",
    "***definitions***",
    "",
    "- :{{typeName}}: A small label.",
    "  - caption - The caption text - a string between 1 and {{captionMax}} characters.",
    '  - outline - The outline color - "{{outlineColor}}".',
  ].join("\n"),
  slots: [
    { name: "typeName", value: "Badge" },
    { name: "captionMax", value: "12" },
    { name: "outlineColor", value: "green" },
  ],
};

function reply(output: ModelOutput | null, stopReason = "end_turn"): ModelReply {
  return { output, stopReason, content: [{ type: "text", text: JSON.stringify(output) }], model: "fake-model", usage: { input: 10, output: 5, cacheRead: 3 } };
}

function scripted(...replies: ModelReply[]): { call: ModelCall; seen: Anthropic.MessageParam[][] } {
  const seen: Anthropic.MessageParam[][] = [];
  const call: ModelCall = async (messages) => {
    seen.push([...messages]);
    const next = replies.shift();
    if (!next) throw new Error("unexpected extra model call");
    return next;
  };
  return { call, seen };
}

describe("reviewOutput", () => {
  test("accepts a consistent proposal and links it to the text", () => {
    const review = reviewOutput(NATLANG, GOOD);
    expect(review.problems).toEqual([]);
    expect(review.state.natTemplate).toBe("A {{typeName}} has a caption of at most {{captionMax}} characters and a {{outlineColor}} outline.");
  });

  test("reports bookkeeping, verbatim and compile problems", () => {
    const review = reviewOutput(NATLANG, {
      plaintypeTemplate: "***plaintype***\n\n***definitions***\n\n- :{{typeName}}: X.\n  - a - B - a string between 1 and {{max}}.",
      slots: [
        { name: "typeName", value: "Badge" },
        { name: "typeName", value: "Again" },
        { name: "bad name", value: "x" },
        { name: "unused", value: "green" },
        { name: "max", value: "twelve" },
      ],
    });
    expect(review.problems.join("\n")).toContain("listed more than once");
    expect(review.problems.join("\n")).toContain("not a valid identifier");
    expect(review.problems.join("\n")).toContain("Slot unused is not used");
    expect(review.problems.join("\n")).toContain('"twelve", which does not appear verbatim');
    expect(review.compileError).not.toBeNull();
  });
});

describe("createTranslator", () => {
  test("returns a state whose natural language renders back to the input", async () => {
    const { call, seen } = scripted(reply(GOOD));
    const result = await createTranslator(call)({ natlang: NATLANG, previous: SEED });
    expect(result.attempts).toBe(1);
    expect(result.state.values).toEqual({ typeName: "Badge", captionMax: "12", outlineColor: "green" });
    expect(result.usage).toEqual({ input: 10, output: 5, cacheRead: 3 });
    const prompt = seen[0]?.[0]?.content;
    expect(typeof prompt === "string" && prompt.includes("<previous_template>")).toBe(true);
  });

  test("asks once more with the exact problems, then accepts the fix", async () => {
    const broken: ModelOutput = { ...GOOD, slots: GOOD.slots.map((slot) => (slot.name === "captionMax" ? { ...slot, value: "twelve" } : slot)) };
    const { call, seen } = scripted(reply(broken), reply(GOOD));
    const result = await createTranslator(call)({ natlang: NATLANG, previous: SEED });
    expect(result.attempts).toBe(2);
    expect(result.compileError).toBeNull();
    const retry = seen[1] ?? [];
    expect(retry.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(JSON.stringify(retry[2]?.content)).toContain("does not appear verbatim");
  });

  test("gives up after two attempts and reports what is still wrong", async () => {
    const broken: ModelOutput = { ...GOOD, plaintypeTemplate: GOOD.plaintypeTemplate.replace("a string between", "a strng between") };
    const { call } = scripted(reply(broken), reply(broken));
    const result = await createTranslator(call)({ natlang: NATLANG, previous: SEED });
    expect(result.attempts).toBe(2);
    expect(result.compileError).not.toBeNull();
  });

  test("maps refusals to a 422", async () => {
    const { call } = scripted(reply(null, "refusal"));
    const failure = await createTranslator(call)({ natlang: NATLANG, previous: SEED }).catch((error: unknown) => error);
    expect(failure instanceof HTTPException && failure.status).toBe(422);
  });
});
