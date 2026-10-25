import assert from "node:assert/strict";
import test from "node:test";

import {
  PlainTypeSyntaxError,
  formatPlainType,
  fromJsonSchema,
  parseJson,
  parsePlainType,
  stringifyJson,
  toJsonSchema,
  type ConceptBinding,
} from "../src/index.js";

const HEAD = "***plaintype***\n\n***definitions***\n\n";

/** A stand-in for sys0's library: `sys0:<Name>` for the names it holds. */
const HELD = ["Currency", "ContactLabel", "ContactPoint", "Email"];
const library: ConceptBinding = {
  ref: (name) => (HELD.includes(name) ? `sys0:${name}` : null),
  concept: (ref) => (ref.startsWith("sys0:") && HELD.includes(ref.slice(5)) ? ref.slice(5) : null),
};

interface Options {
  readonly concepts?: ConceptBinding;
}

function assertV3RoundTrip(json: unknown, options: Options = {}): string {
  const source = typeof json === "string" ? json : JSON.stringify(json);
  const plain = fromJsonSchema(source, { style: "plain", ...options });
  assert.equal(
    stringifyJson(parseJson(toJsonSchema(plain, { space: 0, ...options }))),
    stringifyJson(parseJson(source)),
    "JSON -> PlainType -> JSON keeps member order too",
  );
  assert.equal(formatPlainType(plain, options), plain, "format is idempotent");
  return plain;
}

function compile(plain: string, options: Options = {}): unknown {
  return JSON.parse(toJsonSchema(plain, options));
}

/** The body of a rendered document: everything after the header and section. */
function body(plain: string): string {
  assert.ok(plain.startsWith(HEAD), "a plain document starts with its header and section");
  return plain.slice(HEAD.length);
}

/** A named object in the member order version 3 writes: `$defs` before `additionalProperties`. */
function object(properties: Record<string, unknown>, required?: string[], defs?: Record<string, unknown>) {
  return {
    title: "T",
    type: "object",
    description: "A T.",
    properties,
    required: required ?? Object.keys(properties),
    ...(defs === undefined ? {} : { $defs: defs }),
    additionalProperties: false,
  };
}

// ---------------------------------------------------------------------------
// The library's fixtures

interface Fixture {
  readonly name: string;
  readonly schema: Record<string, unknown>;
  readonly text: string;
}

const fixtures: readonly Fixture[] = [
  {
    name: "Email",
    schema: { title: "Email", description: "An email address", type: "string", format: "email", label: "sensitive" },
    text: "- :Email: An email address - an email string. Sensitive.\n",
  },
  {
    name: "Url",
    schema: { title: "Url", description: "A web address", type: "string", format: "uri" },
    text: "- :Url: A web address - a URL string.\n",
  },
  {
    name: "Date",
    schema: { title: "Date", description: "A calendar date", type: "string", format: "date" },
    text: "- :Date: A calendar date - a date in YYYY-MM-DD format.\n",
  },
  {
    name: "DateTime",
    schema: { title: "DateTime", description: "A moment in time, with its offset", type: "string", format: "date-time" },
    text: "- :DateTime: A moment in time, with its offset - a date-time string.\n",
  },
  {
    name: "Uuid",
    schema: { title: "Uuid", description: "A universally unique identifier", type: "string", format: "uuid" },
    text: "- :Uuid: A universally unique identifier - a UUID string.\n",
  },
  {
    name: "Colour",
    schema: {
      title: "Colour",
      description: "A colour as six hexadecimal digits after a hash",
      type: "string",
      pattern: "^#[0-9a-fA-F]{6}$",
    },
    text: '- :Colour: A colour as six hexadecimal digits after a hash - a string matching "^#[0-9a-fA-F]{6}$".\n',
  },
  {
    name: "Currency",
    schema: { title: "Currency", description: "An ISO 4217 currency code, in capitals", type: "string", pattern: "^[A-Z]{3}$" },
    text: '- :Currency: An ISO 4217 currency code, in capitals - a string matching "^[A-Z]{3}$".\n',
  },
  {
    name: "Money",
    schema: {
      title: "Money",
      type: "object",
      description: "An amount in a currency",
      properties: {
        amount: { description: "The amount, in the currency units", type: "number" },
        currency: { description: "Its currency", $ref: "sys0:Currency" },
      },
      required: ["amount", "currency"],
      additionalProperties: false,
    },
    text: `- :Money: An amount in a currency
  - amount - The amount, in the currency units - a number.
  - currency - Its currency - a :Currency:.
`,
  },
  {
    name: "PostalAddress",
    schema: {
      title: "PostalAddress",
      type: "object",
      description: "Where a person or place is, for post",
      properties: Object.fromEntries(
        ["street", "city", "region", "postcode", "country"].map((part) => [
          part,
          { description: `The ${part}`, type: "string", label: "sensitive" },
        ]),
      ),
      required: ["street", "city", "region", "postcode", "country"],
      additionalProperties: false,
    },
    text: `- :PostalAddress: Where a person or place is, for post
  - street - The street - a string. Sensitive.
  - city - The city - a string. Sensitive.
  - region - The region - a string. Sensitive.
  - postcode - The postcode - a string. Sensitive.
  - country - The country - a string. Sensitive.
`,
  },
  {
    name: "ContactLabel",
    schema: {
      title: "ContactLabel",
      description: "What a way of reaching someone is for",
      enum: ["home", "work", "mobile", "other"],
    },
    text: '- :ContactLabel: What a way of reaching someone is for - one of "home", "work", "mobile", or "other".\n',
  },
  {
    name: "ContactPoint",
    schema: {
      title: "ContactPoint",
      type: "object",
      description: "A way of reaching someone, as typed",
      properties: {
        label: { description: "What it is for", $ref: "sys0:ContactLabel" },
        value: {
          description: "The email address or phone number as typed: blank or incomplete while it is edited",
          type: "string",
          label: "sensitive",
        },
      },
      required: ["label", "value"],
      additionalProperties: false,
    },
    text: `- :ContactPoint: A way of reaching someone, as typed
  - label - What it is for - a :ContactLabel:.
  - value - The email address or phone number as typed: blank or incomplete while it is edited - a string. Sensitive.
`,
  },
];

