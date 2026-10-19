/**
 * Reader view of a formatted PlainType data instance: a record as an app
 * would show it. The header is dropped, the concept label is a bold title,
 * strings lose their quotes, long strings fold behind an ellipsis that can be
 * expanded, and members that fail validation are flagged. Slot marks are
 * kept (re-based from source offsets) so hover and registry focus still work.
 */

import type { SlotSpan } from "../shared/slots.js";
import { FOLD_AT, foldValue } from "../shared/fold.js";
import type { ValidationIssue } from "../shared/validate.js";
import { escapeHtml, paint } from "./paint.js";

const HEAD = /^(:([A-Za-z0-9+._-]+):|#([0-9]+)|"((?:[^"\\]|\\.)*)"|([A-Za-z_][A-Za-z0-9_-]*))/;

export function renderInstanceReader(
  text: string,
  spans: readonly SlotSpan[],
  issues: readonly ValidationIssue[],
  expanded: ReadonlySet<string>,
): string {
  const rows: string[] = [];
  const path: string[] = [];
  const issuesAt = new Map<string, string[]>();
  for (const issue of issues) issuesAt.set(issue.path, [...(issuesAt.get(issue.path) ?? []), issue.message]);
  let offset = 0;

  for (const line of text.split("\n")) {
    const base = offset;
    offset += line.length + 1;
    const indent = line.length - line.trimStart().length;
    if (!line.startsWith("- ", indent)) continue; // header, blank, comment
    const piece = (start: number, end: number): string =>
      paint(text.slice(base + start, base + end), { slots: clip(spans, base + start, base + end) });

    const depth = indent / 2;
    const bodyStart = indent + 2;
    const head = HEAD.exec(line.slice(bodyStart));
    if (head === null) continue;
    const headEnd = bodyStart + head[0].length;
    const inline = line.startsWith(" - ", headEnd) ? headEnd + 3 : null;

    if (head[2] !== undefined) {
      path.length = 0;
      const value = inline === null ? "" : ` <span class="i-val">${valueHtml(line, inline, piece, "", expanded)}</span>`;
      rows.push(`<div class="i-row i-title"><strong>${escapeHtml(head[2])}</strong>${value}</div>`);
      rows.push(issueRow("", issuesAt, 0));
      continue;
    }

    const token = head[3] ?? unescapeKey(head[4]) ?? head[5] ?? "";
    path.length = depth - 1;
    path[depth - 1] = head[3] !== undefined ? String(Number(head[3]) - 1) : token;
    const pointer = `/${path.map(escapePointer).join("/")}`;
    const label = head[3] !== undefined ? `${head[3]}.` : escapeHtml(token);
    const value = inline === null ? "" : valueHtml(line, inline, piece, pointer, expanded);
    const invalid = issuesAt.has(pointer);
    rows.push(
      `<div class="i-row${invalid ? " i-invalid" : ""}" style="--depth:${depth - 1}" data-path="${escapeHtml(pointer)}">` +
        `<span class="i-key">${label}</span><span class="i-val">${value}</span></div>`,
    );
    rows.push(issueRow(pointer, issuesAt, depth - 1));
  }
  return rows.join("");
}

function issueRow(pointer: string, issuesAt: ReadonlyMap<string, readonly string[]>, depth: number): string {
  const messages = issuesAt.get(pointer);
  if (messages === undefined) return "";
  return `<div class="i-issue" style="--depth:${depth}">${messages.map(escapeHtml).join("; ")}</div>`;
}

/** A JSON value from line[start…]: strings unquoted and folded when long, everything else as written. */
function valueHtml(
  line: string,
  start: number,
  piece: (start: number, end: number) => string,
  pointer: string,
  expanded: ReadonlySet<string>,
): string {
  const string = /^"((?:[^"\\]|\\.)*)"$/.exec(line.slice(start));
  if (string === null) return `<span class="i-literal">${piece(start, line.length)}</span>`;
  const content = string[1] ?? "";
  const contentStart = start + 1;
  if (content.length <= FOLD_AT) return piece(contentStart, contentStart + content.length);
  if (expanded.has(pointer)) {
    return `${piece(contentStart, contentStart + content.length)} <button type="button" class="i-fold" data-fold="${escapeHtml(pointer)}">less</button>`;
  }
  const shown = foldValue(content).slice(0, -1).length;
  return `${piece(contentStart, contentStart + shown)}<button type="button" class="i-fold" data-fold="${escapeHtml(pointer)}" title="Show all ${content.length} characters">…</button>`;
}

function unescapeKey(json: string | undefined): string | undefined {
  if (json === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(`"${json}"`);
    return typeof value === "string" ? value : json;
  } catch {
    return json;
  }
}

function escapePointer(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}

function clip(spans: readonly SlotSpan[], start: number, end: number): SlotSpan[] {
  return spans
    .filter((span) => span.start < end && start < span.end)
    .map((span) => ({ slot: span.slot, start: Math.max(span.start, start) - start, end: Math.min(span.end, end) - start }));
}

/** JSON text with long string literals folded (display only). */
export function foldJsonHtml(json: string): string {
  let html = "";
  let last = 0;
  for (const match of json.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    const content = match[1] ?? "";
    if (content.length <= FOLD_AT) continue;
    html += escapeHtml(json.slice(last, match.index));
    html += `<span class="i-folded" title="${content.length} characters">"${escapeHtml(foldValue(content))}"</span>`;
    last = match.index + match[0].length;
  }
  return html + escapeHtml(json.slice(last));
}
