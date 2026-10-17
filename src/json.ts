/**
 * A deliberately small JSON AST.
 *
 * Numbers retain their source spelling and objects retain entry order (including
 * duplicate names). Native JSON.parse cannot provide either guarantee. Keeping
 * them here makes the text-to-text round trip stronger than ordinary JavaScript
 * object equality.
 */
export type JsonNode =
  | JsonNull
  | JsonBoolean
  | JsonString
  | JsonNumber
  | JsonArray
  | JsonObject;

export interface JsonNull {
  readonly type: "null";
}

export interface JsonBoolean {
  readonly type: "boolean";
  readonly value: boolean;
}

export interface JsonString {
  readonly type: "string";
  readonly value: string;
}

export interface JsonNumber {
  readonly type: "number";
  /** A syntactically valid JSON number, retained verbatim. */
  readonly raw: string;
}

export interface JsonArray {
  readonly type: "array";
  readonly items: readonly JsonNode[];
}

export interface JsonObjectEntry {
  readonly key: string;
  readonly value: JsonNode;
}

export interface JsonObject {
  readonly type: "object";
  readonly entries: readonly JsonObjectEntry[];
}

export class JsonSyntaxError extends SyntaxError {
  public readonly offset: number;
  public readonly line: number;
  public readonly column: number;

  public constructor(message: string, source: string, offset: number) {
    const before = source.slice(0, offset);
    let line = 1;
    let lineStart = 0;
    for (let index = 0; index < before.length; index += 1) {
      const character = before[index];
      if (character !== "\r" && character !== "\n") continue;
      if (character === "\r" && before[index + 1] === "\n") index += 1;
      line += 1;
      lineStart = index + 1;
    }
    const column = offset - lineStart + 1;
    super(`${message} at line ${line}, column ${column}`);
    this.name = "JsonSyntaxError";
    this.offset = offset;
    this.line = line;
    this.column = column;
  }
}

class JsonParser {
  private offset = 0;

  public constructor(private readonly source: string) {}

  public parse(): JsonNode {
    // RFC 8259 permits parsers to ignore a leading byte-order mark even though
    // emitters must not add one.
    if (this.source.charCodeAt(0) === 0xfeff) this.offset = 1;
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.offset !== this.source.length) {
      this.fail("Unexpected trailing content");
    }
    return value;
  }

  private parseValue(): JsonNode {
    const character = this.source[this.offset];
    if (character === "\"") return { type: "string", value: this.parseString() };
    if (character === "{") return this.parseObject();
    if (character === "[") return this.parseArray();
    if (character === "t") {
      this.expectLiteral("true");
      return { type: "boolean", value: true };
    }
    if (character === "f") {
      this.expectLiteral("false");
      return { type: "boolean", value: false };
    }
    if (character === "n") {
      this.expectLiteral("null");
      return { type: "null" };
    }
    if (character === "-" || (character !== undefined && character >= "0" && character <= "9")) {
      return this.parseNumber();
    }
    this.fail(character === undefined ? "Expected a JSON value" : `Unexpected character ${JSON.stringify(character)}`);
  }

  private parseObject(): JsonObject {
    this.offset += 1;
    this.skipWhitespace();
    const entries: JsonObjectEntry[] = [];
    if (this.consume("}")) return { type: "object", entries };

    while (true) {
      if (this.source[this.offset] !== "\"") this.fail("Expected an object member name");
      const key = this.parseString();
      this.skipWhitespace();
      if (!this.consume(":")) this.fail("Expected ':' after the object member name");
      this.skipWhitespace();
      entries.push({ key, value: this.parseValue() });
      this.skipWhitespace();
      if (this.consume("}")) break;
      if (!this.consume(",")) this.fail("Expected ',' or '}' in object");
      this.skipWhitespace();
    }
    return { type: "object", entries };
  }

  private parseArray(): JsonArray {
    this.offset += 1;
    this.skipWhitespace();
    const items: JsonNode[] = [];
    if (this.consume("]")) return { type: "array", items };

    while (true) {
      items.push(this.parseValue());
      this.skipWhitespace();
      if (this.consume("]")) break;
      if (!this.consume(",")) this.fail("Expected ',' or ']' in array");
      this.skipWhitespace();
    }
    return { type: "array", items };
  }

  private parseString(): string {
    const start = this.offset;
    this.offset += 1;

    while (this.offset < this.source.length) {
      const character = this.source[this.offset];
      if (character === "\"") {
        this.offset += 1;
        const token = this.source.slice(start, this.offset);
        try {
          return JSON.parse(token) as string;
        } catch {
          this.failAt("Invalid JSON string", start);
        }
      }
      if (character === "\\") {
        this.offset += 2;
        continue;
      }
      if (character !== undefined && character.charCodeAt(0) < 0x20) {
        this.fail("Unescaped control character in string");
      }
      this.offset += 1;
    }
    this.failAt("Unterminated JSON string", start);
  }

  private parseNumber(): JsonNumber {
    const rest = this.source.slice(this.offset);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(rest);
    if (match === null) this.fail("Invalid JSON number");
    const raw = match[0];
    this.offset += raw.length;
    return { type: "number", raw };
  }

  private expectLiteral(literal: string): void {
    if (!this.source.startsWith(literal, this.offset)) this.fail(`Expected ${literal}`);
    this.offset += literal.length;
  }

  private consume(character: string): boolean {
    if (this.source[this.offset] !== character) return false;
    this.offset += 1;
    return true;
  }

  private skipWhitespace(): void {
    while (true) {
      const character = this.source[this.offset];
      if (character !== " " && character !== "\t" && character !== "\n" && character !== "\r") return;
      this.offset += 1;
    }
  }

  private fail(message: string): never {
    throw new JsonSyntaxError(message, this.source, this.offset);
  }

  private failAt(message: string, offset: number): never {
    throw new JsonSyntaxError(message, this.source, offset);
  }
}