for (const fixture of fixtures) {
  test(`fixture ${fixture.name} reads as prose and round-trips with the library bound`, () => {
    const plain = assertV3RoundTrip(fixture.schema, { concepts: library });
    assert.equal(plain, `${HEAD}${fixture.text}`);
    assert.doesNotMatch(plain, /Exact JSON Schema/);
    assert.equal(stringifyJson(parseJson(toJsonSchema(plain, { concepts: library, space: 0 }))), JSON.stringify(fixture.schema));
  });
}

test("the fixtures convert to the older styles without changing the JSON Schema", () => {
  for (const fixture of fixtures) {
    const plain = fromJsonSchema(JSON.stringify(fixture.schema), { style: "plain", concepts: library });
    for (const style of ["conversational", "structured"] as const) {
      const older = formatPlainType(plain, { style, concepts: library });
      assert.equal(
        stringifyJson(parseJson(toJsonSchema(older, { space: 0 }))),
        JSON.stringify(fixture.schema),
        `${fixture.name} as ${style}`,
      );
    }
  }
});

test("a fixture that refers to the library still round-trips with nothing bound, by quoted reference", () => {
  const money = fixtures.find(({ name }) => name === "Money")?.schema;
  const plain = assertV3RoundTrip(money);
  assert.match(plain, /^ {2}- currency - Its currency - a reference to "sys0:Currency"\.$/m);
  assert.doesNotMatch(plain, /Exact JSON Schema/);
});

test("the fixtures written in another member order stay lossless, through the whole-schema escape", () => {
  const email = '{"title":"Email","type":"string","description":"An email address","format":"email","label":"sensitive"}';
  assert.match(assertV3RoundTrip(email), /^- Exact JSON Schema: /m);
});

// ---------------------------------------------------------------------------
// (a) a named leaf concept

test("a leaf concept is a root, a definition and a union alternative", () => {
  const json = {
    title: "Pair",
    type: "object",
    description: "A pair.",
    properties: {
      mail: { description: "Its mail", $ref: "#/$defs/Email" },
      size: { description: "Its size", $ref: "#/$defs/Size" },
    },
    required: ["mail", "size"],
    $defs: {
      Email: { description: "An email address", type: "string", format: "email", label: "sensitive" },
      Size: { type: "object", description: "A size.", properties: {}, required: [], additionalProperties: false },
    },
    additionalProperties: false,
  };
  assert.equal(
    assertV3RoundTrip(json),
    `${HEAD}- :Pair: A pair.
  - mail - Its mail - an :Email:.
  - size - Its size - a :Size:.

- :Email: An email address - an email string. Sensitive.

- :Size: A size.
`,
  );
  const union = {
    title: "Id",
    description: "An identifier.",
    oneOf: [
      { title: "Code", description: "A code", type: "integer", minimum: 0 },
      { title: "Name", type: "object", description: "A name", properties: {}, required: [], additionalProperties: false, },
    ],
  };
  assert.equal(
    assertV3RoundTrip(union),
    `${HEAD}- :Id: An identifier. Exactly one of:
  - :Code: A code - a non-negative integer.
  - :Name: A name
`,
  );
});

test("a leaf concept carries a comment, a constraint and the annotation sentences in order", () => {
  const json = {
    title: "Rank",
    description: "A rank",
    $comment: "Stored as a number.",
    type: "number",
    label: "sensitive",
    default: 3,
    examples: [1, 2],
  };
  const plain = assertV3RoundTrip(json);
  assert.equal(plain, `${HEAD}> Stored as a number.\n- :Rank: A rank - a number. Sensitive. Defaults to 3. For example: 1 or 2.\n`);
  assert.deepEqual(compile(plain), json);
});

test("a leaf concept is read as a leaf only when it has no attributes", () => {
  const leaf = compile(`${HEAD}- :Rank: A rank - a number.`);
  assert.deepEqual(leaf, { title: "Rank", description: "A rank", type: "number" });

  // The same prose with attributes beneath it was, and is, an object's description.
  const object = compile(`${HEAD}- :Rank: A rank - or two.\n  - a - A - a string.`);
  assert.deepEqual(object, {
    title: "Rank",
    type: "object",
    description: "A rank - or two.",
    properties: { a: { description: "A", type: "string" } },
    required: ["a"],
    additionalProperties: false,
  });
  const plain = assertV3RoundTrip(object);
  assert.equal(plain, `${HEAD}- :Rank: A rank - or two.\n  - a - A - a string.\n`);
});

test("an object with no attributes and prose that reads as a leaf is never written as a concept", () => {
  for (const properties of [{ additionalProperties: false }, { additionalProperties: false, $comment: "n" }]) {
    const json = { title: "Thing", type: "object", description: "A thing - or two.", properties: {}, required: [], ...properties };
    assert.match(assertV3RoundTrip(json), /^- Exact JSON Schema: /m);
  }
  // An additional-properties line is an attribute line: the prose is an object's again.
  const open = { title: "Thing", type: "object", description: "A thing - or two.", properties: {}, required: [], additionalProperties: true };
  assert.equal(assertV3RoundTrip(open), `${HEAD}- :Thing: A thing - or two.\n  - Additional properties allowed\n`);
  // A definition is held to the same rule.
  const withDefinition = object({ d: { description: "D", $ref: "#/$defs/D" } }, ["d"], {
    D: { type: "object", description: "D - dee.", properties: {}, required: [], additionalProperties: false },
  });
  assert.match(assertV3RoundTrip(withDefinition), /^- Exact JSON Schema: /m);
});

