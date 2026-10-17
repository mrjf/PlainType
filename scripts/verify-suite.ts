#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  DRAFT_2020_12,
  fromJsonSchema,
  isSchemaNode,
  parseJson,
  stringifyJson,
  toJsonSchema,
  type JsonNode,
  type JsonObject,
  type RenderStyle,
} from "../src/index.js";

const directory = process.argv[2];
const styleValue = process.argv[3] ?? "structured";
if (directory === undefined) {
  process.stderr.write(
    "Usage: npm run verify:suite -- /path/to/JSON-Schema-Test-Suite/tests/draft2020-12 [structured|conversational|plain]\n",
  );
  process.exit(2);
}
if (styleValue !== "structured" && styleValue !== "conversational" && styleValue !== "plain") {
  throw new Error("Style must be 'structured', 'conversational', or 'plain'");
}
const style: RenderStyle = styleValue;

let filesChecked = 0;
let schemasChecked = 0;

for (const path of await jsonFiles(directory)) {
  const document = parseJson(await readFile(path, "utf8"));
  for (const schema of testCaseSchemas(document, path)) {
    const canonical = stringifyJson(schema);
    const plain = fromJsonSchema(canonical, { defaultDialect: DRAFT_2020_12, style });
    const restored = toJsonSchema(plain, { space: 0 }).trimEnd();
    if (restored !== canonical) {
      throw new Error(`Round trip changed a schema from ${path}`);
    }
    schemasChecked += 1;
  }
  filesChecked += 1;
}

process.stdout.write(
  `Round-tripped ${schemasChecked} schemas from ${filesChecked} JSON Schema Test Suite files in ${style} style.\n`,
);

async function jsonFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) paths.push(...(await jsonFiles(path)));
    else if (entry.isFile() && extname(entry.name) === ".json") paths.push(path);
  }
  return paths.sort();
}

function testCaseSchemas(document: JsonNode, path: string): JsonNode[] {
  if (document.type !== "array") throw new Error(`Expected a test-case array in ${path}`);
  return document.items.map((testCase, index) => {
    if (testCase.type !== "object") throw new Error(`Expected an object at ${path}[${index}]`);
    const schema = lastMember(testCase, "schema");
    if (schema === undefined || !isSchemaNode(schema)) {
      throw new Error(`Expected a schema at ${path}[${index}].schema`);
    }
    return schema;
  });
}

function lastMember(object: JsonObject, key: string): JsonNode | undefined {
  for (let index = object.entries.length - 1; index >= 0; index -= 1) {
    const entry = object.entries[index];
    if (entry?.key === key) return entry.value;
  }
  return undefined;
}
