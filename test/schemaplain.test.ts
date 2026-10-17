import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DRAFT_2020_12,
  SchemaPlainSyntaxError,
  formatSchemaPlain,
  fromJsonSchema,
  parseJson,
  parseSchemaPlain,
  toJsonSchema,
} from "../src/index.js";

const HEADER = "***schemaplain 1***";
const HEADER_V2 = "***schemaplain 2***";

function assertSchemaRoundTrip(
  json: string,
  options: Parameters<typeof fromJsonSchema>[1] = {},
): { plain: string; emitted: string } {
  const plain = fromJsonSchema(json, options);
  const emitted = toJsonSchema(plain);
  assert.deepEqual(parseJson(emitted), parseJson(json));
  return { plain, emitted };
}

function schemaPlainSyntaxError(source: string): SchemaPlainSyntaxError {
  let caught: unknown;
  try {
    parseSchemaPlain(source);
  } catch (error) {
    caught = error;
  }
  assert.ok(
    caught instanceof SchemaPlainSyntaxError,
    `Expected SchemaPlainSyntaxError for ${JSON.stringify(source)}`,
  );
  return caught;
}

const markerSchemas = [
  {
    name: "true boolean schema",
    json: "true",
    clause: "Every instance is accepted.",
    compact: "true\n",
  },
  {
    name: "false boolean schema",
    json: "false",
    clause: "No instance is accepted.",
    compact: "false\n",
  },
  {
    name: "empty object schema",
    json: "{}",
    clause: "No constraints or annotations are specified.",
    compact: "{}\n",
  },
] as const;

for (const fixture of markerSchemas) {
  test(`${fixture.name} has a unique, reversible clause`, () => {
    const expectedPlain = `${HEADER}\n\n- ${fixture.clause}\n`;
    assert.equal(fromJsonSchema(fixture.json), expectedPlain);
    assert.equal(toJsonSchema(expectedPlain, { space: 0 }), fixture.compact);
    assert.equal(formatSchemaPlain(expectedPlain), expectedPlain);
  });
}

