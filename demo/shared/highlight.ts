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
  | "json"
  | "concept"
  | "meta";

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
  "Defaults", "For", "example", "true", "false",
  "Sensitive", "number", "numbers", "integers", "boolean", "booleans", "matching", "URL", "date-time", "dates",
]);
const CONCEPT = /^:[A-Za-z0-9+._-]+:/;
const INLINE = /"(?:[^"\\]|\\.)*"|\[[^\]]*\]\([^)]*\)|:[A-Za-z0-9+._-]+:|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[A-Za-z][A-Za-z0-9_-]*/g;
const NAME = /^(?:"(?:[^"\\]|\\.)*"|[A-Za-z_][A-Za-z0-9_-]*)/;
const QUALIFIER = /^ ?\((?:optional|required|object|optional, object)\)/;
const EXACT_PROPERTY = /^ Exact JSON Schema: /;

export function highlight(text: string): Token[] {
  const tokens: Token[] = [];
  const lines = text.split("\n");
  // Version-3 modules may open with YAML frontmatter between `---` fences.
  const frontmatterEnd = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  let lineStart = 0;
  for (const [index, line] of lines.entries()) {
    if (index <= frontmatterEnd) {
      if (line !== "") tokens.push({ start: lineStart, end: lineStart + line.length, cls: "meta" });
    } else {
      highlightLine(line, lineStart, tokens);
    }
    lineStart += line.length + 1;
  }
  return tokens;
}

function highlightLine(line: string, base: number, out: Token[]): void {
  const push = (start: number, end: number, cls: TokenClass): void => {
    if (end > start) out.push({ start: base + start, end: base + end, cls });
  };
  if (/^\*\*\*[a-z0-9 ]+\*\*\*$/.test(line)) return push(0, line.length, "header");

  const indent = line.length - line.trimStart().length;
  const rest = line.slice(indent);
  if (rest.startsWith("#") || rest.startsWith(">")) return push(indent, line.length, "comment");
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

  // v3 concept declaration: ":Name: description"
  const concept = CONCEPT.exec(body);
  if (concept) {
    push(bodyStart, bodyStart + concept[0].length, "concept");
    return describe(line, bodyStart + concept[0].length, push);
  }

  const name = NAME.exec(body);
  const afterName = name ? body.slice(name[0].length) : "";
  const qualifier = QUALIFIER.exec(afterName);
  const afterQualifier = qualifier ? afterName.slice(qualifier[0].length) : afterName;
  // v2 separates name and description with ":"; v3 attributes use " - ".
  const separator = afterQualifier.startsWith(" - ") ? 2 : afterQualifier.startsWith(":") || afterQualifier.startsWith(",") ? 1 : 0;
  if (!name || separator === 0) {
    return inline(line, bodyStart, line.length, push);
  }

  let cursor = bodyStart;
  push(cursor, cursor + name[0].length, name[0].startsWith('"') ? "string" : "name");
  cursor += name[0].length;
  if (qualifier) {
    push(cursor, cursor + qualifier[0].length, "qualifier");
    cursor += qualifier[0].length;
  }
  push(separator === 2 ? cursor + 1 : cursor, cursor + separator, "punct");
  cursor += separator;
  // v3 property-level escape: "name (optional) - Exact JSON Schema: {…}".
  const exactProperty = separator === 2 ? EXACT_PROPERTY.exec(line.slice(cursor)) : null;
  if (exactProperty) {
    push(cursor + 1, cursor + exactProperty[0].length, "keyword");
    return push(cursor + exactProperty[0].length, line.length, "json");
  }
  describe(line, cursor, push);
}

/** Description, then (for leaves) the last unquoted " - " and the constraint. */
function describe(line: string, cursor: number, push: (start: number, end: number, cls: TokenClass) => void): void {
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
    else if (word.startsWith("[")) push(start, end, "string");
    else if (word.startsWith(":")) push(start, end, "concept");
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

/** PlainType data notation: header, comments, concept label, member keys, #n items, and JSON values. */
export function highlightInstance(text: string): Token[] {
  const tokens: Token[] = [];
  let lineStart = 0;
  for (const line of text.split("\n")) {
    const push = (start: number, end: number, cls: TokenClass): void => {
      if (end > start) tokens.push({ start: lineStart + start, end: lineStart + end, cls });
    };
    const indent = line.length - line.trimStart().length;
    if (/^\*\*\*[a-z0-9 ]+\*\*\*$/.test(line)) push(0, line.length, "header");
    else if (line.startsWith(">", indent)) push(indent, line.length, "comment");
    else if (line.startsWith("- ", indent)) {
      push(indent, indent + 1, "bullet");
      const body = line.slice(indent + 2);
      const head = /^(:[A-Za-z0-9+._-]+:|#[0-9]+|"(?:[^"\\]|\\.)*"|[A-Za-z_][A-Za-z0-9_-]*)/.exec(body);
      const headEnd = indent + 2 + (head?.[0].length ?? 0);
      if (head) push(indent + 2, headEnd, head[0].startsWith(":") ? "concept" : head[0].startsWith("#") ? "qualifier" : "name");
      if (line.startsWith(" - ", headEnd)) {
        push(headEnd + 1, headEnd + 2, "punct");
        inline(line, headEnd + 3, line.length, push);
      }
    }
    lineStart += line.length + 1;
  }
  return tokens;
}
