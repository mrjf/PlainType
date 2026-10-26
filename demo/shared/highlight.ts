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
  "Schema clauses:",
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
  for (const [start, end] of inlineRuns(segment)) {
    const word = segment.slice(start, end);
    if (word.startsWith('"')) push(from + start, from + end, "string");
    else if (word.startsWith("[")) push(from + start, from + end, "string");
    else if (word.startsWith(":")) push(from + start, from + end, "concept");
    else if (/^-?\d/.test(word)) push(from + start, from + end, "number");
    else if (KEYWORDS.has(word)) push(from + start, from + end, "keyword");
    else if (/^[A-Z]/.test(word)) push(from + start, from + end, "type");
  }
}

const isDigit = (code: number): boolean => code >= 48 && code <= 57;
const isLetter = (code: number): boolean => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
/** `[A-Za-z0-9_-]`: what continues a word. */
const isWordPart = (code: number): boolean => isLetter(code) || isDigit(code) || code === 95 || code === 45;
/** `[A-Za-z0-9+._-]`: what a concept name is made of. */
const isConceptPart = (code: number): boolean => isLetter(code) || isDigit(code) || code === 43 || code === 46 || code === 95 || code === 45;
/** What `.` does not match in a regular expression: a line terminator. */
const isTerminator = (code: number): boolean => code === 10 || code === 13 || code === 0x2028 || code === 0x2029;

/**
 * `segment.indexOf(char, from)` for `from` that only grows, remembered: what was found stays the nearest `char` until
 * the search passes it, and a search that found none has found none for every later `from`.
 */
function nearest(segment: string, char: string): (from: number) => number {
  let began = -1;
  let found = -1;
  return (from) => {
    if (began < 0 || from < began || (found >= 0 && found < from)) {
      began = from;
      found = segment.indexOf(char, from);
    }
    return found;
  };
}

/**
 * The runs of `segment` the highlighter classifies, as `[start, end)`, left to right: a quoted string with `\` escapes
 * (`"(?:[^"\\]|\\.)*"`), a link `[text](target)`, a concept `:Name:`, a number, a word. Text that opens one and never
 * closes it (a lone `"`, `[`, `:`) opens nothing. A hand scanner, linear in the segment, since a regular expression with
 * these alternatives searches to the end of the line from every opening that fails, which is quadratic on a line of
 * `[` or `"\`: here what a failed opening found is remembered for the openings after it.
 */
function inlineRuns(segment: string): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  const n = segment.length;
  const at = (i: number): number => segment.charCodeAt(i);
  const close = nearest(segment, "]");
  const paren = nearest(segment, ")");
  // A quote that opens no string fails where its scan stopped, `quoteFails`; every quote before that is the second half of
  // an escape in the same scan, and reads the same text from there on, so fails at the same place and is not tried.
  let quoteFails = 0;

  let i = 0;
  while (i < n) {
    const code = at(i);
    let end = -1;
    if (code === 34) {
      if (i >= quoteFails) {
        let j = i + 1;
        let stopped = n;
        while (j < n) {
          const c = at(j);
          if (c === 34) {
            end = j + 1;
            break;
          }
          if (c !== 92) j += 1;
          else if (j + 1 < n && !isTerminator(at(j + 1))) j += 2;
          else {
            stopped = j;
            break;
          }
        }
        if (end < 0) quoteFails = stopped;
      }
    } else if (code === 91) {
      const k = close(i + 1);
      if (k >= 0 && at(k + 1) === 40) {
        const m = paren(k + 2);
        if (m >= 0) end = m + 1;
      }
    } else if (code === 58) {
      let j = i + 1;
      while (j < n && isConceptPart(at(j))) j += 1;
      if (j > i + 1 && at(j) === 58) end = j + 1;
    } else if (code === 45 || isDigit(code)) {
      let j = code === 45 ? i + 1 : i;
      if (isDigit(at(j))) {
        while (isDigit(at(j))) j += 1;
        if (at(j) === 46 && isDigit(at(j + 1))) {
          j += 2;
          while (isDigit(at(j))) j += 1;
        }
        if (at(j) === 101 || at(j) === 69) {
          let k = j + 1;
          if (at(k) === 43 || at(k) === 45) k += 1;
          if (isDigit(at(k))) {
            while (isDigit(at(k))) k += 1;
            j = k;
          }
        }
        end = j;
      }
    } else if (isLetter(code)) {
      let j = i + 1;
      while (j < n && isWordPart(at(j))) j += 1;
      end = j;
    }
    if (end > i) {
      runs.push([i, end]);
      i = end;
    } else i += 1;
  }
  return runs;
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
