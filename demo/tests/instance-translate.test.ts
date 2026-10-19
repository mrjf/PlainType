import { expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { foldValue } from "../shared/fold.js";
import { INSTANCE_SEED } from "../shared/instance-state.js";
import { SEED, derive } from "../shared/state.js";
import { createInstanceTranslator } from "../src/instance.js";
import type { InstanceModelOutput } from "../src/schemas.js";
import type { ModelCall, ModelReply } from "../src/translate.js";

const schemaView = derive(SEED);
if (!schemaView.compiled.ok) throw new Error("seed schema must compile");
const schema = { plaintype: schemaView.raw.text, json: schemaView.compiled.json, title: "Button" };
const TEMPLATE = '***plaintype data 1***\n\n- :Button:\n  - label - "{{label}}"\n  - borderColor - "{{borderColor}}"\n  - priority - {{priority}}';
const NATLANG = 'The sign-up button reads "Join", border red, priority 4.';

function reply(output: InstanceModelOutput): ModelReply<InstanceModelOutput> {
  return { output, stopReason: "end_turn", content: [{ type: "text", text: "{}" }], model: "fake", usage: { input: 1, output: 1, cacheRead: 0 } };
}

function scripted(...replies: ModelReply<InstanceModelOutput>[]): { call: ModelCall<InstanceModelOutput>; seen: Anthropic.MessageParam[][] } {
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

test("links values to the description and sends the schema as PlainType", async () => {
  const { call, seen } = scripted(reply({ instanceTemplate: TEMPLATE, slots: [{ name: "label", value: "Join" }, { name: "borderColor", value: "red" }, { name: "priority", value: "4" }] }));
  const result = await createInstanceTranslator(call)({ natlang: NATLANG, previous: INSTANCE_SEED, schema });
  expect(result.attempts).toBe(1);
  expect(result.state.natTemplate).toBe('The sign-up button reads "{{label}}", border {{borderColor}}, priority {{priority}}.');
  expect(JSON.stringify(seen[0])).toContain("***plaintype 3***");
});

test("retries with validation problems, but accepts values the user asked for on the second try", async () => {
  const wrong = { instanceTemplate: TEMPLATE.replace("borderColor", "border_color"), slots: [{ name: "label", value: "Join" }, { name: "borderColor", value: "red" }, { name: "priority", value: "4" }] };
  const right = { instanceTemplate: TEMPLATE, slots: wrong.slots };
  const { call, seen } = scripted(reply(wrong), reply(right));
  const result = await createInstanceTranslator(call)({ natlang: NATLANG, previous: INSTANCE_SEED, schema });
  expect(result.attempts).toBe(2);
  expect(JSON.stringify(seen[1]?.at(-1))).toContain("must NOT have additional properties");
});

test("folded long values sent to the model come back in full", async () => {
  const long = "Click here to finish checking out and pay for everything in your basket right now";
  const previous = { ...INSTANCE_SEED, values: { ...INSTANCE_SEED.values, label: long } };
  // The long label breaks the schema's 24-character limit, so the review asks once more.
  const output = { instanceTemplate: TEMPLATE, slots: [{ name: "label", value: foldValue(long) }, { name: "borderColor", value: "red" }, { name: "priority", value: "4" }] };
  const { call, seen } = scripted(reply(output), reply(output));
  const result = await createInstanceTranslator(call)({ natlang: NATLANG, previous, schema });
  expect(result.state.values["label"]).toBe(long);
  expect(result.unmatched).toEqual([]);
  expect(JSON.stringify(seen[0])).not.toContain("basket right now");
});
