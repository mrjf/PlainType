import assert from "node:assert/strict";
import test from "node:test";
import { fromJsonSchema, toJsonSchema, formatPlainType, parseJson } from "../src/index.js";

test("plain renders a nested bounded arrays and patterned sensitive map as editable clauses", () => {
  const json = JSON.stringify({
    title: "MeasurementBatch", additionalProperties: false, type: "object",
    required: ["samples", "notes"], properties: {
      samples: { maxItems: 128, type: "array", items: {
        type: "object", additionalProperties: false, required: ["coordinates"], properties: {
          coordinates: { minItems: 1, maxItems: 256, type: "array", items: { minimum: -100, maximum: 100, type: "number" } },
        },
      } },
      notes: { maxProperties: 128, additionalProperties: false, label: "sensitive", type: "object", patternProperties: { "^[a-z]+$": { type: "string" } } },
    },
  });
  const text = fromJsonSchema(json, { style: "plain" });
  assert.ok(text.includes("- Schema clauses:"));
  assert.ok(!text.includes("Exact JSON Schema:"));
  assert.ok(!text.includes("Its exact JSON Schema entry is"));
  assert.ok(text.includes('Its sensitivity label is "sensitive".'));
  assert.deepEqual(parseJson(toJsonSchema(text)), parseJson(json));
  assert.equal(formatPlainType(text), text);
  const changed = text.replace('An array instance may contain at most this many items: 128.', 'An array instance may contain at most this many items: 64.');
  assert.notEqual(changed, text);
  const schema = JSON.parse(toJsonSchema(changed));
  assert.equal(schema.properties.samples.maxItems, 64);
  assert.equal(schema.properties.notes.label, "sensitive");
});

test("clause form preserves unknown keywords, dialects, order, numeric spelling and duplicate members", () => {
  for (const json of [
    '{"maximum":1.00,"type":"number","vendor":{"nested":[1,true]}}',
    '{"$schema":"https://example.test/dialect","type":"object","properties":{"x":false}}',
    '{"type":"string","type":"number"}',
    '{"type":"object","properties":{"x":{"type":"array","items":false}},"required":["x"]}',
  ]) {
    const text = fromJsonSchema(json, { style: "plain" });
    assert.deepEqual(parseJson(toJsonSchema(text)), parseJson(json));
    assert.equal(formatPlainType(text), text);
  }
});

test("clause form refuses missing children, mixed definitions and ignored comments", () => {
  const head = "***plaintype***\n\n***definitions***\n\n";
  for (const body of [
    "- Schema clauses:\n",
    '- Schema clauses:\n  - Its allowed type or types are "string".\n- :Other: Other.\n',
    '> ignored\n- Schema clauses:\n  - Its allowed type or types are "string".\n',
  ]) assert.throws(() => toJsonSchema(head + body));
});