export function parseJson(source: string): JsonNode {
  return new JsonParser(source).parse();
}

export function jsonString(value: string): string {
  return JSON.stringify(value);
}

export function stringifyJson(node: JsonNode, space: number | string = 0): string {
  const indentation = normalizeIndentation(space);
  return stringifyNode(node, indentation, 0);
}

function normalizeIndentation(space: number | string): string {
  if (typeof space === "number") return " ".repeat(Math.max(0, Math.min(10, Math.trunc(space))));
  return space.slice(0, 10);
}

function stringifyNode(node: JsonNode, indentation: string, depth: number): string {
  switch (node.type) {
    case "null":
      return "null";
    case "boolean":
      return String(node.value);
    case "string":
      return JSON.stringify(node.value);
    case "number": {
      if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(node.raw)) {
        throw new TypeError(`Invalid raw JSON number ${JSON.stringify(node.raw)}`);
      }
      return node.raw;
    }
    case "array":
      return stringifyCollection(
        "[",
        "]",
        node.items.map((item) => stringifyNode(item, indentation, depth + 1)),
        indentation,
        depth,
      );
    case "object":
      return stringifyCollection(
        "{",
        "}",
        node.entries.map(
          ({ key, value }) => `${JSON.stringify(key)}${indentation === "" ? ":" : ": "}${stringifyNode(value, indentation, depth + 1)}`,
        ),
        indentation,
        depth,
      );
  }
}

function stringifyCollection(
  open: string,
  close: string,
  values: readonly string[],
  indentation: string,
  depth: number,
): string {
  if (values.length === 0) return open + close;
  if (indentation === "") return `${open}${values.join(",")}${close}`;
  const current = indentation.repeat(depth);
  const child = indentation.repeat(depth + 1);
  return `${open}\n${child}${values.join(`,\n${child}`)}\n${current}${close}`;
}

export function isSchemaNode(node: JsonNode): node is JsonBoolean | JsonObject {
  return node.type === "boolean" || node.type === "object";
}

export function stringNode(value: string): JsonString {
  return { type: "string", value };
}

export function objectNode(entries: readonly JsonObjectEntry[]): JsonObject {
  return { type: "object", entries };
}

export function arrayNode(items: readonly JsonNode[]): JsonArray {
  return { type: "array", items };
}
