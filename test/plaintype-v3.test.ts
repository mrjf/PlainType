import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPlainType,
  fromJsonSchema,
  parseJson,
  toJsonSchema,
} from "../src/index.js";

const HEAD = "***plaintype***\n\n***definitions***\n\n";

function assertV3RoundTrip(json: string): string {
  const plain = fromJsonSchema(json, { style: "plain" });
  assert.deepEqual(parseJson(toJsonSchema(plain)), parseJson(json));
  assert.equal(formatPlainType(plain), plain);
  return plain;
}

function compile(plain: string): unknown {
  return JSON.parse(toJsonSchema(plain));
}

const familyJson = JSON.stringify({
  title: "AnimalFamily",
  type: "object",
  description: "A family tree for an animal.",
  properties: {
    animal: { description: "The animal represented here", $ref: "#/$defs/Animal" },
    parents: { description: "Its known parents", type: "array", items: { $ref: "#/$defs/Animal" } },
    offspring: { description: "Its known offspring", type: "array", items: { $ref: "#" } },
  },
  required: ["animal"],
  $defs: {
    Animal: {
      type: "object",
      description: "A reusable animal record.",
      properties: { name: { description: "The animal's name", type: "string", minLength: 1 } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  additionalProperties: false,
});

test("v3 writes schemas as ***plain concepts and properties as attributes", () => {
  assert.equal(
    assertV3RoundTrip(familyJson),
    `${HEAD}- :AnimalFamily: A family tree for an animal.
  - animal - The animal represented here - an :Animal:.
  - parents (optional) - Its known parents - an array of :Animal:.
  - offspring (optional) - Its known offspring - an array of :AnimalFamily:.

- :Animal: A reusable animal record.
  - name - The animal's name - a string containing at least one character.
`,
  );
});

test("v3 keeps definitions after the root's additional-properties directive", () => {
  const json = JSON.stringify({
    title: "Open",
    type: "object",
    description: "An open record.",
    properties: { thing: { description: "A thing", $ref: "#/$defs/Thing" } },
    required: ["thing"],
    $defs: {
      Thing: { type: "object", description: "A thing.", properties: {}, required: [], additionalProperties: false },
    },
    additionalProperties: true,
  });
  assert.equal(
    assertV3RoundTrip(json),
    `${HEAD}- :Open: An open record.
  - thing - A thing - a :Thing:.
  - Additional properties allowed

- :Thing: A thing.
`,
  );
});

test("defaults and examples follow the constraint as sentences", () => {
  const json = JSON.stringify({
    title: "Settings",
    type: "object",
    description: "Display settings.",
    properties: {
      theme: { description: "The color theme", enum: ["light", "dark"], default: "light", examples: ["dark"] },
      fontSize: { description: "The font size in points", type: "integer", minimum: 8, maximum: 72, default: 14 },
      name: { description: "A display name", type: "string", examples: ["Ada", "Grace"] },
      tags: { description: "Labels", type: "string", examples: ["a, or b", "x. For example: y", "z"] },
      payload: { description: "Arbitrary data", type: ["string", "null"], default: null, examples: [{ a: [1, -2] }, [], -0.5, true] },
    },
    required: ["theme"],
    additionalProperties: false,
  });
  assert.equal(
    assertV3RoundTrip(json),
    `${HEAD}- :Settings: Display settings.
  - theme - The color theme - one of "light" or "dark". Defaults to "light". For example: "dark".
  - fontSize (optional) - The font size in points - an integer between 8 and 72. Defaults to 14.
  - name (optional) - A display name - a string. For example: "Ada" or "Grace".
  - tags (optional) - Labels - a string. For example: "a, or b", "x. For example: y", or "z".
  - payload (optional) - Arbitrary data - a string, or null. Defaults to null. For example: {"a":[1,-2]}, [], -0.5, or true.
`,
  );
});

test("annotations outside the fixed default-then-examples order use the exact escape", () => {
  const json = JSON.stringify({
    title: "T",
    type: "object",
    description: "T.",
    properties: { a: { description: "A", type: "string", examples: ["x"], default: "y" } },
    required: [],
  });
  assert.match(assertV3RoundTrip(json), /- Exact JSON Schema:/);
  const empty = JSON.stringify({
    title: "T",
    type: "object",
    description: "T.",
    properties: { a: { description: "A", type: "string", examples: [] } },
    required: [],
  });
  assert.match(assertV3RoundTrip(empty), /- Exact JSON Schema:/);
});

test("version 2 has no annotation sentences, so it keeps the exact escape", () => {
  const json = JSON.stringify({
    title: "T",
    type: "object",
    description: "T.",
    properties: { a: { description: "A", type: "string", default: "x" } },
    required: ["a"],
    additionalProperties: false,
  });
  assert.match(fromJsonSchema(json, { style: "conversational" }), /Exact JSON Schema/);
  assert.doesNotMatch(fromJsonSchema(json, { style: "plain" }), /Exact JSON Schema/);
});

test("YAML frontmatter is module metadata: accepted, preserved by format, never compiled", () => {
  const source = `---
description: "Display settings"
import:
  - shared-types
---

${HEAD}- :Flag: A flag.
  - on - Whether it is on - "yes".
`;
  assert.deepEqual(compile(source), {
    title: "Flag",
    type: "object",
    description: "A flag.",
    properties: { on: { description: "Whether it is on", const: "yes" } },
    required: ["on"],
    additionalProperties: false,
  });
  assert.equal(formatPlainType(source), source);
  assert.doesNotMatch(formatPlainType(source, { style: "conversational" }), /description: "Display settings"/);
  assert.throws(() => toJsonSchema("---\na: 1\n\n***plaintype***"), /Unclosed YAML frontmatter at line 1/);
  assert.throws(
    () => toJsonSchema("---\na: 1\n---\n***plaintype 2***\n\n- Every instance is accepted."),
    /YAML frontmatter requires \*\*\*plaintype\*\*\* at line 1/,
  );
});

test("> lines describe the next declaration and compile to $comment", () => {
  const source = `***plaintype***
> A module note: not compiled.

***definitions***

> This is a rough draft.
> Totals are reviewed weekly.
- :Invoice: An invoice.
  > Stored in cents.
  - total - The total - a non-negative integer.
  > Who pays.
  - payer - The paying party.
    - email - Their address - an email string.
`;
  assert.deepEqual(compile(source), {
    title: "Invoice",
    type: "object",
    description: "An invoice.",
    $comment: "This is a rough draft.\nTotals are reviewed weekly.",
    properties: {
      total: { description: "The total", $comment: "Stored in cents.", type: "integer", minimum: 0 },
      payer: {
        type: "object",
        description: "The paying party.",
        $comment: "Who pays.",
        properties: { email: { description: "Their address", type: "string", format: "email" } },
        required: ["email"],
        additionalProperties: false,
      },
    },
    required: ["total", "payer"],
    additionalProperties: false,
  });
  const canonical = formatPlainType(source);
  assert.doesNotMatch(canonical, /module note/);
  assert.match(canonical, /\*\*\*definitions\*\*\*\n\n> This is a rough draft\.\n> Totals are reviewed weekly\.\n- :Invoice:/);
  assert.equal(fromJsonSchema(toJsonSchema(source), { style: "plain" }), canonical);
});

test("$comment round-trips on roots, unions, alternatives, definitions and leaves", () => {
  const json = JSON.stringify({
    title: "Id",
    description: "An identifier.",
    $comment: "Union note.",
    oneOf: [
      {
        title: "Chip",
        type: "object",
        description: "A chip.",
        $comment: "Line one.\n\n  Indented line three.",
        properties: { n: { description: "Its number", $comment: "Leaf note.", type: "string", examples: ["1"] } },
        required: ["n"],
        additionalProperties: false,
      },
    ],
  });
  const plain = assertV3RoundTrip(json);
  assert.equal(
    plain,
    `${HEAD}> Union note.
- :Id: An identifier. Exactly one of:
  > Line one.
  >
  >   Indented line three.
  - :Chip: A chip.
    > Leaf note.
    - n - Its number - a string. For example: "1".
`,
  );
});

test("comments the > form cannot carry exactly, or misplaced comments, are handled safely", () => {
  const trailing = JSON.stringify({ title: "T", type: "object", description: "T.", $comment: "ends with space ", properties: {}, required: [] });
  assert.match(assertV3RoundTrip(trailing), /- Schema clauses:/);
  const late = JSON.stringify({ description: "A", type: "string", $comment: "after the constraint" });
  assert.match(
    assertV3RoundTrip(JSON.stringify({ title: "T", type: "object", description: "T.", properties: { a: JSON.parse(late) }, required: [] })),
    /- Exact JSON Schema:/,
  );
  assert.throws(() => toJsonSchema(`${HEAD}- :A: A.\n> dangling`), /A comment must be followed by the declaration it describes at line 6/);
  assert.throws(() => toJsonSchema(`${HEAD}> note\n- Every instance is accepted.`), /cannot describe this clause/);
  assert.throws(
    () => toJsonSchema(`${HEAD}- :A: A.\n  > note\n  - Additional properties allowed`),
    /cannot describe an additional-properties directive at line 7/,
  );
});

test("the ***definitions*** section is required, unique, and the only section", () => {
  assert.throws(() => toJsonSchema("***plaintype***\n\n- :A: A."), /Expected \*\*\*definitions\*\*\* before the first definition at line 3/);
  assert.throws(() => toJsonSchema("***plaintype***\n"), /Expected a \*\*\*definitions\*\*\* section/);
  assert.throws(
    () => toJsonSchema(`${HEAD}- :A: A.\n\n***functional specs***\n`),
    /contains only \*\*\*definitions\*\*\*; found \*\*\*functional specs\*\*\* at line 7/,
  );
  assert.throws(() => toJsonSchema(`${HEAD}***definitions***\n- :A: A.`), /Duplicate \*\*\*definitions\*\*\* section/);
});

test("concept names use ***plain's character set, and other titles use readable schema clauses", () => {
  const json = JSON.stringify({
    title: "Order.Line-2+",
    type: "object",
    description: "A line.",
    properties: { next: { description: "The next line", $ref: "#" } },
    required: [],
    additionalProperties: false,
  });
  assert.match(assertV3RoundTrip(json), /^- :Order\.Line-2\+: A line\.\n {2}- next \(optional\) - The next line - an :Order\.Line-2\+:\.$/m);
  assert.match(assertV3RoundTrip(JSON.stringify({ ...JSON.parse(json), title: "Order Line" })), /- Schema clauses:/);
});

test("local file references are written as ***plain linked resources", () => {
  const json = JSON.stringify({
    title: "Customer",
    type: "object",
    description: "A customer.",
    properties: {
      address: { description: "The postal address", $ref: "schemas/address.schema.json" },
      remote: { description: "A remote schema", $ref: "https://example.test/x.json" },
      parent: { description: "Outside the folder", $ref: "../x.json" },
    },
    required: ["address", "remote", "parent"],
    additionalProperties: false,
  });
  const plain = assertV3RoundTrip(json);
  assert.match(plain, /- address - The postal address - a reference to \[schemas\/address\.schema\.json\]\(schemas\/address\.schema\.json\)\./);
  assert.match(plain, /- remote - A remote schema - a reference to "https:\/\/example\.test\/x\.json"\./);
  assert.match(plain, /- parent - Outside the folder - a reference to "\.\.\/x\.json"\./);
  assert.throws(
    () => toJsonSchema(`${HEAD}- :C: C.\n  - a - A - a reference to [x.json](y.json).`),
    /link text equals its target at line 6/,
  );
});

test("v3 rejects v2 spellings and explains the attribute form", () => {
  assert.throws(() => toJsonSchema(`${HEAD}- Animal: An animal.`), /Expected a :ConceptName: declaration at line 5/);
  assert.throws(
    () => toJsonSchema(`${HEAD}- :Animal: An animal.\n  - name: Its name - a string.`),
    /Expected ' - ' between the attribute name and its description at line 6/,
  );
  assert.throws(
    () => toJsonSchema(`${HEAD}- :Animal: An animal.\n  - owner - Its owner - an Owner.`),
    /Unknown version-3 constraint "an Owner" at line 6/,
  );
  assert.throws(() => toJsonSchema(`${HEAD}- :A: A.\n\n- :A: Again.`), /same name as the root schema at line 7/);
  assert.throws(() => toJsonSchema(`${HEAD}- :A: A.\n\n- :B: B.\n\n- :B: Again.`), /Duplicate definition :B: at line 9/);
  assert.throws(
    () => toJsonSchema(`${HEAD}- :U: A union. Exactly one of:\n  - :X: X.\n\n- :D: D.`),
    /Reusable definitions need a named object as the first definition at line 8/,
  );
});

test("quoted property names and nested objects use the attribute form", () => {
  const json = JSON.stringify({
    title: "Pet",
    type: "object",
    description: "A pet.",
    properties: {
      "display name": { description: "Shown in the UI", type: "string" },
      owner: {
        type: "object",
        description: "Who owns it.",
        properties: { email: { description: "Their address", type: "string", format: "email" } },
        required: ["email"],
        additionalProperties: false,
      },
    },
    required: ["display name"],
    additionalProperties: false,
  });
  assert.equal(
    assertV3RoundTrip(json),
    `${HEAD}- :Pet: A pet.
  - "display name" - Shown in the UI - a string.
  - owner (optional) - Who owns it.
    - email - Their address - an email string.
`,
  );
});

test("format converts between v2 and v3 and preserves the source version by default", () => {
  const v3 = fromJsonSchema(familyJson, { style: "plain" });
  const v2 = fromJsonSchema(familyJson, { style: "conversational" });
  assert.equal(formatPlainType(v2), v2);
  assert.equal(formatPlainType(v2, { style: "plain" }), v3);
  assert.equal(formatPlainType(v3, { style: "conversational" }), v2);
  assert.deepEqual(parseJson(toJsonSchema(v2)), parseJson(toJsonSchema(v3)));
});