test("a leaf concept's errors are precise", () => {
  assert.throws(
    () => toJsonSchema(`${HEAD}- :Rank: A rank - nonsense.`),
    /Unknown version-3 constraint "nonsense" at line 5/,
  );
  assert.throws(
    () => toJsonSchema(`${HEAD}- :Rank: A rank - a number.\n\n- :Other: Other.`),
    /Reusable definitions need a named object as the first definition at line 7/,
  );
  assert.throws(
    () => toJsonSchema(`${HEAD}- :Rank:  - a number.`),
    /A leaf concept needs a safe inline description at line 5/,
  );
  assert.throws(
    () => toJsonSchema(`${HEAD}> a note\n- Every instance is accepted.`),
    /cannot describe this clause/,
  );
});

test("a leaf concept whose prose cannot be written safely falls back to the whole-schema escape", () => {
  const unbalanced = { title: "Rank", description: 'a "quoted', type: "number" };
  assert.match(assertV3RoundTrip(unbalanced), /^- Exact JSON Schema: /m);
  const notAConcept = { title: "Rank Of Things", description: "A rank", type: "number" };
  assert.match(assertV3RoundTrip(notAConcept), /^- Exact JSON Schema: /m);
  const emptyDescription = { title: "Rank", description: "", type: "number" };
  assert.match(assertV3RoundTrip(emptyDescription), /^- Exact JSON Schema: /m);
});

test("a leaf concept is a v3 form only: version 2 keeps the whole-schema escape", () => {
  const email = { title: "Email", description: "An email address", type: "string", format: "email" };
  const conversational = fromJsonSchema(JSON.stringify(email), { style: "conversational" });
  assert.match(conversational, /^\*\*\*plaintype 2\*\*\*\n\n- Exact JSON Schema: /);
  // Version 2 still reads that prose as an object's description.
  assert.deepEqual(compile("***plaintype 2***\n\n- Email: An email address - an email string."), {
    title: "Email",
    type: "object",
    description: "An email address - an email string.",
    properties: {},
    required: [],
    additionalProperties: false,
  });
});

// ---------------------------------------------------------------------------
// (b) leaf constraints

interface Phrase {
  readonly text: string;
  readonly members: Record<string, unknown>;
}

const phrases: readonly Phrase[] = [
  { text: "a number", members: { type: "number" } },
  { text: "a number, or null", members: { type: ["number", "null"] } },
  { text: "a non-negative number", members: { type: "number", minimum: 0 } },
  { text: "a non-negative number, or null", members: { type: ["number", "null"], minimum: 0 } },
  { text: "a number between 0 and 1.5", members: { type: "number", minimum: 0, maximum: 1.5 } },
  { text: "a number between -2 and 2, or null", members: { type: ["number", "null"], minimum: -2, maximum: 2 } },
  { text: "a boolean", members: { type: "boolean" } },
  { text: "a boolean, or null", members: { type: ["boolean", "null"] } },
  { text: 'a string matching "^[a-z]+$"', members: { type: "string", pattern: "^[a-z]+$" } },
  { text: 'a string matching "^[a-z]+$", or null', members: { type: ["string", "null"], pattern: "^[a-z]+$" } },
  { text: "a date-time string", members: { type: "string", format: "date-time" } },
  { text: "a date-time string, or null", members: { type: ["string", "null"], format: "date-time" } },
  { text: "a URL string", members: { type: "string", format: "uri" } },
  { text: "a URL string, or null", members: { type: ["string", "null"], format: "uri" } },
  { text: "an array of strings", members: { type: "array", items: { type: "string" } } },
  { text: "an array of integers", members: { type: "array", items: { type: "integer" } } },
  { text: "an array of numbers", members: { type: "array", items: { type: "number" } } },
  { text: "an array of booleans", members: { type: "array", items: { type: "boolean" } } },
  { text: "an array of non-negative integers", members: { type: "array", items: { type: "integer", minimum: 0 } } },
  { text: "an array of non-negative numbers", members: { type: "array", items: { type: "number", minimum: 0 } } },
  { text: "an array of email strings", members: { type: "array", items: { type: "string", format: "email" } } },
  { text: "an array of URL strings", members: { type: "array", items: { type: "string", format: "uri" } } },
  { text: "an array of date-time strings", members: { type: "array", items: { type: "string", format: "date-time" } } },
  { text: "an array of UUID strings", members: { type: "array", items: { type: "string", format: "uuid" } } },
  {
    text: "an array of dates in YYYY-MM-DD format",
    members: { type: "array", items: { type: "string", format: "date" } },
  },
];

for (const phrase of phrases) {
  test(`"${phrase.text}" expands to its members in a fixed order and back`, () => {
    const schema = object({ a: { description: "A", ...phrase.members } });
    const plain = assertV3RoundTrip(schema);
    assert.equal(body(plain), `- :T: A T.\n  - a - A - ${phrase.text}.\n`);
    assert.equal(JSON.stringify(compile(plain)), JSON.stringify(schema));
  });
}

test("number bounds keep their JSON number tokens", () => {
  const plain = assertV3RoundTrip(
    '{"title":"T","type":"object","description":"A T.","properties":{"a":{"description":"A","type":"number","minimum":-1.50,"maximum":1e+3}},"required":["a"],"additionalProperties":false}',
  );
  assert.match(plain, /- a - A - a number between -1\.50 and 1e\+3\./);
  assert.throws(
    () => toJsonSchema(`${HEAD}- :T: A T.\n  - a - A - a number between x and 2.`),
    /Invalid embedded JSON/,
  );
});

