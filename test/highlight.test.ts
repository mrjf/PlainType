import assert from "node:assert/strict";
import test from "node:test";

import { highlight, type TokenClass } from "../demo/shared/highlight.js";

function classes(line: string): Array<[string, TokenClass]> {
  return highlight(line).map((token) => [line.slice(token.start, token.end), token.cls]);
}

test("Sensitive. is a keyword after the constraint, and before the other annotation sentences", () => {
  assert.deepEqual(classes('  - mail - Its mail - an email string. Sensitive. Defaults to "a@b.test".'), [
    ["-", "bullet"],
    ["mail", "name"],
    ["-", "punct"],
    [" Its mail", "desc"],
    ["-", "punct"],
    ["an", "keyword"],
    ["email", "keyword"],
    ["string", "keyword"],
    ["Sensitive", "keyword"],
    ["Defaults", "keyword"],
    ["to", "keyword"],
    ['"a@b.test"', "string"],
  ]);
  assert.deepEqual(classes("  - mail - Its mail - an :Email:. Sensitive.").slice(-2), [
    [":Email:", "concept"],
    ["Sensitive", "keyword"],
  ]);
});

test("the new constraint words are keywords", () => {
  const words = (line: string): string[] =>
    classes(line)
      .filter(([, cls]) => cls === "keyword")
      .map(([text]) => text);
  assert.deepEqual(words("  - a - A - a number between 0 and 1.5, or null."), ["a", "number", "between", "and", "or", "null"]);
  assert.deepEqual(words("  - a - A - a non-negative number."), ["a", "non-negative", "number"]);
  assert.deepEqual(words("  - a - A - a boolean."), ["a", "boolean"]);
  assert.deepEqual(words("  - a - A - a URL string."), ["a", "URL", "string"]);
  assert.deepEqual(words("  - a - A - a date-time string."), ["a", "date-time", "string"]);
  assert.deepEqual(words("  - a - A - an array of numbers."), ["an", "array", "of", "numbers"]);
  assert.deepEqual(words("  - a - A - an array of booleans."), ["an", "array", "of", "booleans"]);
  assert.deepEqual(words("  - a - A - an array of integers."), ["an", "array", "of", "integers"]);
  assert.deepEqual(words("  - a - A - an array of dates in YYYY-MM-DD format."), ["an", "array", "of", "dates", "in", "format"]);
});

test("a regular expression is one string token, dashes and periods included", () => {
  const pattern = '"^a - b\\. Sensitive$"';
  const line = `- :Colour: A colour - a string matching ${pattern}. Sensitive.`;
  assert.deepEqual(classes(line), [
    ["-", "bullet"],
    [":Colour:", "concept"],
    [" A colour", "desc"],
    ["-", "punct"],
    ["a", "keyword"],
    ["string", "keyword"],
    ["matching", "keyword"],
    [pattern, "string"],
    ["Sensitive", "keyword"],
  ]);
});

test("a leaf concept is a concept, its prose, and its constraint", () => {
  assert.deepEqual(classes("- :Email: An email address - an email string. Sensitive."), [
    ["-", "bullet"],
    [":Email:", "concept"],
    [" An email address", "desc"],
    ["-", "punct"],
    ["an", "keyword"],
    ["email", "keyword"],
    ["string", "keyword"],
    ["Sensitive", "keyword"],
  ]);
});

test("the property escape is a keyword and the JSON that follows it", () => {
  const line = '  - weight (optional) - Exact JSON Schema: {"description":"a - b","type":"number"}';
  assert.deepEqual(classes(line), [
    ["-", "bullet"],
    ["weight", "name"],
    [" (optional)", "qualifier"],
    ["-", "punct"],
    ["Exact JSON Schema: ", "keyword"],
    ['{"description":"a - b","type":"number"}', "json"],
  ]);
  assert.deepEqual(classes('  - "display name" - Exact JSON Schema: true').slice(-2), [
    ["Exact JSON Schema: ", "keyword"],
    ["true", "json"],
  ]);
  // The whole-schema escape is unchanged.
  assert.deepEqual(classes('- Exact JSON Schema: {"type":"number"}').slice(1), [
    ["Exact JSON Schema: ", "keyword"],
    ['{"type":"number"}', "json"],
  ]);
});

test("a description that only resembles the escape stays a description", () => {
  assert.deepEqual(classes("  - a - Not exact JSON Schema: at all - a string.").slice(0, 5), [
    ["-", "bullet"],
    ["a", "name"],
    ["-", "punct"],
    [" Not exact JSON Schema: at all", "desc"],
    ["-", "punct"],
  ]);
});

test("tokens never overlap and stay inside their line", () => {
  const text = [
    "***plaintype***",
    "",
    "***definitions***",
    "",
    "- :Money: An amount in a currency",
    "  - amount - The amount - a number between 0 and 1e6. Sensitive.",
    "  - currency - Its currency - a :Currency:.",
    '  - re - A pattern - a string matching "^[A-Z]{3}$", or null. Defaults to null.',
    '  - odd (optional) - Exact JSON Schema: {"type":"number","multipleOf":0.25}',
  ].join("\n");
  let previous = 0;
  for (const token of highlight(text)) {
    assert.ok(token.start >= previous, `token at ${token.start} overlaps the one before`);
    assert.ok(token.end > token.start && token.end <= text.length);
    assert.ok(!text.slice(token.start, token.end).includes("\n"));
    previous = token.end;
  }
});
