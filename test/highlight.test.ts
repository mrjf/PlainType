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

/** The inline alternatives as a regular expression read them before `inlineRuns`: the reference for ordinary text. */
const INLINE = /"(?:[^"\\]|\\.)*"|\[[^\]]*\]\([^)]*\)|:[A-Za-z0-9+._-]+:|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[A-Za-z][A-Za-z0-9_-]*/g;

/** What the regular expression found in a line made of the letters `a` (a keyword), `e` (nothing) and `E`, `Z` (types). */
function referenceClasses(line: string): Array<[string, TokenClass]> {
  const out: Array<[string, TokenClass]> = [];
  for (const [word] of line.matchAll(INLINE)) {
    if (word.startsWith('"') || word.startsWith("[")) out.push([word, "string"]);
    else if (word.startsWith(":")) out.push([word, "concept"]);
    else if (/^-?\d/.test(word)) out.push([word, "number"]);
    else if (word === "a") out.push([word, "keyword"]);
    else if (/^[A-Z]/.test(word)) out.push([word, "type"]);
  }
  return out;
}

test("a line outside a bullet is read as the regular expression it replaced read it", () => {
  // Everything the alternatives begin and end with, so that openings that fail, escapes and overlaps are common.
  const alphabet = ['"', "\\", "[", "]", "(", ")", ":", "-", ".", "e", "E", "+", "1", "7", " ", "a", "Z", "_", "\r", "\u2028"];
  let seed = 12345;
  const random = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let n = 0; n < 30000; n += 1) {
    // `x` first: the line is neither a bullet, a comment nor a header, so all of it is inline text.
    let line = "x";
    for (let i = 0, length = 1 + Math.floor(random() * 24); i < length; i += 1) line += alphabet[Math.floor(random() * alphabet.length)];
    // The leading `x` is a word, and the type of nothing.
    assert.deepEqual(classes(line), referenceClasses(line), JSON.stringify(line));
  }
});

test("a line of unmatched openings is read in linear time", () => {
  const N = 65536;
  for (const [name, line] of [
    ["[", "[".repeat(N)],
    ['"', '"'.repeat(N)],
    ['"\\', '"\\'.repeat(N / 2)],
    ["[a](", "[a](".repeat(N / 4)],
    ["[a]", "[a]".repeat(N / 3)],
    [":a", ":a".repeat(N / 2)],
    ["-", "-".repeat(N)],
    ["1.", "1.".repeat(N / 2)],
  ] as const) {
    for (const text of [line, `- :A: ${line}`, `  - x - d - ${line}`]) {
      const started = performance.now();
      const tokens = highlight(text);
      const took = performance.now() - started;
      assert.ok(took < 100, `${name}: ${took.toFixed(0)} ms for ${text.length} characters`);
      let previous = 0;
      for (const token of tokens) {
        assert.ok(token.start >= previous && token.end <= text.length);
        previous = token.end;
      }
    }
  }
});

test("a quoted string takes its escapes; one that never closes opens nothing", () => {
  assert.deepEqual(classes('x "a\\"b" Y "c'), [
    ['"a\\"b"', "string"],
    ["Y", "type"],
  ]);
});

test("a link is read wherever the ones before it ended, or failed", () => {
  assert.deepEqual(classes("x [a](b) [c](d) [e]"), [
    ["[a](b)", "string"],
    ["[c](d)", "string"],
  ]);
  assert.deepEqual(classes("x [q] [b](c) [d](e"), [["[b](c)", "string"]]);
  assert.deepEqual(classes("x [a[b](c)"), [["[a[b](c)", "string"]]);
});