test("a representative Draft 2020-12 schema round-trips every keyword family", () => {
  const source = String.raw`{
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$vocabulary": {
      "https://json-schema.org/draft/2020-12/vocab/core": true,
      "https://example.com/vocab/optional": false
    },
    "$id": "https://example.com/schemas/注文",
    "$anchor": "root",
    "$dynamicAnchor": "node",
    "$ref": "#/$defs/base",
    "$dynamicRef": "#node",
    "$comment": "transport me exactly",
    "$defs": {
      "base": {"type": "object"},
      "anything": true,
      "never": false
    },
    "allOf": [true, {"title": "all branch"}],
    "anyOf": [false, {"const": 7}],
    "oneOf": [{}, {"type": "null"}],
    "not": false,
    "if": {"properties": {"kind": {"const": "business"}}},
    "then": {"required": ["tax_id"]},
    "else": true,
    "dependentSchemas": {
      "credit_card": {"required": ["billing_address"]}
    },
    "prefixItems": [{"type": "string"}, false],
    "items": {"type": "integer"},
    "contains": {"const": "needle"},
    "properties": {
      "name": {"type": "string", "minLength": 1},
      "a/b~c\n雪": {"description": "escaped property name"},
      "flag": true
    },
    "patternProperties": {
      "^x-": {"type": ["string", "null"]}
    },
    "additionalProperties": false,
    "propertyNames": {"pattern": "^[^\\u0000]+$"},
    "unevaluatedItems": false,
    "unevaluatedProperties": {"type": "number"},
    "type": ["object", "null"],
    "enum": [null, false, 0, "", [], {}],
    "const": {"looksLikeSchema": {"type": "instance data"}},
    "multipleOf": 0.0100,
    "maximum": 1e+400,
    "exclusiveMaximum": 100,
    "minimum": -0,
    "exclusiveMinimum": -1.2300e-004,
    "maxLength": 99,
    "minLength": 0,
    "pattern": "^(?:雪|😀)\\s+$",
    "maxItems": 20,
    "minItems": 1,
    "uniqueItems": true,
    "maxContains": 3,
    "minContains": 1,
    "maxProperties": 50,
    "minProperties": 1,
    "required": ["name", "a/b~c\n雪"],
    "dependentRequired": {
      "credit_card": ["billing_address", "security_code"]
    },
    "title": "Customer 雪 😀",
    "description": "quote: \"; slash: \\; newline: \n",
    "default": {"type": "this is data", "nested": [1, false]},
    "deprecated": false,
    "readOnly": true,
    "writeOnly": false,
    "examples": [{"name": "Ada"}, null],
    "format": "custom-format",
    "contentEncoding": "base64",
    "contentMediaType": "application/json",
    "contentSchema": {"type": "object"},
    "$recursiveAnchor": "legacyAnchor",
    "$recursiveRef": "#",
    "definitions": {"legacy": {}},
    "dependencies": {"old": ["other"]},
    "x-company-rule": {"level": 2, "payload": [true, null]}
  }`;

  const { plain, emitted } = assertSchemaRoundTrip(source);

  assert.match(plain, /- It declares JSON Schema dialect "https:\/\/json-schema\.org\/draft\/2020-12\/schema"\./);
  assert.match(
    plain,
    /- Properties:\n  - name:\n    - allowed types:\n      - string \(must contain at least 1 character\)/,
  );
  assert.match(plain, /- Every one of these schemas must be satisfied:\n  - Schema 1:/);
  assert.match(plain, /- Its content schema annotation is:/);
  assert.match(
    plain,
    /- Its exact JSON Schema entry is \["x-company-rule",\{"level":2,"payload":\[true,null\]\}\]\./,
  );
  assert.match(plain, /A numeric instance must be at most 1e\+400\./);
  assert.match(emitted, /"minimum": -0/);
  assert.match(emitted, /"exclusiveMinimum": -1\.2300e-004/);

  assert.equal(formatSchemaPlain(plain), plain);
  assert.equal(fromJsonSchema(emitted), plain);
});

