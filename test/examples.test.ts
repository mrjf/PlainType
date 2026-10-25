import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { formatPlainType, fromJsonSchema, parseJson, toJsonSchema } from "../src/index.js";

const examples = new URL("../../examples/", import.meta.url);
const source = new URL("../../", import.meta.url);

const read = (name: string, base: URL = examples): string => readFileSync(new URL(name, base), "utf8");

const pairs = readdirSync(examples)
  .filter((name) => name.endsWith(".plaintype"))
  .map((name) => ({ name, schema: `${name.split(".")[0]}.schema.json` }));

test("every example has its schema, and compiles to it", () => {
  assert.ok(pairs.length >= 9);
  for (const { name, schema } of pairs) {
    assert.deepEqual(parseJson(toJsonSchema(read(name))), parseJson(read(schema)), name);
  }
});

test("every version-3 example is canonical", () => {
  const plain = pairs.filter(({ name }) => name.endsWith(".plain.plaintype"));
  assert.ok(plain.length >= 4);
  for (const { name } of plain) {
    assert.equal(formatPlainType(read(name)), read(name), name);
  }
});

test("the library examples are what the compiler writes for their schemas", () => {
  for (const name of ["email", "postal-address"]) {
    const plain = read(`${name}.plain.plaintype`);
    assert.equal(fromJsonSchema(read(`${name}.schema.json`), { style: "plain" }), plain, name);
    assert.doesNotMatch(plain, /Exact JSON Schema/);
    assert.match(plain, /Sensitive\./);
  }
});

test("the vendored sources import only each other", () => {
  const files = ["src/index.ts", "src/json.ts", "src/codecs.ts", "src/plaintype.ts", "demo/shared/highlight.ts"];
  const siblings = new Set(["./index.js", "./json.js", "./codecs.js", "./plaintype.js"]);
  for (const file of files) {
    const text = read(file, source);
    const specifiers = [...text.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+"([^"]+)"/gms)].map((match) => match[1] ?? "");
    for (const specifier of specifiers) {
      assert.ok(siblings.has(specifier), `${file} imports ${specifier}`);
    }
    assert.ok(!/\brequire\(|\bimport\(|\bprocess\.|\bBuffer\b|["']node:/.test(text), `${file} uses Node`);
  }
});