test("a regular expression is a JSON string, whatever it contains", () => {
  for (const pattern of [
    "^a - b$",
    '^"quoted"$',
    "^x$ . Sensitive",
    "a. Defaults to b",
    ". For example: z",
    "back\\slash\\\\",
    "line\nbreak\ttab",
    ", or null",
    "ünï ☃  ",
    "",
  ]) {
    const schema = object({ a: { description: "A", type: "string", pattern, label: "sensitive", default: "d" } });
    const plain = assertV3RoundTrip(schema);
    assert.doesNotMatch(plain, /Exact JSON Schema/, JSON.stringify(pattern));
    assert.match(plain, /- a - A - a string matching /);
    assert.equal(JSON.stringify(compile(plain)), JSON.stringify(schema));
  }
});

test("a pattern that is exactly a digit count keeps the version-2 phrase", () => {
  const schema = object({ a: { description: "A", type: "string", pattern: "^[0-9]{15}$" } });
  assert.match(assertV3RoundTrip(schema), /- a - A - a string of exactly 15 digits\./);
  const spelled = `${HEAD}- :T: A T.\n  - a - A - a string matching "^[0-9]{15}$".\n`;
  assert.deepEqual(compile(spelled), compile(`${HEAD}- :T: A T.\n  - a - A - a string of exactly 15 digits.\n`));
  assert.match(formatPlainType(spelled), /a string of exactly 15 digits/);
});

test("constraints with no phrase use the property escape, not the whole-schema one", () => {
  const schema = object({
    ok: { description: "Fine", type: "number" },
    bounded: { description: "Exclusive", type: "number", exclusiveMinimum: 0 },
    stepped: { description: "Stepped", type: "number", multipleOf: 0.25 },
    half: { description: "Half a bound", type: "number", minimum: 1 },
    reversed: { description: "Reversed", type: "number", maximum: 1, minimum: 0 },
    union: { description: "Two types", type: ["number", "string"] },
    nullArray: { description: "A nullable array", type: ["array", "null"], items: { type: "string" } },
    nullItems: { description: "Nullable items", type: "array", items: { type: ["string", "null"] } },
    counted: { description: "Counted", type: "array", items: { type: "string" }, minItems: 1 },
    lengthItems: { description: "Long items", type: "array", items: { type: "string", minLength: 3 } },
    nested: { description: "Nested", type: "array", items: { type: "array", items: { type: "string" } } },
    formatted: { description: "Hostname", type: "string", format: "hostname" },
    both: { description: "Both", type: "string", pattern: "^a$", minLength: 1 },
    bool: { description: "Bool", type: "boolean", default: true },
  });
  const plain = assertV3RoundTrip(schema);
  assert.doesNotMatch(plain, /^- Exact JSON Schema/m);
  const lines = body(plain).split("\n");
  assert.equal(lines.filter((line) => line.includes("Exact JSON Schema:")).length, 12);
  assert.match(plain, /^ {2}- ok - Fine - a number\.$/m);
  assert.match(plain, /^ {2}- bool - Bool - a boolean\. Defaults to true\.$/m);
});

test("the new constraints exist in version 3 only", () => {
  const cases = [
    { type: "number" },
    { type: "boolean" },
    { type: ["number", "null"] },
    { type: "string", pattern: "^a$" },
    { type: "string", format: "date-time" },
    { type: "string", format: "uri" },
    { type: "array", items: { type: "string" } },
  ];
  for (const members of cases) {
    const json = JSON.stringify(object({ a: { description: "A", ...members } }));
    const conversational = fromJsonSchema(json, { style: "conversational" });
    assert.match(conversational, /^\*\*\*plaintype 2\*\*\*\n\n- Exact JSON Schema: /, JSON.stringify(members));
    assert.deepEqual(parseJson(toJsonSchema(conversational)), parseJson(json));
  }
  for (const phrase of ["a number", "a boolean", 'a string matching "x"', "a date-time string", "a URL string", "an array of strings"]) {
    assert.throws(
      () => toJsonSchema(`***plaintype 2***\n\n- T: A T.\n  - a: A - ${phrase}.`),
      /Unknown version-2 constraint/,
      phrase,
    );
  }
  // Version 2's own nullable forms are the same two they were.
  assert.match(fromJsonSchema('{"title":"T","type":"object","description":"T.","properties":{"a":{"description":"A","type":["string","null"]}},"required":["a"],"additionalProperties":false}', { style: "conversational" }), /a string, or null/);
});

// ---------------------------------------------------------------------------
// (c) the property-level escape

test("one odd property is written in the escape and the rest of the schema stays prose", () => {
  const schema = object(
    {
      first: { description: "First", type: "string" },
      weight: { description: "Weight", type: "number", multipleOf: 0.25 },
      note: { description: "A note", type: "string" },
    },
    ["first", "weight"],
  );
  assert.equal(
    assertV3RoundTrip(schema),
    `${HEAD}- :T: A T.
  - first - First - a string.
  - weight - Exact JSON Schema: {"description":"Weight","type":"number","multipleOf":0.25}
  - note (optional) - A note - a string.
`,
  );
});

