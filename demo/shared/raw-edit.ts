/**
 * Map a hand edit of the raw (filled-in) PlainType back onto the state.
 *
 * The raw text is `render(ptTemplate, values)`. An edit is reduced to one
 * changed region (common prefix and suffix). If that region sits inside a
 * single rendered value, it is a value edit and updates the registry, so every
 * pane that shows the slot follows. Otherwise it is a template edit: the same
 * change is applied to the template text, widened to swallow any value it
 * only partly touches. Either way `render` of the new state reproduces the
 * typed text, except where a value edit also changes the slot's other uses.
 */

import { linkNatlang, lookup, placeholderSpans, render, type SlotSpan, type SlotValue, type Values } from "./slots.js";
import type { DemoState } from "./state.js";

export function applyRawEdit(state: DemoState, edited: string): DemoState {
  return applyDisplayedRawEdit(state, edited, state.values) ?? state;
}

/**
 * The same mapping against raw text rendered with `display` values, where a
 * slot whose display differs from its value (a folded long string) is atomic:
 * an edit that touches it is refused (null), since its full text is not shown.
 */
export function applyDisplayedRawEdit(state: DemoState, edited: string, display: Values): DemoState | null {
  const before = render(state.ptTemplate, display);
  const old = before.text;
  if (old === edited) return state;
  const locked = (span: SlotSpan): boolean => lookup(display, span.slot) !== lookup(state.values, span.slot);

  const shortest = Math.min(old.length, edited.length);
  let prefix = 0;
  while (prefix < shortest && old[prefix] === edited[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < shortest - prefix && old[old.length - 1 - suffix] === edited[edited.length - 1 - suffix]) suffix += 1;
  let start = prefix;
  let end = old.length - suffix;
  const inserted = edited.slice(start, edited.length - suffix);

  const host = before.spans.find((span) => span.start <= start && end <= span.end && !separatesFrom(span, start, end, inserted));
  if (host !== undefined && locked(host)) return null;
  if (host !== undefined) {
    const value = edited.slice(host.start, host.end + edited.length - old.length);
    return { ...state, values: { ...state.values, [host.slot]: value } };
  }

  for (const span of before.spans) {
    if (span.start < end && start < span.end) {
      if (locked(span)) return null;
      start = Math.min(start, span.start);
      end = Math.max(end, span.end);
    }
  }
  const replacement = edited.slice(start, edited.length - (old.length - end));
  const placeholders = placeholderSpans(state.ptTemplate).filter(({ slot }) => lookup(state.values, slot) !== undefined);
  const toTemplate = (position: number): number => {
    let shift = 0;
    before.spans.forEach((span, index) => {
      const placeholder = placeholders[index];
      if (placeholder !== undefined && span.end <= position && span.start < position) {
        shift += placeholder.end - placeholder.start - (span.end - span.start);
      }
    });
    return position + shift;
  };
  const ptTemplate = state.ptTemplate.slice(0, toTemplate(start)) + replacement + state.ptTemplate.slice(toTemplate(end));
  return { ...state, ptTemplate };
}

/**
 * Typing whitespace right at the edge of a value ("and 24" -> "and  24")
 * separates new text from it rather than extending it.
 */
function separatesFrom(span: SlotSpan, start: number, end: number, inserted: string): boolean {
  return start === end && (start === span.start || start === span.end) && /\s/.test(inserted);
}

/** The slot occurrences of the current raw text, in order, for re-linking a rewritten document. */
export function rawSlotOrder(state: DemoState): SlotValue[] {
  const raw = render(state.ptTemplate, state.values);
  return raw.spans.map((span) => ({ name: span.slot, value: raw.text.slice(span.start, span.end) }));
}

/** Rebuild a template from rewritten raw PlainType by finding each slot value in it again. */
export function templateFromRaw(raw: string, slots: readonly SlotValue[]): string {
  return linkNatlang(raw, slots).template;
}
