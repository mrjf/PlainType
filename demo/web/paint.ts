/**
 * Turn text plus two independent layers (syntax tokens and slot spans) into
 * HTML. Boundaries from both layers are merged so every output piece has at
 * most one syntax class and at most one slot.
 */

import type { Token } from "../shared/highlight.js";
import type { SlotSpan } from "../shared/slots.js";

export interface PaintOptions {
  readonly tokens?: readonly Token[];
  readonly slots?: readonly SlotSpan[];
  /** Slots whose spans should be drawn as "placeholder" rather than "value". */
  readonly slotStyle?: "value" | "placeholder";
  /** Slots that have no registry value. */
  readonly missing?: ReadonlySet<string>;
}

export function paint(text: string, options: PaintOptions = {}): string {
  const tokens = options.tokens ?? [];
  const slots = options.slots ?? [];
  const cuts = new Set<number>([0, text.length]);
  for (const range of [...tokens, ...slots]) {
    cuts.add(range.start);
    cuts.add(range.end);
  }
  const points = [...cuts].filter((point) => point >= 0 && point <= text.length).sort((a, b) => a - b);

  let html = "";
  let openSlot: SlotSpan | undefined;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const start = points[index] ?? 0;
    const end = points[index + 1] ?? start;
    if (end === start) continue;
    const slot = slots.find((span) => span.start <= start && end <= span.end);
    if (slot !== openSlot) {
      if (openSlot) html += "</mark>";
      if (slot) html += openMark(slot, options);
      openSlot = slot;
    }
    const token = tokens.find((candidate) => candidate.start <= start && end <= candidate.end);
    const piece = escapeHtml(text.slice(start, end));
    html += token ? `<span class="t-${token.cls}">${piece}</span>` : piece;
  }
  if (openSlot) html += "</mark>";
  // A trailing newline in a textarea needs a visible line in the backdrop.
  return `${html}${text.endsWith("\n") ? " " : ""}`;
}

function openMark(slot: SlotSpan, options: PaintOptions): string {
  const classes = ["slot", options.slotStyle === "placeholder" ? "slot-placeholder" : "slot-value"];
  if (options.missing?.has(slot.slot)) classes.push("slot-missing");
  return `<mark class="${classes.join(" ")}" data-slot="${escapeHtml(slot.slot)}" style="--h:${slotHue(slot.slot)}">`;
}

/** A stable hue per slot name so a slot has the same color in every pane. */
export function slotHue(name: string): number {
  let hash = 2166136261;
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 360;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
