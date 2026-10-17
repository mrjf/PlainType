/**
 * A small line-oriented PlainType syntax highlighter. It never decides what a
 * document means (the compiler does); it only classifies character ranges.
 */

export type TokenClass =
  | "header"
  | "bullet"
  | "comment"
  | "name"
  | "qualifier"
  | "punct"
  | "desc"
  | "keyword"
  | "type"
  | "string"
  | "number"
  | "json";

export interface Token {
  readonly start: number;
  readonly end: number;
  readonly cls: TokenClass;
}

const DIRECTIVES = [
  "Additional properties allowed",
  "Additional properties unspecified",
  "Every instance is accepted.",
  "No instance is accepted.",
  "No constraints or annotations are specified.",
  "Definitions:",
  "Properties:",
];
const KEYWORDS = new Set([
  "a", "an", "of", "or", "and", "null", "string", "strings", "integer", "array", "between", "at", "least",
  "most", "exactly", "one", "containing", "character", "characters", "digits", "date", "in", "format",
  "email", "UUID", "non-negative", "reference", "to", "allowed", "types", "type", "must", "contain",
  "be", "is", "are", "its", "it", "numeric", "instance", "schema", "required",
]);
const INLINE = /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[A-Za-z][A-Za-z0-9_-]*/g;
const NAME = /^(?:"(?:[^"\\]|\\.)*"|[A-Za-z_][A-Za-z0-9_-]*)/;
const QUALIFIER = /^ ?\((?:optional|required|object|optional, object)\)/;

export function highlight(text: string): Token[] {
  const tokens: Token[] = [];
  let lineStart = 0;
  for (const line of text.split("\n")) {
    highlightLine(line, lineStart, tokens);
    lineStart += line.length + 1;
  }
  return tokens;
}

function highlightLine(line: string, base: number, out: Token[]): void {
  const push = (start: number, end: number, cls: TokenClass): void => {
    if (end > start) out.push({ start: base + start, end: base + end, cls });
  };
  if (/^\*\*\*plaintype \d+\*\*\*$/.test(line)) return push(0, line.length, "header");

  const indent = line.length - line.trimStart().length;
  const rest = line.slice(indent);
  if (rest.startsWith("#")) return push(indent, line.length, "comment");
  if (!rest.startsWith("- ")) return inline(line, 0, line.length, push);

  push(indent, indent + 1, "bullet");
  const bodyStart = indent + 2;
  const body = line.slice(bodyStart);

  const directive = DIRECTIVES.find((candidate) => body === candidate);
  if (directive !== undefined) return push(bodyStart, line.length, "keyword");

  const exact = /^(Exact JSON Schema:|Its exact JSON Schema entry is) /.exec(body);
  if (exact) {
    push(bodyStart, bodyStart + exact[0].length, "keyword");
    return push(bodyStart + exact[0].length, line.length, "json");
  }

  const name = NAME.exec(body);
  const afterName = name ? body.slice(name[0].length) : "";
  const qualifier = QUALIFIER.exec(afterName);
  const afterQualifier = qualifier ? afterName.slice(qualifier[0].length) : afterName;
  if (!name || !(afterQualifier.startsWith(":") || afterQualifier.startsWith(","))) {
    return inline(line, bodyStart, line.length, push);
  }

  let cursor = bodyStart;
  push(cursor, cursor + name[0].length, name[0].startsWith('"') ? "string" : "name");
  cursor += name[0].length;
  if (qualifier) {
    push(cursor, cursor + qualifier[0].length, "qualifier");
    cursor += qualifier[0].length;
  }
  push(cursor, cursor + 1, "punct");
  cursor += 1;

  // v2 leaf: "name: description - constraint." — the last unquoted " - " splits them.
  const split = lastUnquotedDash(line, cursor);
  if (split === -1) {
    const union = line.lastIndexOf("Exactly one of:");
    if (union >= cursor) {
      push(cursor, union, "desc");
      return push(union, line.length, "keyword");
    }
    return push(cursor, line.length, "desc");
  }
  push(cursor, split, "desc");
  push(split + 1, split + 2, "punct");
  inline(line, split + 2, line.length, push);
}

function inline(line: string, from: number, to: number, push: (start: number, end: number, cls: TokenClass) => void): void {
  const segment = line.slice(from, to);
  for (const match of segment.matchAll(INLINE)) {
    const word = match[0];
    const start = from + match.index;
    const end = start + word.length;
    if (word.startsWith('"')) push(start, end, "string");
    else if (/^-?\d/.test(word)) push(start, end, "number");
    else if (KEYWORDS.has(word)) push(start, end, "keyword");
    else if (/^[A-Z]/.test(word)) push(start, end, "type");
  }
}

function lastUnquotedDash(line: string, from: number): number {
  let inString = false;
  let found = -1;
  for (let index = from; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\\" && inString) {
      index += 1;
    } else if (char === '"') {
      inString = !inString;
    } else if (!inString && char === " " && line[index + 1] === "-" && line[index + 2] === " ") {
      found = index;
    }
  }
  return found;
}
