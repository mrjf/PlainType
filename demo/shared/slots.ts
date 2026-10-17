/**
 * Slot templating: `{{name}}` placeholders, deterministic rendering, and
 * linking a value registry back onto free-form natural-language text.
 *
 * Everything here is pure and synchronous so the browser can re-render every
 * pane on each keystroke in the value registry without a server round trip.
 */

export type Values = Readonly<Record<string, string>>;

/** A half-open string-index range of rendered text produced by one slot. */
export interface SlotSpan {
  readonly slot: string;
  readonly start: number;
  readonly end: number;
}

export interface Rendered {
  readonly text: string;
  readonly spans: readonly SlotSpan[];
  /** Slots referenced by the template that have no registry value. */
  readonly missing: readonly string[];
}

export interface SlotValue {
  readonly name: string;
  readonly value: string;
}

export interface LinkResult {
  /** The natural-language text with each linked occurrence replaced by `{{name}}`. */
  readonly template: string;
  readonly spans: readonly SlotSpan[];
  /** Slots whose value does not occur (as a whole token) in the text. */
  readonly unmatched: readonly string[];
}

export const SLOT_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const SLOT_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g;
const WORD_CHAR = /[\p{L}\p{N}_]/u;

export function lookup(values: Values, name: string): string | undefined {
  return Object.hasOwn(values, name) ? values[name] : undefined;
}

/** Unique slot names in order of first appearance. */
export function slotNames(template: string): string[] {
  const seen = new Set<string>();
  for (const match of template.matchAll(SLOT_PATTERN)) {
    if (match[1] !== undefined) seen.add(match[1]);
  }
  return [...seen];
}

/** Placeholder ranges within the template text itself. */
export function placeholderSpans(template: string): SlotSpan[] {
  const spans: SlotSpan[] = [];
  for (const match of template.matchAll(SLOT_PATTERN)) {
    if (match[1] === undefined) continue;
    spans.push({ slot: match[1], start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

/** Substitute registry values into a template, recording where each value landed. */
export function render(template: string, values: Values): Rendered {
  let text = "";
  let last = 0;
  const spans: SlotSpan[] = [];
  const missing = new Set<string>();
  for (const match of template.matchAll(SLOT_PATTERN)) {
    const name = match[1];
    if (name === undefined) continue;
    text += template.slice(last, match.index);
    last = match.index + match[0].length;
    const value = lookup(values, name);
    if (value === undefined) {
      missing.add(name);
      text += match[0];
      continue;
    }
    const start = text.length;
    text += value;
    spans.push({ slot: name, start, end: text.length });
  }
  text += template.slice(last);
  return { text, spans, missing: [...missing] };
}

/**
 * Find each slot value in `text` and claim one occurrence for it.
 *
 * Slots are matched in the order given; each search starts just after the
 * previous match and falls back to the beginning, so repeated values (two
 * `0`s, say) are assigned left to right. Values that start or end with a word
 * character only match at word boundaries, so `1` never matches inside `12`.
 */
export function locate(text: string, slots: readonly SlotValue[]): { spans: SlotSpan[]; unmatched: string[] } {
  const claimed: SlotSpan[] = [];
  const unmatched: string[] = [];
  let cursor = 0;
  for (const { name, value } of slots) {
    const start = value === ""
      ? undefined
      : findFree(text, value, cursor, claimed) ?? findFree(text, value, 0, claimed);
    if (start === undefined) {
      unmatched.push(name);
      continue;
    }
    claimed.push({ slot: name, start, end: start + value.length });
    cursor = start + value.length;
  }
  claimed.sort((left, right) => left.start - right.start);
  return { spans: claimed, unmatched };
}

/** Turn natural-language text plus slot values into a natural-language template. */
export function linkNatlang(natlang: string, slots: readonly SlotValue[]): LinkResult {
  const { spans, unmatched } = locate(natlang, slots);
  let template = "";
  let last = 0;
  for (const span of spans) {
    template += `${natlang.slice(last, span.start)}{{${span.slot}}}`;
    last = span.end;
  }
  template += natlang.slice(last);
  return { template, spans, unmatched };
}

function findFree(text: string, value: string, from: number, claimed: readonly SlotSpan[]): number | undefined {
  for (let index = text.indexOf(value, from); index !== -1; index = text.indexOf(value, index + 1)) {
    const end = index + value.length;
    if (!atBoundary(text, index, end, value)) continue;
    if (claimed.some((span) => index < span.end && span.start < end)) continue;
    return index;
  }
  return undefined;
}

function atBoundary(text: string, start: number, end: number, value: string): boolean {
  const first = value.at(0) ?? "";
  const last = value.at(-1) ?? "";
  if (WORD_CHAR.test(first) && WORD_CHAR.test(text.charAt(start - 1))) return false;
  if (WORD_CHAR.test(last) && WORD_CHAR.test(text.charAt(end))) return false;
  return true;
}
