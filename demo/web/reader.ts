/**
 * Reader view of a formatted PlainType document: what an app would show,
 * not the source. Headers, section markers, `>` and concept colons are
 * dropped; definitions are bold, comments italic. Slot marks are kept (by
 * mapping each kept character back to its source offset) so hover and
 * registry focus still light up values, but they carry no color at rest.
 */

import type { SlotSpan } from "../shared/slots.js";
import { paint } from "./paint.js";

const CONCEPT_DECLARATION = /^:([A-Za-z0-9+._-]+):(?: |$)/;
const ATTRIBUTE = /^("(?:[^"\\]|\\.)*"|[A-Za-z_][A-Za-z0-9_-]*)( \((?:optional|object|optional, object)\))?( - |: )/;
const INLINE_CONCEPT = /"(?:[^"\\]|\\.)*"|:([A-Za-z0-9+._-]+):/g;

export function renderReader(text: string, spans: readonly SlotSpan[]): string {
  const lines = text.split("\n");
  const frontmatterEnd = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  const rows: string[] = [];
  let offset = 0;

  for (const [index, line] of lines.entries()) {
    const base = offset;
    offset += line.length + 1;
    if (index <= frontmatterEnd || line.trim() === "" || /^\*\*\*[^*]+\*\*\*$/.test(line)) continue;

    /** HTML for line[start, end), with slot marks re-based onto the slice. */
    const piece = (start: number, end: number): string =>
      paint(text.slice(base + start, base + end), { slots: clip(spans, base + start, base + end) });

    const indent = line.length - line.trimStart().length;
    const depth = Math.floor(indent / 2);
    const comment = /^ *> ?/.exec(line);
    if (comment) {
      rows.push(row("comment", depth, piece(comment[0].length, line.length)));
      continue;
    }
    if (!line.startsWith("- ", indent)) {
      rows.push(row("other", depth, piece(indent, line.length)));
      continue;
    }

    const bodyStart = indent + 2;
    const body = line.slice(bodyStart);
    const concept = CONCEPT_DECLARATION.exec(body);
    if (concept) {
      const name = concept[1] ?? "";
      const nameStart = bodyStart + 1;
      const descriptionStart = bodyStart + name.length + 3;
      const description = descriptionStart <= line.length ? `<span class="r-sep"> - </span>${describe(line, descriptionStart, piece)}` : "";
      rows.push(row("definition", depth, `<strong class="r-name">${piece(nameStart, nameStart + name.length)}</strong>${description}`));
      continue;
    }

    const attribute = ATTRIBUTE.exec(body);
    if (attribute) {
      const name = attribute[1] ?? "";
      const qualifier = attribute[2] ?? "";
      const nameEnd = bodyStart + name.length;
      const qualifierHtml = qualifier === "" ? "" : ` <span class="r-qualifier">${piece(nameEnd + 1, nameEnd + qualifier.length)}</span>`;
      const rest = nameEnd + qualifier.length + (attribute[3] ?? "").length;
      rows.push(row(
        "attribute",
        depth,
        `<span class="r-bullet">•</span><span class="r-attr-name">${piece(bodyStart, nameEnd)}</span>${qualifierHtml}<span class="r-sep"> - </span>${describe(line, rest, piece)}`,
      ));
      continue;
    }

    rows.push(row("directive", depth, piece(bodyStart, line.length)));
  }
  return rows.join("");
}

/** Description, a colon, then the constraint with concept colons removed. */
function describe(line: string, start: number, piece: (start: number, end: number) => string): string {
  const split = lastUnquotedDash(line, start);
  if (split === -1) return piece(start, line.length);
  return `${piece(start, split)}<span class="r-sep">: </span><span class="r-constraint">${conceptless(line, split + 3, line.length, piece)}</span>`;
}

function conceptless(line: string, start: number, end: number, piece: (start: number, end: number) => string): string {
  let html = "";
  let cursor = start;
  for (const match of line.slice(start, end).matchAll(INLINE_CONCEPT)) {
    if (match[1] === undefined) continue; // a quoted string: leave it alone
    const at = start + match.index;
    html += `${piece(cursor, at)}<strong class="r-ref">${piece(at + 1, at + 1 + match[1].length)}</strong>`;
    cursor = at + match[0].length;
  }
  return html + piece(cursor, end);
}

function row(kind: string, depth: number, html: string): string {
  return `<div class="r-row r-${kind}" style="--depth:${depth}">${html}</div>`;
}

function clip(spans: readonly SlotSpan[], start: number, end: number): SlotSpan[] {
  return spans
    .filter((span) => span.start < end && start < span.end)
    .map((span) => ({ slot: span.slot, start: Math.max(span.start, start) - start, end: Math.min(span.end, end) - start }));
}

function lastUnquotedDash(line: string, from: number): number {
  let quoted = false;
  let found = -1;
  for (let index = from; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\\" && quoted) index += 1;
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === " " && line[index + 1] === "-" && line[index + 2] === " ") found = index;
  }
  return found;
}