test("the property escape carries optionality, any property name, boolean and empty schemas, and nested objects", () => {
  const schema = object(
    {
      "display name": { description: "Shown", type: "string", unknown: [1, { "x - y": null }] },
      yes: true,
      no: false,
      anything: {},
      inner: {
        type: "object",
        description: "Inner.",
        properties: {
          ok: { description: "Fine", type: "integer" },
          odd: { description: "Odd", type: "integer", multipleOf: 2 },
        },
        required: ["ok"],
        additionalProperties: false,
      },
    },
    ["display name", "no", "inner"],
  );
  assert.equal(
    assertV3RoundTrip(schema),
    `${HEAD}- :T: A T.
  - "display name" - Exact JSON Schema: {"description":"Shown","type":"string","unknown":[1,{"x - y":null}]}
  - yes (optional) - Exact JSON Schema: true
  - no - Exact JSON Schema: false
  - anything (optional) - Exact JSON Schema: {}
  - inner - Inner.
    - ok - Fine - an integer.
    - odd (optional) - Exact JSON Schema: {"description":"Odd","type":"integer","multipleOf":2}
`,
  );
});

test("an object property that cannot be written as prose is itself escaped", () => {
  const schema = object({
    open: { type: "object", description: "Open.", properties: {}, required: [], additionalProperties: { type: "string" } },
    looksLikeALeaf: { type: "object", description: "Pick - a string.", properties: {}, required: [], additionalProperties: false },
    unsafe: { type: "object", description: "line one\nline two", properties: {}, required: [], additionalProperties: false },
  });
  const plain = assertV3RoundTrip(schema);
  assert.equal(body(plain).split("\n").filter((line) => line.includes("Exact JSON Schema:")).length, 3);
});

