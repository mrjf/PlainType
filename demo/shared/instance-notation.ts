/**
 * PlainType data: a ***plain-style notation for one JSON value (an instance of
 * a schema), deterministic in both directions.
 *
 *     ***plaintype data 1***
 *
 *     - :Button:
 *       - label - "Buy now"
 *       - priority - 2
 *       - tags - ["sale","cta"]
 *       - owner
 *         - name - "Ada"
 *       - history
 *         - #1 - "created"
 *         - #2
 *           - at - "2026-10-19"
 *
 * The root bullet is a concept label (the schema's title; it is not data).
 * A member is `key - <JSON>` or a bare `key` whose children are its members or
 * its numbered `#n` items. Values are strict JSON read with PlainType's lossless
 * parser, so key order, duplicate keys, and number spellings survive.
 * `>` lines are comments. Empty containers are written inline as {} and [].
 */

import { parseJson, stringifyJson, type JsonNode, type JsonObjectEntry } from "../../src/index.js";

export const INSTANCE_HEADER = "***plaintype data 1***";
/** Arrays of scalars stay on one line up to this many characters. */
const INLINE_ARRAY_LIMIT = 60;
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const CONCEPT = /^:([A-Za-z0-9+._-]+):(?: - ([\s\S]*))?$/;

export class InstanceSyntaxError extends SyntaxError {
  public readonly line: number;

  public constructor(message: string, line: number) {
    super(`${message} at line ${line}`);
    this.name = "InstanceSyntaxError";
    this.line = line;
  }
}

export interface ParsedInstance {
  readonly name: string;
  readonly value: JsonNode;
}

interface Bullet {
  readonly text: string;
  readonly line: number;
  readonly children: Bullet[];
}

export function parseInstance(source: string): ParsedInstance {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  let index = 0;
  while (index < lines.length && (lines[index] ?? "").trim() === "") index += 1;
  if (lines[index] !== INSTANCE_HEADER) throw new InstanceSyntaxError(`Expected ${INSTANCE_HEADER}`, index + 1);

  const roots = parseBullets(lines, index + 1);
  const [root, extra] = roots;
  if (root === undefined) throw new InstanceSyntaxError("Expected a root bullet such as - :Button:", index + 2);
  if (extra !== undefined) throw new InstanceSyntaxError("An instance has exactly one root bullet", extra.line);

  const concept = CONCEPT.exec(root.text);
  if (concept === null) throw new InstanceSyntaxError("The root bullet must be a :ConceptName: label", root.line);
  const inline = concept[2];
  if (inline !== undefined) {
    if (root.children.length > 0) throw new InstanceSyntaxError("A root with an inline value cannot have children", root.line);
    return { name: concept[1] ?? "", value: jsonValue(inline, root.line) };
  }
  return { name: concept[1] ?? "", value: containerFrom(root) };
}

/** Members (`key …`) make an object, numbered items (`#n …`) an array. */
function containerFrom(parent: Bullet): JsonNode {
  const [first] = parent.children;
  if (first === undefined) {
    throw new InstanceSyntaxError("A container needs children; write an empty one inline as {} or []", parent.line);
  }
  if (first.text.startsWith("#")) {
    return {
      type: "array",
      items: parent.children.map((child, position) => {
        const item = /^#([1-9][0-9]*)(?: - ([\s\S]*))?$/.exec(child.text);
        if (item === null) throw new InstanceSyntaxError("Every child of a list must be a numbered #n item", child.line);
        if (Number(item[1]) !== position + 1) throw new InstanceSyntaxError(`Expected item #${position + 1}`, child.line);
        return valueOf(child, item[2]);
      }),
    };
  }
  const entries: JsonObjectEntry[] = parent.children.map((child) => {
    const { key, rest } = memberKey(child);
    return { key, value: valueOf(child, rest) };
  });
  return { type: "object", entries };
}

function valueOf(bullet: Bullet, inline: string | undefined): JsonNode {
  if (inline === undefined) return containerFrom(bullet);
  if (bullet.children.length > 0) throw new InstanceSyntaxError("A member with an inline value cannot have children", bullet.line);
  return jsonValue(inline, bullet.line);
}

