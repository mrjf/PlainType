/**
 * Instance Studio state: a natural-language template, a PlainType data
 * template, and a value registry, with the same shape as the schema studio's
 * state so slot rendering, linking and raw-edit mapping are shared. Every pane
 * derives from it; validation runs against the schema studio's current schema.
 */

import type { FiloDocument } from "@mrjf/filo";
import { stringifyJson, type JsonNode } from "../../src/index.js";
import { foldValue, foldValues, isFoldable } from "./fold.js";
import { formatInstance, parseInstance } from "./instance-notation.js";
import { locate, lookup, render, slotNames, type Rendered, type SlotSpan, type SlotValue, type Values } from "./slots.js";
import { SLOT_TIER, slotDocument, type DemoState, type SlotPayload } from "./state.js";
import type { ValidationIssue, Validator } from "./validate.js";

export const INSTANCE_SEED: DemoState = {
  natTemplate: 'Our checkout button says "{{label}}", has a {{borderColor}} border and priority {{priority}}.',
  ptTemplate: [
    "***plaintype data 1***",
    "",
    "- :Button:",
    '  - label - "{{label}}"',
    '  - borderColor - "{{borderColor}}"',
    "  - priority - {{priority}}",
    "",
  ].join("\n"),
  values: { label: "Buy now", borderColor: "red", priority: "2" },
};

export type ParsedView =
  | {
      readonly ok: true;
      readonly value: JsonNode;
      readonly json: string;
      readonly formatted: string;
      readonly formattedSpans: readonly SlotSpan[];
    }
  | { readonly ok: false; readonly error: string; readonly line: number | null };

export interface InstanceSlotInfo {
  readonly name: string;
  readonly value: string | undefined;
  readonly folded: boolean;
  readonly inNatlang: boolean;
  readonly inInstance: boolean;
  readonly natBytes: { readonly start: number; readonly end: number } | null;
}

export interface InstanceView {
  readonly natlang: Rendered;
  readonly natDoc: FiloDocument;
  /** The filled-in instance with full values: what is parsed and validated. */
  readonly raw: Rendered;
  /** The same text with long strings folded: what the raw editor shows. */
  readonly display: Rendered;
  readonly displayDoc: FiloDocument;
  readonly displayValues: Values;
  readonly parsed: ParsedView;
  /** Null when the instance does not parse or there is no usable schema. */
  readonly issues: readonly ValidationIssue[] | null;
  readonly slots: readonly InstanceSlotInfo[];
}

export interface SchemaContext {
  readonly title: string | null;
  readonly validator: Validator | null;
}

export function deriveInstance(state: DemoState, schema: SchemaContext): InstanceView {
  const displayValues = foldValues(state.values);
  const natlang = render(state.natTemplate, state.values);
  const raw = render(state.ptTemplate, state.values);
  const display = render(state.ptTemplate, displayValues);
  const natDoc = slotDocument(natlang.text, natlang.spans, { words: true });
  const displayDoc = slotDocument(display.text, display.spans);
  const parsed = parse(raw, schema.title);
  const issues = parsed.ok && schema.validator?.ok === true ? schema.validator.validate(JSON.parse(parsed.json)) : null;

  const natSlots = new Set(slotNames(state.natTemplate));
  const instanceSlots = new Set(slotNames(state.ptTemplate));
  const natAnnotations = natDoc.tier<SlotPayload>(SLOT_TIER)?.annotations ?? [];
  const names = [...new Set([...slotNames(state.ptTemplate), ...slotNames(state.natTemplate), ...Object.keys(state.values)])];
  const slots = names.map((name): InstanceSlotInfo => {
    const value = lookup(state.values, name);
    const annotation = natAnnotations.find((candidate) => candidate.payload.slot === name);
    return {
      name,
      value,
      folded: value !== undefined && isFoldable(value),
      inNatlang: natSlots.has(name),
      inInstance: instanceSlots.has(name),
      natBytes: annotation ? { start: annotation.start, end: annotation.end } : null,
    };
  });
  return { natlang, natDoc, raw, display, displayDoc, displayValues, parsed, issues, slots };
}

function parse(raw: Rendered, title: string | null): ParsedView {
  try {
    const { name, value } = parseInstance(raw.text);
    const formatted = formatInstance(value, title ?? name);
    const order = raw.spans.map((span): SlotValue => ({ name: span.slot, value: raw.text.slice(span.start, span.end) }));
    return { ok: true, value, json: `${stringifyJson(value, 2)}\n`, formatted, formattedSpans: locate(formatted, order).spans };
  } catch (error) {
    const line = error instanceof Error && "line" in error && typeof error.line === "number" ? error.line : null;
    return { ok: false, error: error instanceof Error ? error.message : String(error), line };
  }
}

/**
 * Long string literals written directly in the template move into the
 * registry as slots, so every pane can fold them. Names come from the member
 * key (or the list's key and item number), made unique.
 */
export function slotLongStrings(state: DemoState): DemoState {
  const values: Record<string, string> = { ...state.values };
  const taken = new Set([...Object.keys(values), ...slotNames(state.ptTemplate), ...slotNames(state.natTemplate)]);
  const lines = state.ptTemplate.split("\n");
  const keys: string[] = [];
  const rewritten = lines.map((line) => {
    const head = /^( *)- ("(?:[^"\\]|\\.)*"|[A-Za-z_][A-Za-z0-9_-]*|#[0-9]+|:[^:]+:)/.exec(line);
    const depth = (head?.[1]?.length ?? 0) / 2;
    const token = head?.[2] ?? "";
    keys.length = depth;
    keys[depth] = token.startsWith("#") ? `${keys[depth - 1] ?? "item"}${token.slice(1)}` : token.replace(/^"|"$|^:|:$/g, "");
    return line.replace(/"((?:[^"\\]|\\.)*)"/g, (literal, content: string, offset: number) => {
      const isKey = offset === (head?.[1]?.length ?? 0) + 2 && token.startsWith('"');
      if (isKey || content.includes("{{") || !isFoldable(content)) return literal;
      const name = uniqueName(keys[depth] ?? "text", taken);
      taken.add(name);
      values[name] = content;
      return `"{{${name}}}"`;
    });
  });
  const ptTemplate = rewritten.join("\n");
  return ptTemplate === state.ptTemplate ? state : { ...state, ptTemplate, values };
}

function uniqueName(base: string, taken: ReadonlySet<string>): string {
  const words = base.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const camel = words.map((word, index) => (index === 0 ? word.charAt(0).toLowerCase() + word.slice(1) : word.charAt(0).toUpperCase() + word.slice(1))).join("");
  const stem = /^[A-Za-z_]/.test(camel) ? camel : `text${camel}`;
  if (!taken.has(stem)) return stem;
  for (let suffix = 2; ; suffix += 1) if (!taken.has(`${stem}${suffix}`)) return `${stem}${suffix}`;
}

/** Slot occurrences of the displayed (folded) raw text, for re-linking a repaired document. */
export function displaySlotOrder(view: InstanceView): SlotValue[] {
  return view.display.spans.map((span) => ({ name: span.slot, value: view.display.text.slice(span.start, span.end) }));
}

/** Restore full values for slots the model handed back in their folded form. */
export function unfoldReturnedValues(returned: Values, previous: Values): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(returned)) {
    const before = lookup(previous, name);
    result[name] = before !== undefined && isFoldable(before) && foldValue(before) === value ? before : value;
  }
  return result;
}
