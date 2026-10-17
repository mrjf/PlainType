import assert from "node:assert/strict";
import test from "node:test";

import {
  JsonSyntaxError,
  parseJson,
  stringifyJson,
  type JsonNode,
} from "../src/index.js";

function jsonSyntaxError(source: string): JsonSyntaxError {
  let caught: unknown;
  try {
    parseJson(source);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof JsonSyntaxError, `Expected JsonSyntaxError for ${JSON.stringify(source)}`);
  return caught;
}

test("parseJson and stringifyJson preserve the lossless JSON data model", () => {
  const source = String.raw`{
    "duplicate": 1,
    "duplicate": 1.000e+00,
    "numbers": [-0, 0.0, 1234567890123456789012345678901234567890, 9.99e+9999],
    "escaped": "quote: \" slash: \\ solidus: \/ controls: \b\f\n\r\t",
    "unicode": "雪 😀 \uD834\uDD1E",
    "emptyObject": {},
    "emptyArray": []
  }`;

  const parsed = parseJson(source);
  assert.equal(parsed.type, "object");
  assert.deepEqual(
    parsed.entries.map(({ key }) => key),
    ["duplicate", "duplicate", "numbers", "escaped", "unicode", "emptyObject", "emptyArray"],
  );

  const numbers = parsed.entries[2]?.value;
  assert.equal(numbers?.type, "array");
  assert.deepEqual(
    numbers.items.map((item) => item.type === "number" ? item.raw : undefined),
    ["-0", "0.0", "1234567890123456789012345678901234567890", "9.99e+9999"],
  );

  const compact = stringifyJson(parsed);
  assert.equal(
    compact,
    String.raw`{"duplicate":1,"duplicate":1.000e+00,"numbers":[-0,0.0,1234567890123456789012345678901234567890,9.99e+9999],"escaped":"quote: \" slash: \\ solidus: / controls: \b\f\n\r\t","unicode":"雪 😀 𝄞","emptyObject":{},"emptyArray":[]}`,
  );
  assert.deepEqual(parseJson(compact), parsed);
});

test("stringifyJson formats nested arrays and objects deterministically", () => {
  const value = parseJson('{"a":[1,{"b":true}],"empty":[],"nothing":null}');

  assert.equal(
    stringifyJson(value, 2),
    [
      "{",
      '  "a": [',
      "    1,",
      "    {",
      '      "b": true',
      "    }",
      "  ],",
      '  "empty": [],',
      '  "nothing": null',
      "}",
    ].join("\n"),
  );
  assert.equal(
    stringifyJson(value, "\t"),
    [
      "{",
      '\t"a": [',
      "\t\t1,",
      "\t\t{",
      '\t\t\t"b": true',
      "\t\t}",
      "\t],",
      '\t"empty": [],',
      '\t"nothing": null',
      "}",
    ].join("\n"),
  );
  assert.equal(stringifyJson(value, -4), stringifyJson(value));
  assert.equal(stringifyJson(value, 2.9), stringifyJson(value, 2));
});

test("parseJson accepts every JSON value category and legal JSON whitespace", () => {
  const source = " \t\r\n[null,true,false,0,-12.50e-2,\"text\",{},[]]\r\n";
  const parsed = parseJson(source);
  assert.equal(parsed.type, "array");
  assert.deepEqual(parsed.items.map(({ type }) => type), [
    "null",
    "boolean",
    "boolean",
    "number",
    "number",
    "string",
    "object",
    "array",
  ]);
  assert.equal(stringifyJson(parsed), '[null,true,false,0,-12.50e-2,"text",{},[]]');
});

test("parseJson accepts a leading BOM but stringifyJson emits canonical JSON without it", () => {
  const parsed = parseJson('\uFEFF{"schema":"雪","valid":true}');
  assert.deepEqual(parsed, parseJson('{"schema":"雪","valid":true}'));
  assert.equal(stringifyJson(parsed), '{"schema":"雪","valid":true}');
});

test("stringifyJson preserves explicitly constructed raw numeric tokens", () => {
  const values: JsonNode = {
    type: "array",
    items: [
      { type: "number", raw: "-0" },
      { type: "number", raw: "1.2300e-999999" },
      { type: "number", raw: "99999999999999999999999999999999999999999999999999" },
    ],
  };
  assert.equal(
    stringifyJson(values),
    "[-0,1.2300e-999999,99999999999999999999999999999999999999999999999999]",
  );
  assert.deepEqual(parseJson(stringifyJson(values)), values);
});

test("stringifyJson rejects forged invalid raw numeric tokens", () => {
  for (const raw of ["NaN", "Infinity", "01", "1,", "+1", "1."]) {
    assert.throws(
      () => stringifyJson({ type: "number", raw }),
      (error: unknown) => error instanceof TypeError && /Invalid raw JSON number/.test(error.message),
    );
  }
});

const malformedJsonCases = [
  {
    name: "empty input",
    source: "",
    message: "Expected a JSON value",
    offset: 0,
    line: 1,
    column: 1,
  },
  {
    name: "leading zero",
    source: "01",
    message: "Unexpected trailing content",
    offset: 1,
    line: 1,
    column: 2,
  },
  {
    name: "trailing array comma",
    source: "[1,]",
    message: 'Unexpected character "]"',
    offset: 3,
    line: 1,
    column: 4,
  },
  {
    name: "missing object colon on a later line",
    source: "{\n  \"answer\" 42\n}",
    message: "Expected ':' after the object member name",
    offset: 13,
    line: 2,
    column: 12,
  },
  {
    name: "invalid value after a bare carriage-return line ending",
    source: "{\r\"x\":}",
    message: 'Unexpected character "}"',
    offset: 6,
    line: 2,
    column: 5,
  },
  {
    name: "invalid string escape",
    source: String.raw`"\q"`,
    message: "Invalid JSON string",
    offset: 0,
    line: 1,
    column: 1,
  },
  {
    name: "unterminated string",
    source: '"unterminated',
    message: "Unterminated JSON string",
    offset: 0,
    line: 1,
    column: 1,
  },
  {
    name: "trailing value",
    source: "true false",
    message: "Unexpected trailing content",
    offset: 5,
    line: 1,
    column: 6,
  },
] as const;

for (const fixture of malformedJsonCases) {
  test(`parseJson reports useful diagnostics for ${fixture.name}`, () => {
    const error = jsonSyntaxError(fixture.source);
    assert.match(error.message, new RegExp(fixture.message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(error.offset, fixture.offset);
    assert.equal(error.line, fixture.line);
    assert.equal(error.column, fixture.column);
    assert.match(error.message, new RegExp(`line ${fixture.line}, column ${fixture.column}$`));
  });
}
