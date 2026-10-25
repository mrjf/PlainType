/**
 * The demo's single source of truth and everything derived from it.
 *
 * State is three things: a natural-language template, a PlainType template,
 * and a value registry. Every pane is a pure function of that state, so a
 * registry edit re-renders all panes deterministically. Only a free-form edit
 * to the natural-language text needs the model, which produces a new state.
 */

import { FiloDocument, annotateWords } from "@mrjf/filo";
import { formatPlainType, toJsonSchema } from "../../src/index.js";
import {
  linkNatlang,
  locate,
  lookup,
  render,
  slotNames,
  type Rendered,
  type SlotSpan,
  type SlotValue,
  type Values,
} from "./slots.js";

export interface DemoState {
  readonly natTemplate: string;
  readonly ptTemplate: string;
  readonly values: Values;
}

export const SLOT_TIER = "slot";

export interface SlotPayload {
  readonly slot: string;
  readonly value: string;
}

export type Compiled =
  | { readonly ok: true; readonly json: string; readonly formatted: string; readonly formattedSpans: readonly SlotSpan[] }
  | { readonly ok: false; readonly error: string; readonly line: number | null };

export interface SlotInfo {
  readonly name: string;
  readonly value: string | undefined;
  readonly inNatlang: boolean;
  readonly inPlainType: boolean;
  /** UTF-8 byte range of the linked natural-language token, from filo. */
  readonly natBytes: { readonly start: number; readonly end: number } | null;
}

export interface DerivedView {
  readonly natlang: Rendered;
  readonly raw: Rendered;
  readonly natDoc: FiloDocument;
  readonly rawDoc: FiloDocument;
  readonly compiled: Compiled;
  readonly slots: readonly SlotInfo[];
}

export const SEED: DemoState = {
  natTemplate:
    "{{draftNote}}\n\n" +
    "A {{typeName}} is a clickable control. Its label is between {{labelMin}} and {{labelMax}} characters long, " +
    "its border is always {{borderColor}}, and it may have a corner radius between {{radiusMin}} and {{radiusMax}} pixels. " +
    "It has a priority level between {{priorityMin}} and {{priorityMax}} e.g. {{priorityExample}}",
  ptTemplate: [
    "***plaintype***",
    "",
    "***definitions***",
    "",
    "> {{draftNote}}",
    "- :{{typeName}}: A clickable control.",
    "  - label - The text shown on the control - a string between {{labelMin}} and {{labelMax}} characters.",
    '  - borderColor - The color of its border - "{{borderColor}}".',
    "  - cornerRadius (optional) - The corner radius in pixels - an integer between {{radiusMin}} and {{radiusMax}}.",
    "  - priority - The priority level - an integer between {{priorityMin}} and {{priorityMax}}. For example: {{priorityExample}}.",
    "",
  ].join("\n"),
  values: {
    draftNote: "This is a rough draft.",
    typeName: "Button",
    labelMin: "1",
    labelMax: "24",
    borderColor: "red",
    radiusMin: "0",
    radiusMax: "32",
    priorityMin: "1",
    priorityMax: "5",
    priorityExample: "2",
  },
};

/** Build a filo document whose `slot` tier marks every rendered slot value. */
export function slotDocument(text: string, spans: readonly SlotSpan[], options: { words?: boolean } = {}): FiloDocument {
  const doc = FiloDocument.fromText(text);
  if (options.words === true) annotateWords(doc);
  doc.defineTier<SlotPayload>({ id: SLOT_TIER, kind: "slot", description: "Template slot values", source: "plaintype-demo" });
  for (const span of spans) {
    doc.addAnnotation<SlotPayload>(SLOT_TIER, {
      ...doc.byteRangeForStringIndices(span.start, span.end),
      payload: { slot: span.slot, value: text.slice(span.start, span.end) },
    });
  }
  return doc;
}

/** The slot (if any) at a string index of a filo slot document. */
export function slotAt(doc: FiloDocument, stringIndex: number): string | null {
  const index = Math.max(0, Math.min(stringIndex, doc.text.length));
  let offset: number;
  try {
    offset = doc.byteOffsetForStringIndex(index);
  } catch {
    return null; // inside a surrogate pair
  }
  const hit = doc.annotationsAt(offset, { tierIds: [SLOT_TIER] })[0]
    ?? (offset > 0 ? doc.annotationsAt(offset - 1, { tierIds: [SLOT_TIER] })[0] : undefined);
  const payload = hit?.payload;
  return isSlotPayload(payload) ? payload.slot : null;
}

export function compile(raw: Rendered): Compiled {
  try {
    const json = toJsonSchema(raw.text);
    const formatted = formatPlainType(raw.text);
    const order = raw.spans.map((span): SlotValue => ({ name: span.slot, value: raw.text.slice(span.start, span.end) }));
    return { ok: true, json, formatted, formattedSpans: locate(formatted, order).spans };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const line = error instanceof Error && "line" in error && typeof error.line === "number" ? error.line : null;
    return { ok: false, error: message, line };
  }
}

export function derive(state: DemoState): DerivedView {
  const natlang = render(state.natTemplate, state.values);
  const raw = render(state.ptTemplate, state.values);
  const natDoc = slotDocument(natlang.text, natlang.spans, { words: true });
  const rawDoc = slotDocument(raw.text, raw.spans);
  const natSlots = new Set(slotNames(state.natTemplate));
  const ptSlots = new Set(slotNames(state.ptTemplate));
  const names = [...new Set([...slotNames(state.ptTemplate), ...slotNames(state.natTemplate), ...Object.keys(state.values)])];
  const natAnnotations = natDoc.tier<SlotPayload>(SLOT_TIER)?.annotations ?? [];
  const slots = names.map((name): SlotInfo => {
    const annotation = natAnnotations.find((candidate) => candidate.payload.slot === name);
    return {
      name,
      value: lookup(state.values, name),
      inNatlang: natSlots.has(name),
      inPlainType: ptSlots.has(name),
      natBytes: annotation ? { start: annotation.start, end: annotation.end } : null,
    };
  });
  return { natlang, raw, natDoc, rawDoc, compiled: compile(raw), slots };
}

/**
 * Assemble a state from model output. The natural-language template is built
 * here, not by the model, so rendering it always reproduces `natlang` exactly.
 */
export function stateFromSlots(natlang: string, ptTemplate: string, slots: readonly SlotValue[]): { state: DemoState; unmatched: readonly string[] } {
  const link = linkNatlang(natlang, slots);
  const values: Record<string, string> = {};
  for (const slot of slots) values[slot.name] = slot.value;
  return { state: { natTemplate: link.template, ptTemplate, values }, unmatched: link.unmatched };
}

/** Drop registry entries no template uses any more. */
export function pruneValues(state: DemoState): DemoState {
  const used = new Set([...slotNames(state.natTemplate), ...slotNames(state.ptTemplate)]);
  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(state.values)) if (used.has(name)) values[name] = value;
  return { ...state, values };
}

function isSlotPayload(value: unknown): value is SlotPayload {
  return typeof value === "object" && value !== null && "slot" in value && typeof value.slot === "string";
}