function memberKey(bullet: Bullet): { key: string; rest: string | undefined } {
  const text = bullet.text;
  let token: string;
  if (text.startsWith('"')) {
    const end = endOfString(text, bullet.line);
    token = text.slice(0, end);
  } else {
    const match = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(text);
    if (match === null) throw new InstanceSyntaxError("Expected a member name or a JSON string", bullet.line);
    token = match[0];
  }
  const keyNode = token.startsWith('"') ? jsonValue(token, bullet.line) : { type: "string" as const, value: token };
  if (keyNode.type !== "string") throw new InstanceSyntaxError("A member name must be a string", bullet.line);
  const after = text.slice(token.length);
  if (after === "") return { key: keyNode.value, rest: undefined };
  if (!after.startsWith(" - ")) throw new InstanceSyntaxError("Expected ' - ' between the member name and its value", bullet.line);
  return { key: keyNode.value, rest: after.slice(3) };
}

function jsonValue(source: string, line: number): JsonNode {
  try {
    return parseJson(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message.replace(/ at line \d+.*$/, "") : String(error);
    throw new InstanceSyntaxError(`Invalid JSON value (${detail})`, line);
  }
}

function endOfString(text: string, line: number): number {
  for (let index = 1; index < text.length; index += 1) {
    if (text[index] === "\\") index += 1;
    else if (text[index] === '"') return index + 1;
  }
  throw new InstanceSyntaxError("Unterminated JSON string", line);
}

function parseBullets(lines: readonly string[], start: number): Bullet[] {
  const roots: Bullet[] = [];
  const stack: Bullet[][] = [roots];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "" || /^ *>/.test(line)) continue;
    if (line.includes("\t")) throw new InstanceSyntaxError("Tabs are not allowed for indentation", index + 1);
    const match = /^( *)- ([\s\S]+)$/.exec(line);
    if (match === null) throw new InstanceSyntaxError("Expected a '- ' bullet", index + 1);
    const spaces = match[1]?.length ?? 0;
    if (spaces % 2 !== 0) throw new InstanceSyntaxError("Indentation must use multiples of two spaces", index + 1);
    const depth = spaces / 2;
    while (stack.length > depth + 1) stack.pop();
    if (depth === stack.length) {
      const parent = stack[depth - 1]?.at(-1);
      if (parent === undefined) throw new InstanceSyntaxError("Indentation skipped a nesting level", index + 1);
      stack.push(parent.children);
    } else if (depth > stack.length) {
      throw new InstanceSyntaxError("Indentation skipped a nesting level", index + 1);
    }
    stack[depth]?.push({ text: match[2] ?? "", line: index + 1, children: [] });
  }
  return roots;
}

/** Canonical text for a value, labelled with a concept name. */
export function formatInstance(value: JsonNode, name: string): string {
  const label = /^[A-Za-z0-9+._-]+$/.test(name) ? name : "Instance";
  const lines = [INSTANCE_HEADER, ""];
  if (isScalar(value) || isEmpty(value) || inlineArray(value) !== null) {
    lines.push(`- :${label}: - ${inlineArray(value) ?? stringifyJson(value)}`);
  } else {
    lines.push(`- :${label}:`, ...children(value, 1));
  }
  return `${lines.join("\n")}\n`;
}

function children(value: JsonNode, depth: number): string[] {
  const pad = "  ".repeat(depth);
  const lines: string[] = [];
  const emit = (head: string, child: JsonNode): void => {
    const inline = isScalar(child) || isEmpty(child) ? stringifyJson(child) : inlineArray(child);
    if (inline !== null) lines.push(`${pad}- ${head} - ${inline}`);
    else lines.push(`${pad}- ${head}`, ...children(child, depth + 1));
  };
  if (value.type === "object") for (const entry of value.entries) emit(memberToken(entry.key), entry.value);
  if (value.type === "array") value.items.forEach((item, index) => emit(`#${index + 1}`, item));
  return lines;
}

function memberToken(key: string): string {
  return SAFE_KEY.test(key) ? key : stringifyJson({ type: "string", value: key });
}

function isScalar(value: JsonNode): boolean {
  return value.type !== "object" && value.type !== "array";
}

function isEmpty(value: JsonNode): boolean {
  return (value.type === "object" && value.entries.length === 0) || (value.type === "array" && value.items.length === 0);
}

function inlineArray(value: JsonNode): string | null {
  if (value.type !== "array" || value.items.length === 0 || !value.items.every(isScalar)) return null;
  const text = stringifyJson(value);
  return text.length <= INLINE_ARRAY_LIMIT ? text : null;
}