test("a description that reads as the escape is written in the escape", () => {
  const schema = object({
    leaf: { description: "Exact JSON Schema: sneaky", type: "string" },
    colon: { description: "Exact JSON Schema:", type: "string" },
    nested: {
      type: "object",
      description: "Exact JSON Schema: sneakier",
      properties: { a: { description: "A", type: "string" } },
      required: ["a"],
      additionalProperties: false,
    },
    plain: { description: "Not exact JSON Schema: at all", type: "string" },
  });
  const plain = assertV3RoundTrip(schema);
  const lines = body(plain).split("\n");
  assert.equal(lines.filter((line) => / - Exact JSON Schema: \{/.test(line)).length, 3);
  assert.ok(lines.includes("  - plain - Not exact JSON Schema: at all - a string."));
});

test("a description that contains ' - ' and looks like a constraint stays unambiguous", () => {
  const schema = object({
    a: { description: "Pick - a string", type: "integer" },
    b: { description: "Pick - a string.", type: "integer" },
    c: { description: 'The "a - b" code', type: "string" },
    d: { description: "Dash - at the end -", type: "string", label: "sensitive" },
    e: { description: "He said \\\"hi\\\" - ok.", type: "string" },
  });
  const plain = assertV3RoundTrip(schema);
  assert.match(plain, /^ {2}- b - Pick - a string\. - an integer\.$/m);
  const parsed = compile(plain) as { properties: Record<string, { description: string }> };
  assert.equal(parsed.properties.b?.description, "Pick - a string.");
  assert.equal(parsed.properties.e?.description, "He said \\\"hi\\\" - ok.");
});

test("a leaf concept's prose can hold ' - ' too, and an object's is held to its own rule", () => {
  for (const description of ["Pick - a string", "Pick - a string.", 'The "a - b" code']) {
    const leaf = { title: "Rank", description, type: "integer" };
    const plain = assertV3RoundTrip(leaf);
    assert.equal(body(plain), `- :Rank: ${description} - an integer.\n`);
  }
});

test("a property with no description is not yet prose: it is written in the property escape", () => {
  const schema = object({
    bare: { type: "string" },
    empty: { description: "", type: "string" },
    typed: { type: "string", format: "email", label: "sensitive" },
  });
  const plain = assertV3RoundTrip(schema);
  assert.equal(
    body(plain),
    `- :T: A T.
  - bare - Exact JSON Schema: {"type":"string"}
  - empty - Exact JSON Schema: {"description":"","type":"string"}
  - typed - Exact JSON Schema: {"type":"string","format":"email","label":"sensitive"}
`,
  );
});

test("the property escape has precise errors", () => {
  assert.throws(
    () => toJsonSchema(`${HEAD}- :T: A T.\n  - a - Exact JSON Schema: {"a":`),
    /Invalid embedded JSON: .* at line 6/,
  );
  assert.throws(
    () => toJsonSchema(`${HEAD}- :T: A T.\n  - a - Exact JSON Schema: 5`),
    /An exact JSON Schema must be an object or boolean at line 6/,
  );
  assert.throws(
    () => toJsonSchema(`${HEAD}- :T: A T.\n  - a - Exact JSON Schema: {}\n    - b - B - a string.`),
    /This clause cannot contain nested clauses at line 7/,
  );
  assert.throws(
    () => toJsonSchema(`${HEAD}- :T: A T.\n  > a note\n  - a - Exact JSON Schema: {}`),
    /A comment cannot describe this clause; put \$comment inside an exact JSON Schema at line 7/,
  );
  assert.throws(
    () => toJsonSchema(`${HEAD}- :T: A T.\n  - a - Exact JSON Schema: {}\n  - a - A - a string.`),
    /Duplicate compact property "a" is ambiguous at line 7/,
  );
  // The old clause, as a child of an object, is still not a property.
  assert.throws(
    () => toJsonSchema(`${HEAD}- :T: A T.\n  - Exact JSON Schema: {}`),
    /Expected ' - ' between the attribute name and its description at line 6/,
  );
});

test("version 2 has no property escape: one odd property makes the whole schema exact", () => {
  const schema = object({ a: { description: "A", type: "number", multipleOf: 0.25 } });
  const conversational = fromJsonSchema(JSON.stringify(schema), { style: "conversational" });
  assert.match(conversational, /^\*\*\*plaintype 2\*\*\*\n\n- Exact JSON Schema: /);
  assert.throws(
    () => toJsonSchema('***plaintype 2***\n\n- T: A T.\n  - a - Exact JSON Schema: {}'),
    PlainTypeSyntaxError,
  );
});

test("an empty $defs cannot be read back from a version-3 list, so it uses the whole-schema escape", () => {
  const schema = object({ a: { description: "A", type: "string" } }, ["a"], {});
  assert.match(assertV3RoundTrip(schema), /^- Exact JSON Schema: /m);
});

// ---------------------------------------------------------------------------
// (d) Sensitive.

test("Sensitive. is the label member, after the constraint and before the default and examples", () => {
  const schema = object({
    a: { description: "A", type: "string", label: "sensitive", default: "x", examples: ["y", "z"] },
    b: { description: "B", enum: ["p", "q"], label: "sensitive" },
    c: { description: "C", const: "k", label: "sensitive", default: "k" },
    d: { description: "D", $ref: "sys0:Email", label: "sensitive" },
    e: { description: "E", type: "array", items: { type: "string" }, label: "sensitive" },
    f: { description: "F", type: ["string", "null"], format: "email", label: "sensitive" },
  });
  const plain = assertV3RoundTrip(schema);
  assert.equal(
    body(plain),
    `- :T: A T.
  - a - A - a string. Sensitive. Defaults to "x". For example: "y" or "z".
  - b - B - one of "p" or "q". Sensitive.
  - c - C - "k". Sensitive. Defaults to "k".
  - d - D - a reference to "sys0:Email". Sensitive.
  - e - E - an array of strings. Sensitive.
  - f - F - an email string, or null. Sensitive.
`,
  );
  assert.equal(JSON.stringify(compile(plain)), JSON.stringify(schema));
});

test("Sensitive. works on a concept reference, bound or declared, and on a reference to a definition", () => {
  const external = object({ mail: { description: "Its mail", $ref: "sys0:Email", label: "sensitive" } });
  assert.equal(
    assertV3RoundTrip(external, { concepts: library }),
    `${HEAD}- :T: A T.\n  - mail - Its mail - an :Email:. Sensitive.\n`,
  );
  const local = object({ mail: { description: "Its mail", $ref: "#/$defs/Email", label: "sensitive" } }, ["mail"], {
    Email: { description: "An email address", type: "string", format: "email" },
  });
  assert.equal(
    assertV3RoundTrip(local),
    `${HEAD}- :T: A T.
  - mail - Its mail - an :Email:. Sensitive.

- :Email: An email address - an email string.
`,
  );
});

test("any other label, or a label elsewhere, is not the sentence and uses the escape", () => {
  const plain = assertV3RoundTrip(
    '{"title":"T","type":"object","description":"A T.","properties":{' +
      '"pub":{"description":"P","type":"string","label":"public"},' +
      '"other":{"description":"O","type":"string","label":"secret"},' +
      '"number":{"description":"N","type":"string","label":1},' +
      '"early":{"description":"E","label":"sensitive","type":"string"},' +
      '"twice":{"description":"T","type":"string","label":"sensitive","label2":1,"default":"x"},' +
      '"dup":{"description":"D","type":"string","label":"sensitive","label":"sensitive"},' +
      '"afterDefault":{"description":"A","type":"string","default":"x","label":"sensitive"},' +
      '"bare":{"description":"B","label":"sensitive"}' +
      '},"required":["pub","other","number","early","twice","dup","afterDefault","bare"],"additionalProperties":false}',
  );
  assert.equal(body(plain).split("\n").filter((line) => line.includes("Exact JSON Schema:")).length, 8);
});

test("a property merely named label is not a mark, and Sensitive is not reserved in a description", () => {
  const schema = object({
    label: { description: "Sensitive. Really", type: "string" },
    Sensitive: { description: "Its name is not a sentence", type: "boolean" },
  });
  const plain = assertV3RoundTrip(schema);
  assert.equal(
    body(plain),
    "- :T: A T.\n  - label - Sensitive. Really - a string.\n  - Sensitive - Its name is not a sentence - a boolean.\n",
  );
});

test("Sensitive. has to come in its place", () => {
  assert.throws(
    () => toJsonSchema(`${HEAD}- :T: A T.\n  - a - A - a string. Defaults to "x". Sensitive.`),
    /Invalid embedded JSON/,
  );
  assert.throws(
    () => toJsonSchema(`${HEAD}- :T: A T.\n  - a - A - a string. Sensitive. Sensitive.`),
    /Unknown version-3 constraint "a string\. Sensitive" at line 6/,
  );
  assert.throws(
    () => toJsonSchema(`${HEAD}- :T: A T.\n  - a - A - a string. sensitive.`),
    /Unknown version-3 constraint/,
  );
  // Without the sentence the member is only exact.
  assert.deepEqual(compile(`${HEAD}- :T: A T.\n  - a - A - a string. Sensitive.`), {
    title: "T",
    type: "object",
    description: "A T.",
    properties: { a: { description: "A", type: "string", label: "sensitive" } },
    required: ["a"],
    additionalProperties: false,
  });
});

test("version 2 has no Sensitive. sentence", () => {
  const schema = object({ a: { description: "A", type: "string", label: "sensitive" } });
  assert.match(fromJsonSchema(JSON.stringify(schema), { style: "conversational" }), /^\*\*\*plaintype 2\*\*\*\n\n- Exact JSON Schema: /);
});

// ---------------------------------------------------------------------------
// (e) concepts from a library outside the module

test("a concept the module does not declare is asked of the library", () => {
  const asked: string[] = [];
  const spy: ConceptBinding = {
    ref: (name) => {
      asked.push(name);
      return library.ref(name);
    },
    concept: (ref) => library.concept(ref),
  };
  const plain = `${HEAD}- :Money: An amount.
  - currency - Its currency - a :Currency:.
  - others (optional) - Others - an array of :Currency:.
  - label - Its label - a :ContactLabel:.
  - me - Itself - a :Money:.
  - mine - Mine - a :Own:.

- :Own: Mine.
`;
  const compiled = compile(plain, { concepts: spy }) as { properties: Record<string, unknown>; $defs: unknown };
  assert.deepEqual(compiled.properties, {
    currency: { description: "Its currency", $ref: "sys0:Currency" },
    others: { description: "Others", type: "array", items: { $ref: "sys0:Currency" } },
    label: { description: "Its label", $ref: "sys0:ContactLabel" },
    me: { description: "Itself", $ref: "#" },
    mine: { description: "Mine", $ref: "#/$defs/Own" },
  });
  // The module's own names are never asked of the library.
  assert.deepEqual(asked, ["Currency", "Currency", "ContactLabel"]);
  assert.equal(stringifyJson(parsePlainType(plain, { concepts: library })), stringifyJson(parseJson(JSON.stringify(compiled))));
});

test("an unknown concept is still an error, with or without a library", () => {
  const plain = `${HEAD}- :T: A T.\n  - a - A - a :Missing:.`;
  assert.throws(() => toJsonSchema(plain), /Unknown schema name "Missing" at line 6/);
  assert.throws(() => toJsonSchema(plain, { concepts: library }), /Unknown schema name "Missing" at line 6/);
  assert.throws(
    () => toJsonSchema(`${HEAD}- :T: A T.\n  - a - A - an array of :Missing:.`, { concepts: library }),
    /Unknown schema name "Missing" at line 6/,
  );
  // With no library at all, a library name is unknown too.
  assert.throws(() => toJsonSchema(`${HEAD}- :T: A T.\n  - a - A - a :Currency:.`), /Unknown schema name "Currency" at line 6/);
});

test("a module's own declaration wins over the library", () => {
  const plain = `${HEAD}- :T: A T.
  - a - A - a :Currency:.
  - b - B - a :T:.

- :Currency: Local.
`;
  const compiled = compile(plain, { concepts: library }) as { properties: Record<string, { $ref: string }> };
  assert.equal(compiled.properties.a?.$ref, "#/$defs/Currency");
  assert.equal(compiled.properties.b?.$ref, "#");
});

test("a reference the library names is written as its concept, and one it does not stays a reference", () => {
  const schema = object({
    one: { description: "One", $ref: "sys0:Currency" },
    many: { description: "Many", type: "array", items: { $ref: "sys0:ContactPoint" } },
    unnamed: { description: "Unnamed", $ref: "sys0:Unheld" },
    web: { description: "Web", $ref: "https://example.test/x.json" },
    file: { description: "File", $ref: "schemas/x.schema.json" },
  });
  const bound = assertV3RoundTrip(schema, { concepts: library });
  assert.equal(
    body(bound),
    `- :T: A T.
  - one - One - a :Currency:.
  - many - Many - an array of :ContactPoint:.
  - unnamed - Unnamed - a reference to "sys0:Unheld".
  - web - Web - a reference to "https://example.test/x.json".
  - file - File - a reference to [schemas/x.schema.json](schemas/x.schema.json).
`,
  );
  const unbound = assertV3RoundTrip(schema);
  assert.match(unbound, /- one - One - a reference to "sys0:Currency"\./);
  assert.match(unbound, /- many - Exact JSON Schema: /);
});

test("with no option, every reference reads exactly as it did", () => {
  const schema = object({
    one: { description: "One", $ref: "sys0:Currency" },
    many: { description: "Many", type: "array", items: { $ref: "sys0:Currency" } },
  });
  const plain = assertV3RoundTrip(schema);
  assert.match(plain, /- one - One - a reference to "sys0:Currency"\./);
  assert.match(plain, /- many - Exact JSON Schema: /);
  assert.equal(plain, fromJsonSchema(JSON.stringify(schema), { style: "plain" }));
});

test("format is concept-aware: a quoted reference becomes the concept, and the result is stable", () => {
  const quoted = `${HEAD}- :T: A T.\n  - one - One - a reference to "sys0:Currency". Sensitive.\n  - two - Two - a :Currency:.\n`;
  const formatted = formatPlainType(quoted, { concepts: library });
  assert.equal(formatted, `${HEAD}- :T: A T.\n  - one - One - a :Currency:. Sensitive.\n  - two - Two - a :Currency:.\n`);
  assert.equal(formatPlainType(formatted, { concepts: library }), formatted);
  assert.deepEqual(compile(quoted, { concepts: library }), compile(formatted, { concepts: library }));
  // Without the library the concept is not known, and formatting says so.
  assert.throws(() => formatPlainType(formatted), /Unknown schema name "Currency" at line 6/);
  // The quoted form formats to itself when nothing is bound.
  const onlyQuoted = `${HEAD}- :T: A T.\n  - one - One - a reference to "sys0:Currency". Sensitive.\n`;
  assert.equal(formatPlainType(onlyQuoted), onlyQuoted);
});

test("an inconsistent library cannot make a document mean something else", () => {
  const schema = object({ a: { description: "A", $ref: "sys0:Currency" } });
  const cases: Record<string, ConceptBinding> = {
    "names it but cannot read it back": { ref: () => null, concept: () => "Currency" },
    "reads the name to another reference": { ref: () => "sys0:Other", concept: () => "Currency" },
    "names a thing that is no concept": { ref: () => "sys0:Currency", concept: () => "Not A Concept" },
    "names it as the root": { ref: () => "sys0:Currency", concept: () => "T" },
  };
  for (const [name, concepts] of Object.entries(cases)) {
    const plain = assertV3RoundTrip(schema, { concepts });
    assert.match(plain, /- a - A - a reference to "sys0:Currency"\./, name);
  }
  // A name the module declares is never given to the library.
  const declared = object({ a: { description: "A", $ref: "sys0:Currency" }, b: { description: "B", $ref: "#/$defs/Currency" } }, ["a", "b"], {
    Currency: { description: "Local", type: "string" },
  });
  const plain = assertV3RoundTrip(declared, { concepts: library });
  assert.match(plain, /- a - A - a reference to "sys0:Currency"\./);
  assert.match(plain, /- b - B - a :Currency:\./);
});

test("the library binds version 3 only", () => {
  const schema = object({ a: { description: "A", $ref: "sys0:Currency" } });
  const conversational = fromJsonSchema(JSON.stringify(schema), { style: "conversational", concepts: library });
  assert.match(conversational, /a reference to "sys0:Currency"/);
  assert.throws(
    () => toJsonSchema('***plaintype 2***\n\n- T: A T.\n  - a: A - a Currency.', { concepts: library }),
    /Unknown schema name "Currency"/,
  );
  // A v2 document converted to v3 with a library still compiles to the same JSON.
  assert.equal(formatPlainType(conversational, { style: "plain", concepts: library }).includes(":Currency:"), true);
});

test("the library is asked about every kind of reference, and a root can be one concept", () => {
  const seen: string[] = [];
  const recording: ConceptBinding = {
    ref: (name) => library.ref(name),
    concept: (ref) => {
      seen.push(ref);
      return library.concept(ref);
    },
  };
  fromJsonSchema(
    JSON.stringify(
      object({
        a: { description: "A", $ref: "https://example.test/x.json" },
        b: { description: "B", $ref: "#" },
        c: { description: "C", $ref: "#/$defs/Missing" },
      }),
    ),
    { style: "plain", concepts: recording },
  );
  assert.deepEqual([...new Set(seen)].sort(), ["#/$defs/Missing", "https://example.test/x.json"]);
  const alias = { title: "Money", description: "Money by another name", $ref: "sys0:Currency" };
  assert.equal(assertV3RoundTrip(alias, { concepts: library }), `${HEAD}- :Money: Money by another name - a :Currency:.\n`);
});

// ---------------------------------------------------------------------------
// previously valid documents keep their meaning

test("documents that used only earlier phrases compile to the same JSON Schema", () => {
  const plain = `${HEAD}- :AnimalFamily: A family tree for an animal.
  - animal - The animal represented here - an :Animal:.
  - parents (optional) - Its known parents - an array of :Animal:.
  - tag - A tag - "fixed". Defaults to "fixed". For example: "fixed".
  - nick (optional) - A nick - a string, or null. Defaults to null.
  - mail - Mail - an email string.
  - code - Code - a string of exactly 15 digits.
  - level - Level - an integer between 0 and 200, or null.
  - kind - Kind - one of "a", "b", or "c". For example: "a" or "b".
  - Additional properties allowed

- :Animal: A reusable animal record.
  - name - The animal's name - a string containing at least one character.
`;
  const expected = {
    title: "AnimalFamily",
    type: "object",
    description: "A family tree for an animal.",
    properties: {
      animal: { description: "The animal represented here", $ref: "#/$defs/Animal" },
      parents: { description: "Its known parents", type: "array", items: { $ref: "#/$defs/Animal" } },
      tag: { description: "A tag", const: "fixed", default: "fixed", examples: ["fixed"] },
      nick: { description: "A nick", type: ["string", "null"], default: null },
      mail: { description: "Mail", type: "string", format: "email" },
      code: { description: "Code", type: "string", pattern: "^[0-9]{15}$" },
      level: { description: "Level", type: ["integer", "null"], minimum: 0, maximum: 200 },
      kind: { description: "Kind", enum: ["a", "b", "c"], examples: ["a", "b"] },
    },
    required: ["animal", "tag", "mail", "code", "level", "kind"],
    $defs: {
      Animal: {
        type: "object",
        description: "A reusable animal record.",
        properties: { name: { description: "The animal's name", type: "string", minLength: 1 } },
        required: ["name"],
        additionalProperties: false,
      },
    },
    additionalProperties: true,
  };
  assert.equal(JSON.stringify(compile(plain)), JSON.stringify(expected));
  assert.equal(formatPlainType(plain), plain);
  assert.equal(fromJsonSchema(JSON.stringify(expected), { style: "plain" }), plain);
});

test("earlier documents keep their errors", () => {
  assert.throws(() => toJsonSchema(`${HEAD}- :A: An animal.\n  - owner - Its owner - an Owner.`), /Unknown version-3 constraint "an Owner" at line 6/);
  assert.throws(() => toJsonSchema(`${HEAD}- :A: An animal.\n  - a: Its name - a string.`), /Expected ' - ' between the attribute name and its description at line 6/);
  assert.throws(() => toJsonSchema(`${HEAD}- :A: An animal.\n  - a - Its name - a string and more.`), /Unknown version-3 constraint "a string and more" at line 6/);
});

test("an object whose prose has a dash but no final period is an object, as ever", () => {
  const plain = `${HEAD}- :A: An animal - of a kind\n  - a - A - a string.\n`;
  assert.deepEqual(compile(plain), {
    title: "A",
    type: "object",
    description: "An animal - of a kind",
    properties: { a: { description: "A", type: "string" } },
    required: ["a"],
    additionalProperties: false,
  });
  assert.equal(assertV3RoundTrip(compile(plain)), plain);
});