test("unknown keywords and known keywords with unknown shapes use exact-entry clauses", () => {
  const source = String.raw`{
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "x-extension": {"properties": {"not-a-subschema": 1e9999}, "pair": [1, 2]},
    "type": 17,
    "maxLength": -1,
    "multipleOf": 0,
    "required": ["duplicate", "duplicate"],
    "items": [true, false],
    "properties": {"valid": true, "invalid": 3},
    "$recursiveAnchor": false
  }`;

  const { plain } = assertSchemaRoundTrip(source);
  assert.match(plain, /Its exact JSON Schema entry is \["x-extension",/);
  assert.match(plain, /Its exact JSON Schema entry is \["type",17\]\./);
  assert.match(plain, /Its exact JSON Schema entry is \["maxLength",-1\]\./);
  assert.match(plain, /Its exact JSON Schema entry is \["multipleOf",0\]\./);
  assert.match(plain, /Its exact JSON Schema entry is \["required",\["duplicate","duplicate"\]\]\./);
  assert.match(plain, /Its exact JSON Schema entry is \["items",\[true,false\]\]\./);
  assert.match(plain, /Its exact JSON Schema entry is \["properties",/);
  assert.match(plain, /Its exact JSON Schema entry is \["\$recursiveAnchor",false\]\./);
  assert.doesNotMatch(plain, /- Properties:/);
});

test("valid Draft 2020-12 numeric and reserved-keyword edge shapes stay friendly", () => {
  const source = String.raw`{
    "type": ["integer", "null"],
    "multipleOf": 1e-999999,
    "maxLength": 1.0e+2,
    "minItems": -0,
    "required": [],
    "dependentRequired": {"x": []},
    "$recursiveAnchor": "legacyAnchor"
  }`;
  const { plain } = assertSchemaRoundTrip(source);

  assert.doesNotMatch(plain, /exact JSON Schema entry/);
  assert.match(plain, /Its legacy recursive anchor is "legacyAnchor"\./);
});

test("Properties uses bare safe names, quoted unsafe names, and reversible required markers", () => {
  const source = JSON.stringify({
    properties: {
      name: { type: "string", minLength: 1 },
      snake_case: false,
      "display name": {},
      "looks (required)": true,
      雪: true,
    },
    required: ["name", "display name", "雪"],
  });
  const { plain } = assertSchemaRoundTrip(source);

  assert.match(plain, /- Properties:\n  - name \(required\):/);
  assert.match(plain, /  - snake_case:\n    - No instance is accepted\./);
  assert.match(plain, /  - "display name" \(required\):/);
  assert.match(plain, /  - "looks \(required\)":\n    - Every instance is accepted\./);
  assert.match(plain, /  - "雪" \(required\):/);
  assert.doesNotMatch(plain, /- Required properties:/);
  assert.doesNotMatch(plain, /Its property schemas are|Property "name"/);
});

test("quoted property names that resemble conversational syntax remain unambiguous", () => {
  const source = JSON.stringify({
    properties: {
      "label, which still belongs to the name": { type: "string" },
      "label (required), which also belongs to the name": { type: "null" },
    },
    required: ["label (required), which also belongs to the name"],
  });
  const { plain } = assertSchemaRoundTrip(source, { style: "conversational" });

  assert.match(plain, /^\*\*\*schemaplain 2\*\*\*\n\n- Exact JSON Schema:/);
  assert.equal(formatSchemaPlain(plain, { style: "conversational" }), plain);

  const legacy = [
    HEADER,
    "",
    "- Properties:",
    '  - "label, which still belongs to the name", which must be a string.',
    '  - "label (required), which also belongs to the name" (required), which must be null.',
    "",
  ].join("\n");
  assert.deepEqual(parseJson(toJsonSchema(legacy)), parseJson(source));
});

test("required markers fold recursively inside property schemas", () => {
  const source = JSON.stringify({
    properties: {
      outer: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
    required: ["outer"],
  });
  const { plain } = assertSchemaRoundTrip(source, { style: "structured" });

  assert.match(plain, /- outer \(required\):/);
  assert.match(plain, /- name \(required\):\n        - allowed types:\n          - string/);
  assert.doesNotMatch(plain, /- Required properties:/);
});

test("property type lists inline adjacent minLength without collapsing singleton arrays", () => {
  const source = String.raw`{
    "properties": {
      "scalar": {"type": "string"},
      "singleton": {"type": ["string"]},
      "union": {"type": ["string", "null"], "minLength": 1.0},
      "reversed": {"minLength": 2, "type": "string"},
      "separated": {"type": "string", "title": "break", "minLength": 3}
    }
  }`;
  const { plain, emitted } = assertSchemaRoundTrip(source);

  assert.match(plain, /- scalar:\n    - allowed types:\n      - string/);
  assert.match(plain, /- singleton:\n    - Its allowed type or types are \["string"\]\./);
  assert.match(
    plain,
    /- union:\n    - allowed types:\n      - string \(must contain at least 1\.0 character\)\n      - null/,
  );
  assert.match(
    plain,
    /- reversed:\n    - A string instance must contain at least this many characters: 2\.\n    - allowed types:\n      - string/,
  );
  assert.match(
    plain,
    /- separated:\n    - allowed types:\n      - string\n    - Its title is "break"\.\n    - A string instance must contain at least this many characters: 3\./,
  );
  assert.match(emitted, /"minLength": 1\.0/);

  const conversationalSingleton = fromJsonSchema(
    '{"properties":{"value":{"type":["string"]}}}',
    { style: "conversational" },
  );
  assert.match(conversationalSingleton, /- Exact JSON Schema:/);
  assert.deepEqual(
    parseJson(toJsonSchema(conversationalSingleton)),
    parseJson('{"properties":{"value":{"type":["string"]}}}'),
  );
});

test("required folding falls back whenever adjacency, membership, or ordering is not reversible", () => {
  const fixtures = [
    {
      name: "required comes before properties",
      source: '{"required":["a"],"properties":{"a":true}}',
    },
    {
      name: "an entry separates properties and required",
      source: '{"properties":{"a":true},"title":"separator","required":["a"]}',
    },
    {
      name: "required order differs from property order",
      source: '{"properties":{"a":true,"b":true},"required":["b","a"]}',
    },
    {
      name: "required contains an orphan name",
      source: '{"properties":{"a":true},"required":["missing","a"]}',
    },
    {
      name: "required is explicitly empty",
      source: '{"properties":{"a":true},"required":[]}',
    },
    {
      name: "properties contains duplicate names",
      source: '{"properties":{"a":true,"a":false},"required":["a"]}',
    },
  ] as const;

  for (const fixture of fixtures) {
    const { plain } = assertSchemaRoundTrip(fixture.source);
    assert.match(plain, /- Required properties: \[/, fixture.name);
    assert.doesNotMatch(plain, /\(required\)/, fixture.name);
  }
});

test("description comments are semantic while $comment remains a distinct keyword", () => {
  const source = JSON.stringify({
    description: "Public schema summary # punctuation is literal.",
    $comment: "implementation note",
    properties: {
      field: {
        description: "What this field is all about.",
        $comment: "tooling-only note",
      },
    },
  });
  const { plain } = assertSchemaRoundTrip(source);

  assert.match(plain, /^# Public schema summary # punctuation is literal\.$/m);
  assert.match(plain, /^- Its implementation comment is "implementation note"\.$/m);
  assert.match(plain, /^  - field:\n    # What this field is all about\.$/m);
  assert.match(plain, /^    - Its implementation comment is "tooling-only note"\.$/m);

  const authored = `${HEADER}\n\n# Authored descriptions become schema data.\n`;
  assert.equal(
    toJsonSchema(authored, { space: 0 }),
    '{"description":"Authored descriptions become schema data."}\n',
  );
  assert.equal(formatSchemaPlain(authored), authored);

  const describedProperty = JSON.stringify({
    properties: {
      name: {
        description: "The person's display name.",
        type: ["string", "null"],
        minLength: 1,
      },
    },
    required: ["name"],
  });
  const conversational = assertSchemaRoundTrip(
    describedProperty,
    { style: "conversational" },
  ).plain;
  assert.match(conversational, /^\*\*\*schemaplain 2\*\*\*\n\n- Exact JSON Schema:/);
  assert.equal(formatSchemaPlain(conversational, { style: "conversational" }), conversational);
});

test("descriptions unsafe for line comments retain their JSON-valued clause", () => {
  const fixtures = [
    String.raw`{"description":" leading whitespace"}`,
    String.raw`{"description":"line\nbreak"}`,
    String.raw`{"description":"\uD800"}`,
  ];

  for (const source of fixtures) {
    const { plain } = assertSchemaRoundTrip(source);
    assert.match(plain, /- Its description is /);
    assert.doesNotMatch(plain, /^#(?: |$)/m);
  }
  assert.match(fromJsonSchema(fixtures[2] ?? "{}"), /\\ud800/i);

  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "from-json"], {
    encoding: "utf8",
    input: fixtures[2],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\\ud800/i);
  assert.deepEqual(parseJson(toJsonSchema(result.stdout)), parseJson(fixtures[2] ?? "{}"));
});

test("structured and conversational property styles are deterministic and interchangeable", () => {
  const source = '{"properties":{"name":{"type":["string","null"],"minLength":1}},"required":["name"]}';
  const structured = fromJsonSchema(source, { style: "structured" });
  const conversational = fromJsonSchema(source, { style: "conversational" });
  const expectedConversational = [
    HEADER_V2,
    "",
    '- Exact JSON Schema: {"properties":{"name":{"type":["string","null"],"minLength":1}},"required":["name"]}',
    "",
  ].join("\n");

  assert.equal(conversational, expectedConversational);
  assertSchemaRoundTrip(source, { style: "structured" });
  assertSchemaRoundTrip(source, { style: "conversational" });
  assert.equal(formatSchemaPlain(structured, { style: "structured" }), structured);
  assert.equal(formatSchemaPlain(conversational, { style: "conversational" }), conversational);
  assert.equal(formatSchemaPlain(structured, { style: "conversational" }), conversational);
  assert.equal(formatSchemaPlain(conversational, { style: "structured" }), structured);
  assert.equal(fromJsonSchema(toJsonSchema(conversational), { style: "conversational" }), conversational);
});

test("an unknown declared dialect renders every member opaquely", () => {
  const source = String.raw`{
    "$schema": "https://example.com/dialect/custom",
    "type": "string",
    "properties": {"x": {"type": "integer"}},
    "x-keyword": true
  }`;
  const { plain } = assertSchemaRoundTrip(source);

  assert.doesNotMatch(plain, /allowed type|property schemas|declares JSON Schema dialect/);
  assert.equal((plain.match(/exact JSON Schema entry/g) ?? []).length, 4);
  assert.equal(formatSchemaPlain(plain), plain);
});

test("defaultDialect null forces opaque rendering without inserting $schema", () => {
  const source = '{"type":"string","properties":{"x":{"type":"integer"}}}';
  const plain = fromJsonSchema(source, { defaultDialect: null });

  assert.equal((plain.match(/exact JSON Schema entry/g) ?? []).length, 2);
  assert.deepEqual(parseJson(toJsonSchema(plain)), parseJson(source));
  assert.doesNotMatch(toJsonSchema(plain), /\$schema/);
  assert.equal(formatSchemaPlain(plain, { defaultDialect: null }), plain);
});

test("huge numbers and every raw numeric spelling survive SchemaPlain", () => {
  const source = String.raw`{"minimum":-0,"maximum":999999999999999999999999999999999999999999999999999999999999,"multipleOf":1.2300e-999999,"const":9E+999999}`;
  const plain = fromJsonSchema(source);

  assert.match(plain, /-0\./);
  assert.match(plain, /1\.2300e-999999\./);
  assert.match(plain, /9E\+999999\./);
  assert.equal(toJsonSchema(plain, { space: 0 }), `${source}\n`);
  assert.equal(fromJsonSchema(toJsonSchema(plain, { space: 0 })), plain);
});

test("duplicate object member names and ordering survive both formats", () => {
  const source = String.raw`{
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "first",
    "title": "second",
    "x-value": 1,
    "x-value": 2.00,
    "properties": {
      "same": {"type": "string"},
      "same": false
    },
    "default": {"inside": 1, "inside": 2.00, "lone-surrogate": "\uD800"}
  }`;
  const { plain, emitted } = assertSchemaRoundTrip(source);
  const reparsed = parseJson(emitted);

  assert.equal(reparsed.type, "object");
  assert.deepEqual(
    reparsed.entries.map(({ key }) => key),
    ["$schema", "title", "title", "x-value", "x-value", "properties", "default"],
  );
  assert.equal((plain.match(/- Its title is/g) ?? []).length, 2);
  assert.equal((plain.match(/  - same:/g) ?? []).length, 2);
  assert.match(emitted, /"x-value": 2\.00/);
  assert.match(emitted, /"default": \{\n    "inside": 1,\n    "inside": 2\.00,/);
  assert.match(emitted, /"lone-surrogate": "\\ud800"/i);
});

test("Unicode strings, JSON escapes, and unusual map keys round-trip as decoded strings", () => {
  const source = String.raw`{
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "雪 😀 \uD834\uDD1E",
    "description": "quote \" backslash \\ slash \/ controls \b\f\n\r\t",
    "properties": {
      "a/b~c\n\"\\雪": {"pattern": "^(?:雪|😀)\\d+$"}
    },
    "required": ["a/b~c\n\"\\雪"],
    "x-🔒": "\u0000"
  }`;
  const { plain } = assertSchemaRoundTrip(source);

  assert.ok(plain.includes('Its title is "雪 😀 𝄞".'));
  assert.ok(plain.includes('"a/b~c\\n\\"\\\\雪" (required):'));
  assert.ok(plain.includes(String.raw`["x-🔒","\u0000"]`));
  assert.equal(formatSchemaPlain(plain), plain);
});

test("Unicode line and paragraph separators remain valid inside inline JSON", () => {
  const lineSeparator = "\u2028";
  const paragraphSeparator = "\u2029";
  const source = JSON.stringify({
    description: `before${lineSeparator}middle${paragraphSeparator}after`,
    properties: {
      [`line${lineSeparator}paragraph${paragraphSeparator}`]: true,
    },
    "x-separators": [lineSeparator, paragraphSeparator],
  });

  const { plain } = assertSchemaRoundTrip(source);
  assert.ok(plain.includes(lineSeparator));
  assert.ok(plain.includes(paragraphSeparator));
  assert.equal(formatSchemaPlain(plain), plain);
});

test("schema arrays and schema maps preserve emptiness, order, and boolean schemas", () => {
  const source = String.raw`{
    "$defs": {},
    "properties": {},
    "patternProperties": {"^x": false},
    "dependentSchemas": {},
    "definitions": {"legacy": {}},
    "allOf": [],
    "anyOf": [true],
    "oneOf": [{}, false],
    "prefixItems": [],
    "not": {},
    "items": true
  }`;
  const { plain } = assertSchemaRoundTrip(source);

  assert.match(plain, /Its reusable definition schemas are:\n- Properties:/);
  assert.match(plain, /Its pattern-property schemas are:\n  - Pattern "\^x":\n    - No instance is accepted\./);
  assert.match(plain, /Exactly one of these schemas must be satisfied:\n  - Schema 1:\n    - No constraints or annotations are specified\.\n  - Schema 2:\n    - No instance is accepted\./);
  assert.match(plain, /Its item schema is:\n  - Every instance is accepted\./);
});

test("formatSchemaPlain canonicalizes whitespace and is idempotent", () => {
  const authored = [
    "",
    HEADER,
    "",
    "",
    '- Its title is "Demo".',
    "",
    "- Its property schemas are:",
    '  - Property "x":',
    "",
    "    - Every instance is accepted.",
    "",
    "",
  ].join("\r\n");
  const expected = [
    HEADER,
    "",
    '- Its title is "Demo".',
    "- Properties:",
    "  - x:",
    "    - Every instance is accepted.",
    "",
  ].join("\n");

  const once = formatSchemaPlain(authored);
  assert.equal(once, expected);
  assert.equal(formatSchemaPlain(once), once);
  assert.equal(fromJsonSchema(toJsonSchema(authored)), once);
});

test("SchemaPlain to JSON honors compact and pretty output deterministically", () => {
  const source = `${HEADER}\n\n- Its title is "Demo".\n- Its required property names are ["x"].\n`;
  assert.equal(toJsonSchema(source, { space: 0 }), '{"title":"Demo","required":["x"]}\n');
  assert.equal(
    toJsonSchema(source),
    '{\n  "title": "Demo",\n  "required": [\n    "x"\n  ]\n}\n',
  );
});

test("CLI options do not consume another option as their value", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  for (const arguments_ of [
    ["from-json", "--dialect", "--compact"],
    ["from-json", "--output", "--compact"],
    ["from-json", "--style", "--compact"],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...arguments_], {
      encoding: "utf8",
      input: "{}",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /needs a URI|needs a path|--style needs/);
  }
});

test("CLI --style selects and reformats conversational output", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const source = '{"properties":{"name":{"type":["string","null"],"minLength":1}},"required":["name"]}';
  const conversational = spawnSync(
    process.execPath,
    [cli, "from-json", "--style", "conversational"],
    { encoding: "utf8", input: source },
  );
  assert.equal(conversational.status, 0, conversational.stderr);
  assert.equal(conversational.stdout, fromJsonSchema(source, { style: "conversational" }));

  const structured = spawnSync(
    process.execPath,
    [cli, "format", "--style=structured"],
    { encoding: "utf8", input: conversational.stdout },
  );
  assert.equal(structured.status, 0, structured.stderr);
  assert.equal(structured.stdout, fromJsonSchema(source, { style: "structured" }));
});

test("CLI rejects invalid styles and style options on non-rendering commands", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  for (const arguments_ of [
    ["from-json", "--style", "chatty"],
    ["from-json", "--style=chatty"],
    ["to-json", "--style", "structured"],
    ["check", "--style=conversational"],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...arguments_], {
      encoding: "utf8",
      input: "{}",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--style needs|--style is only valid/);
  }
});

test("fromJsonSchema rejects non-schema JSON roots", () => {
  for (const source of ["null", "0", '"schema"', "[]"]) {
    assert.throws(
      () => fromJsonSchema(source),
      (error: unknown) => error instanceof TypeError && /object or boolean at its root/.test(error.message),
    );
  }
});

const malformedPlainCases = [
  {
    name: "missing header",
    source: "- Every instance is accepted.\n",
    line: 1,
    message: "Expected ***schemaplain 1***",
  },
  {
    name: "missing schema clause",
    source: `${HEADER}\n`,
    line: 2,
    message: "Expected at least one schema clause",
  },
  {
    name: "tab indentation",
    source: `${HEADER}\n\n- Its item schema is:\n\t- Every instance is accepted.\n`,
    line: 4,
    message: "Tabs are not allowed for indentation",
  },
  {
    name: "tab-only blank line",
    source: `${HEADER}\n\t\n- Every instance is accepted.\n`,
    line: 2,
    message: "Tabs are not allowed for indentation",
  },
  {
    name: "odd indentation",
    source: `${HEADER}\n\n - Every instance is accepted.\n`,
    line: 3,
    message: "Indentation must use multiples of two spaces",
  },
  {
    name: "skipped nesting level",
    source: `${HEADER}\n\n- Its item schema is:\n    - Every instance is accepted.\n`,
    line: 4,
    message: "Indentation skipped a nesting level",
  },
  {
    name: "unknown clause",
    source: `${HEADER}\n\n- Objects probably have a name.\n`,
    line: 3,
    message: "Unknown schema clause",
  },
  {
    name: "invalid embedded JSON",
    source: `${HEADER}\n\n- Its title is "unterminated.\n`,
    line: 3,
    message: "Invalid embedded JSON",
  },
  {
    name: "malformed exact entry",
    source: `${HEADER}\n\n- Its exact JSON Schema entry is ["only-one"].\n`,
    line: 3,
    message: "An exact entry must be a two-item JSON array",
  },
  {
    name: "combined marker",
    source: `${HEADER}\n\n- Every instance is accepted.\n- Its title is "extra".\n`,
    line: 3,
    message: "A boolean or empty schema marker must be the only clause",
  },
  {
    name: "missing nested schema",
    source: `${HEADER}\n\n- Its item schema is:\n`,
    line: 3,
    message: '"items" needs a nested schema',
  },
  {
    name: "out-of-sequence schema array item",
    source: `${HEADER}\n\n- Exactly one of these schemas must be satisfied:\n  - Schema 2:\n    - Every instance is accepted.\n`,
    line: 4,
    message: 'Expected "Schema 1:"',
  },
  {
    name: "children beneath a terminal clause",
    source: `${HEADER}\n\n- Its title is "Demo".\n  - Every instance is accepted.\n`,
    line: 4,
    message: "This clause cannot contain nested clauses",
  },
] as const;

for (const fixture of malformedPlainCases) {
  test(`parseSchemaPlain reports the source line for ${fixture.name}`, () => {
    const error = schemaPlainSyntaxError(fixture.source);
    assert.equal(error.line, fixture.line);
    assert.match(error.message, new RegExp(fixture.message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(error.message, new RegExp(` at line ${fixture.line}$`));
  });
}

test("the canonical Draft 2020-12 URI remains stable", () => {
  assert.equal(DRAFT_2020_12, "https://json-schema.org/draft/2020-12/schema");
});
