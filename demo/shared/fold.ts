/**
 * Long strings are folded wherever they are shown or sent to the model:
 * the first part of the text and an ellipsis. Folding is display only; the
 * registry keeps the full value.
 */

import type { Values } from "./slots.js";

/** Strings longer than this many characters (of JSON string content) fold. */
export const FOLD_AT = 48;
const KEEP = 32;

export function isFoldable(value: string): boolean {
  return value.length > FOLD_AT;
}

/** The folded form of a long value; short values are returned unchanged. */
export function foldValue(value: string): string {
  if (!isFoldable(value)) return value;
  // Advance whole units (a JSON escape such as \" or \u00e9, or a surrogate pair) so the cut never splits one.
  let cut = 0;
  while (cut < value.length) {
    const code = value.charCodeAt(cut);
    const step = value[cut] === "\\" ? (value[cut + 1] === "u" ? 6 : 2) : code >= 0xd800 && code <= 0xdbff ? 2 : 1;
    if (cut + step > KEEP) break;
    cut += step;
  }
  return `${value.slice(0, cut).trimEnd()}…`;
}

export function foldValues(values: Values): Values {
  const folded: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) folded[name] = foldValue(value);
  return folded;
}

/** Slots whose shown text differs from their value, so they cannot be edited in place. */
export function foldedSlots(values: Values): Set<string> {
  return new Set(Object.entries(values).filter(([, value]) => isFoldable(value)).map(([name]) => name));
}
