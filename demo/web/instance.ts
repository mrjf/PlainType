/**
 * PlainType Instance Studio client: the schema studio's six synced panes,
 * for one JSON record of the schema the Schema tab currently holds.
 *
 * Registry, template, and raw edits re-render synchronously. Natural-language
 * edits go to the model after a pause; raw text that stops parsing is sent to
 * the model to be repaired. Long strings are folded in every view, in the raw
 * editor (where they cannot be edited in place), and in what the model sees.
 */

import {
  ErrorResponseSchema,
  HealResponseSchema,
  HealthSchema,
  TranslateResponseSchema,
  type HealResponse,
  type TranslateResponse,
} from "../shared/api.js";
import { foldedSlots } from "../shared/fold.js";
import { highlightInstance } from "../shared/highlight.js";
import {
  INSTANCE_SEED,
  deriveInstance,
  displaySlotOrder,
  slotLongStrings,
  unfoldReturnedValues,
  type InstanceView,
  type SchemaContext,
} from "../shared/instance-state.js";
import { applyDisplayedRawEdit, templateFromRaw } from "../shared/raw-edit.js";
import { placeholderSpans, slotNames } from "../shared/slots.js";
import { SEED, derive, pruneValues, slotAt, type DemoState } from "../shared/state.js";
import { INSTANCE_STORAGE_KEY, SCHEMA_STORAGE_KEY, loadState, saveState } from "../shared/storage.js";
import { compileValidator } from "../shared/validate.js";
import { foldJsonHtml, renderInstanceReader } from "./instance-reader.js";
import { escapeHtml, paint, slotHue } from "./paint.js";

type Phase =
  | { readonly kind: "synced" }
  | { readonly kind: "typing" }
  | { readonly kind: "thinking" }
  | { readonly kind: "healing" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "offline" };

const DEBOUNCE_MS = 450;
const HEAL_DEBOUNCE_MS = 1200;

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`Missing #${id}`);
  return element;
}

const ui = {
  status: byId("status", HTMLDivElement),
  statusText: byId("status-text", HTMLSpanElement),
  statusMeta: byId("status-meta", HTMLSpanElement),
  retry: byId("retry", HTMLButtonElement),
  revert: byId("revert", HTMLButtonElement),
  reset: byId("reset", HTMLButtonElement),
  nat: byId("nat", HTMLTextAreaElement),
  natBackdrop: byId("nat-backdrop", HTMLPreElement),
  natNotes: byId("nat-notes", HTMLElement),
  template: byId("template", HTMLTextAreaElement),
  templateBackdrop: byId("template-backdrop", HTMLPreElement),
  registry: byId("registry", HTMLTableSectionElement),
  raw: byId("raw", HTMLTextAreaElement),
  rawBackdrop: byId("raw-backdrop", HTMLPreElement),
  rawNotes: byId("raw-notes", HTMLElement),
  formatted: byId("formatted", HTMLDivElement),
  schemaName: byId("schema-name", HTMLSpanElement),
  json: byId("json", HTMLPreElement),
  jsonNotes: byId("json-notes", HTMLElement),
  validBadge: byId("valid-badge", HTMLSpanElement),
};

/** The schema studio's current schema, read once at load. */
const schema = (() => {
  const schemaView = derive(loadState(SCHEMA_STORAGE_KEY) ?? SEED);
  if (!schemaView.compiled.ok) return { plaintype: schemaView.raw.text, json: null, context: { title: null, validator: null } satisfies SchemaContext };
  const parsed: unknown = JSON.parse(schemaView.compiled.json);
  const title = typeof parsed === "object" && parsed !== null && "title" in parsed && typeof parsed.title === "string" ? parsed.title : null;
  return {
    plaintype: schemaView.raw.text,
    json: schemaView.compiled.json,
    context: { title, validator: compileValidator(schemaView.compiled.json) } satisfies SchemaContext,
  };
})();

let state: DemoState = slotLongStrings(loadState(INSTANCE_STORAGE_KEY) ?? INSTANCE_SEED);
let view: InstanceView = deriveInstance(state, schema.context);
let phase: Phase = { kind: "synced" };
let aiAvailable = true;
let model = "";
let lastResult: TranslateResponse | null = null;
let lastHeal: HealResponse | null = null;
let rawNote: string | null = null;
let activeSlot: string | null = null;
let natEdited = false;
let inflight: AbortController | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let healInflight: AbortController | null = null;
let healTimer: ReturnType<typeof setTimeout> | undefined;
const expanded = new Set<string>();

// ---------------------------------------------------------------------------
// Rendering

function renderAll(): void {
  view = deriveInstance(state, schema.context);
  const dirty = isNatDirty();
  if (!dirty && ui.nat.value !== view.natlang.text) ui.nat.value = view.natlang.text;
  if (document.activeElement !== ui.template && ui.template.value !== state.ptTemplate) ui.template.value = state.ptTemplate;
  if (ui.raw.value !== view.display.text) {
    const caret = ui.raw.selectionStart;
    ui.raw.value = view.display.text;
    if (document.activeElement === ui.raw) ui.raw.setSelectionRange(caret, caret);
  }

  ui.natBackdrop.innerHTML = dirty ? paint(ui.nat.value) : paint(view.natlang.text, { slots: view.natlang.spans });
  syncScroll(ui.nat, ui.natBackdrop);
  const linked = view.natDoc.tier("slot")?.annotations.length ?? 0;
  const words = view.natDoc.tier("word")?.annotations.length ?? 0;
  const unmatched = lastResult && !dirty && lastResult.unmatched.length > 0
    ? `<span class="warn">Not found verbatim in the text: ${lastResult.unmatched.map(escapeHtml).join(", ")}</span> · `
    : "";
  ui.natNotes.innerHTML = dirty ? "" : `${unmatched}filo: ${linked} of ${words} words are slot tokens`;

  const templateText = ui.template.value;
  ui.templateBackdrop.innerHTML = paint(templateText, {
    tokens: highlightInstance(templateText),
    slots: placeholderSpans(templateText),
    slotStyle: "placeholder",
    missing: new Set(view.raw.missing),
  });
  syncScroll(ui.template, ui.templateBackdrop);

  const folded = foldedSlots(state.values);
  ui.rawBackdrop.innerHTML = paint(view.display.text, { tokens: highlightInstance(view.display.text), slots: view.display.spans });
  for (const mark of ui.rawBackdrop.querySelectorAll<HTMLElement>("mark[data-slot]")) {
    if (folded.has(mark.dataset["slot"] ?? "")) mark.classList.add("slot-folded");
  }
  syncScroll(ui.raw, ui.rawBackdrop);
  ui.rawNotes.innerHTML = rawNotes();

  renderRegistry();
  renderRecord();
  renderStatus();
  applyActive();
  saveState(INSTANCE_STORAGE_KEY, state);
}

function renderRecord(): void {
  ui.schemaName.textContent = schema.context.title === null ? "No schema compiled on the Schema tab" : `An instance of ${schema.context.title}`;
  const parsed = view.parsed;
  if (!parsed.ok) {
    ui.formatted.innerHTML = `<p class="error-line">${escapeHtml(parsed.error)}</p>`;
    ui.json.textContent = "—";
    ui.validBadge.textContent = parsed.line === null ? "✗ does not parse" : `✗ line ${parsed.line}`;
    ui.validBadge.className = "badge err";
    ui.jsonNotes.innerHTML = "";
    return;
  }
  const issues = view.issues ?? [];
  ui.formatted.innerHTML = renderInstanceReader(parsed.formatted, parsed.formattedSpans, issues, expanded);
  ui.json.innerHTML = foldJsonHtml(parsed.json);
  if (view.issues === null) {
    ui.validBadge.textContent = schema.context.validator?.ok === false ? "schema not usable" : "not validated";
    ui.validBadge.className = "badge";
    ui.jsonNotes.innerHTML = schema.context.validator?.ok === false ? escapeHtml(schema.context.validator.error) : "";
  } else if (issues.length === 0) {
    ui.validBadge.textContent = "✓ valid";
    ui.validBadge.className = "badge ok";
    ui.jsonNotes.innerHTML = "";
  } else {
    ui.validBadge.textContent = `✗ ${issues.length} ${issues.length === 1 ? "issue" : "issues"}`;
    ui.validBadge.className = "badge err";
    ui.jsonNotes.innerHTML = issues.map((issue) => `<span class="warn">${escapeHtml(issue.path || "/")}</span> ${escapeHtml(issue.message)}`).join("<br />");
  }
}

function rawNotes(): string {
  if (rawNote !== null) return `<span class="warn">${escapeHtml(rawNote)}</span>`;
  if (phase.kind === "healing") return "Repairing with the model…";
  if (!view.parsed.ok) {
    return aiAvailable
      ? `<span class="warn">Does not parse.</span> The model will repair it when you pause.`
      : `<span class="warn">Does not parse.</span> Repair needs ANTHROPIC_API_KEY on the server.`;
  }
  if (lastHeal) {
    return lastHeal.compileError === null
      ? `Repaired by ${escapeHtml(lastHeal.model)} in ${lastHeal.ms} ms.`
      : `<span class="warn">The model could not repair it:</span> ${escapeHtml(lastHeal.compileError)}`;
  }
  return foldedSlots(state.values).size > 0 ? "Folded strings (…) are edited in the registry." : "";
}

const registryRows = new Map<string, { input: HTMLInputElement; used: HTMLDivElement }>();

function renderRegistry(): void {
  const locked = isNatDirty() || phase.kind === "thinking";
  const names = view.slots.map((slot) => slot.name);
  if (names.length !== registryRows.size || !names.every((name) => registryRows.has(name))) {
    registryRows.clear();
    ui.registry.replaceChildren(...names.map(buildRow));
  }
  for (const slot of view.slots) {
    const entry = registryRows.get(slot.name);
    if (!entry) continue;
    const value = slot.value ?? "";
    if (document.activeElement !== entry.input && entry.input.value !== value) entry.input.value = value;
    entry.input.disabled = locked;
    entry.input.classList.toggle("empty", value === "");
    entry.input.title = slot.folded ? `${value.length} characters` : "";
    const size = slot.folded ? `<span class="bytes">${value.length} ch</span>` : "";
    const unused = !slot.inNatlang && !slot.inInstance;
    entry.used.innerHTML =
      `<span class="chip ${slot.inNatlang ? "on" : ""}" title="natural language">NL</span>` +
      `<span class="chip ${slot.inInstance ? "on" : ""}" title="instance template">IN</span>${size}` +
      (unused ? `<button type="button" class="unused-remove" data-remove="${escapeHtml(slot.name)}" title="Remove unused slot">×</button>` : "");
  }
}

function buildRow(name: string): HTMLTableRowElement {
  const row = document.createElement("tr");
  row.dataset["slot"] = name;
  row.style.setProperty("--h", String(slotHue(name)));
  const nameCell = document.createElement("td");
  nameCell.innerHTML = `<span class="slot-name"><span class="swatch"></span>${escapeHtml(name)}</span>`;
  const valueCell = document.createElement("td");
  const input = document.createElement("input");
  input.type = "text";
  input.spellcheck = false;
  input.setAttribute("aria-label", `Value for ${name}`);
  input.addEventListener("input", () => setValue(name, input.value));
  input.addEventListener("focus", () => setActive(name));
  input.addEventListener("blur", () => setActive(null));
  valueCell.append(input);
  const usedCell = document.createElement("td");
  const used = document.createElement("div");
  used.className = "used";
  usedCell.append(used);
  row.append(nameCell, valueCell, usedCell);
  registryRows.set(name, { input, used });
  return row;
}

function renderStatus(): void {
  ui.status.dataset["phase"] = phase.kind;
  const dirty = isNatDirty();
  ui.revert.hidden = !dirty;
  ui.retry.hidden = phase.kind !== "error";
  for (const pane of ["pane-template", "pane-registry", "pane-raw", "pane-formatted", "pane-json"]) {
    document.getElementById(pane)?.classList.toggle("stale", dirty);
  }
  ui.template.readOnly = dirty || phase.kind === "thinking";
  ui.raw.readOnly = dirty || phase.kind === "thinking";
  document.body.toggleAttribute("data-busy", phase.kind === "thinking" || phase.kind === "healing");
  const meta = lastResult
    ? `${lastResult.model} · ${lastResult.ms} ms · ${lastResult.attempts} attempt${lastResult.attempts === 1 ? "" : "s"}`
    : model;
  const [text, detail] = {
    synced: ["In sync", meta],
    typing: ["Editing…", ""],
    thinking: [`Asking ${model}…`, ""],
    healing: [`Repairing the instance with ${model}…`, ""],
    error: [phase.kind === "error" ? phase.message : "", ""],
    offline: ["Model off: set ANTHROPIC_API_KEY on the server for natural-language edits and repairs", "registry, template and raw edits still work"],
  }[phase.kind];
  ui.statusText.textContent = text ?? "";
  ui.statusMeta.textContent = detail ?? "";
}

function syncScroll(textarea: HTMLTextAreaElement, backdrop: HTMLElement): void {
  backdrop.scrollTop = textarea.scrollTop;
  backdrop.scrollLeft = textarea.scrollLeft;
}

function isNatDirty(): boolean {
  return natEdited && ui.nat.value !== view.natlang.text;
}

function idle(): Phase {
  return aiAvailable ? { kind: "synced" } : { kind: "offline" };
}

// ---------------------------------------------------------------------------
// Deterministic edits

function setValue(name: string, value: string): void {
  if (isNatDirty()) return;
  state = { ...state, values: { ...state.values, [name]: value } };
  renderAll();
}

function setTemplate(text: string): void {
  const values: Record<string, string> = { ...state.values };
  for (const name of slotNames(text)) if (!Object.hasOwn(values, name)) values[name] = "";
  state = { ...state, ptTemplate: text, values };
  renderAll();
}

/**
 * Long literals move into the registry (and fold) when the person leaves the
 * template or raw pane, not while they type, so a string can be typed past
 * the fold length without locking halfway.
 */
function commitLongStrings(): void {
  const next = slotLongStrings(state);
  if (next === state) return;
  state = next;
  renderAll();
}

function onRawInput(): void {
  cancelHeal();
  const next = applyDisplayedRawEdit(state, ui.raw.value, view.displayValues);
  rawNote = next === null ? "That text is folded; edit the full string in the value registry." : null;
  if (next !== null) state = next;
  lastHeal = null;
  if (phase.kind === "healing" || phase.kind === "error") phase = idle();
  renderAll();
  if (!view.parsed.ok && aiAvailable) healTimer = setTimeout(() => void heal(), HEAL_DEBOUNCE_MS);
}

function cancelHeal(): void {
  clearTimeout(healTimer);
  healInflight?.abort();
  healInflight = null;
}

// ---------------------------------------------------------------------------
// Model requests

async function heal(): Promise<void> {
  const raw = ui.raw.value;
  const parsed = view.parsed;
  if (parsed.ok) return;
  const controller = new AbortController();
  healInflight = controller;
  phase = { kind: "healing" };
  renderAll();
  try {
    const response = await fetch("/api/instance/heal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw, error: parsed.error }),
      signal: controller.signal,
    });
    const body: unknown = await response.json();
    if (healInflight !== controller || ui.raw.value !== raw) return;
    if (!response.ok) {
      phase = failure(response.status, body);
      return;
    }
    const result = HealResponseSchema.parse(body);
    lastHeal = result;
    // The model saw folded strings; finding them again restores the full values.
    if (result.compileError === null) state = { ...state, ptTemplate: templateFromRaw(result.raw, displaySlotOrder(view)) };
    phase = { kind: "synced" };
  } catch (error) {
    if (controller.signal.aborted) return;
    phase = { kind: "error", message: error instanceof Error ? error.message : "Request failed" };
  } finally {
    if (healInflight === controller) {
      healInflight = null;
      renderAll();
    }
  }
}

function onNatInput(): void {
  natEdited = true;
  cancelHeal();
  clearTimeout(debounceTimer);
  inflight?.abort();
  inflight = null;
  if (!isNatDirty() || !aiAvailable) {
    phase = idle();
    renderAll();
    return;
  }
  phase = { kind: "typing" };
  renderAll();
  debounceTimer = setTimeout(() => void translate(), DEBOUNCE_MS);
}

async function translate(): Promise<void> {
  const natlang = ui.nat.value;
  if (natlang.trim() === "" || schema.json === null) return;
  const controller = new AbortController();
  inflight = controller;
  phase = { kind: "thinking" };
  renderAll();
  try {
    const response = await fetch("/api/instance/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ natlang, previous: state, schema: { plaintype: schema.plaintype, json: schema.json, title: schema.context.title } }),
      signal: controller.signal,
    });
    const body: unknown = await response.json();
    if (inflight !== controller || ui.nat.value !== natlang) return;
    if (!response.ok) {
      phase = failure(response.status, body);
      return;
    }
    const result = TranslateResponseSchema.parse(body);
    lastResult = result;
    state = slotLongStrings(pruneValues({ ...result.state, values: unfoldReturnedValues(result.state.values, state.values) }));
    natEdited = false;
    phase = { kind: "synced" };
  } catch (error) {
    if (controller.signal.aborted) return;
    phase = { kind: "error", message: error instanceof Error ? error.message : "Request failed" };
  } finally {
    if (inflight === controller) {
      inflight = null;
      renderAll();
    }
  }
}

function failure(status: number, body: unknown): Phase {
  if (status === 503) aiAvailable = false;
  const error = ErrorResponseSchema.safeParse(body);
  return { kind: "error", message: error.success ? error.data.message ?? error.data.error : `HTTP ${status}` };
}

// ---------------------------------------------------------------------------
// Cross-pane slot highlighting

function setActive(slot: string | null): void {
  if (slot === activeSlot) return;
  activeSlot = slot;
  applyActive();
}

function applyActive(): void {
  document.body.classList.toggle("has-active", activeSlot !== null);
  for (const element of document.querySelectorAll<HTMLElement>("[data-slot]")) {
    element.classList.toggle("active", element.dataset["slot"] === activeSlot);
  }
}

function slotUnderPointer(event: MouseEvent): string | null {
  for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
    if (element instanceof HTMLElement && element.dataset["slot"] !== undefined) return element.dataset["slot"];
  }
  return null;
}

function slotAtCaret(textarea: HTMLTextAreaElement): string | null {
  const caret = textarea.selectionStart;
  if (textarea === ui.nat) return isNatDirty() ? null : slotAt(view.natDoc, caret);
  if (textarea === ui.raw) return slotAt(view.displayDoc, caret);
  return placeholderSpans(textarea.value).find((span) => span.start <= caret && caret <= span.end)?.slot ?? null;
}

// ---------------------------------------------------------------------------
// Wiring

ui.nat.addEventListener("input", onNatInput);
ui.template.addEventListener("input", () => setTemplate(ui.template.value));
ui.raw.addEventListener("input", onRawInput);
ui.template.addEventListener("blur", commitLongStrings);
ui.raw.addEventListener("blur", commitLongStrings);
for (const [textarea, backdrop] of [[ui.nat, ui.natBackdrop], [ui.template, ui.templateBackdrop], [ui.raw, ui.rawBackdrop]] as const) {
  textarea.addEventListener("scroll", () => syncScroll(textarea, backdrop));
  textarea.addEventListener("mousemove", (event) => setActive(slotUnderPointer(event) ?? (document.activeElement === textarea ? slotAtCaret(textarea) : null)));
  textarea.addEventListener("mouseleave", () => setActive(document.activeElement === textarea ? slotAtCaret(textarea) : null));
  for (const type of ["keyup", "click", "focus"] as const) textarea.addEventListener(type, () => setActive(slotAtCaret(textarea)));
  textarea.addEventListener("blur", () => setActive(null));
}
for (const pane of [ui.formatted, ui.registry]) {
  pane.addEventListener("mouseover", (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-slot]") : null;
    if (target) setActive(target.dataset["slot"] ?? null);
  });
  pane.addEventListener("mouseleave", () => {
    if (!(document.activeElement instanceof HTMLInputElement)) setActive(null);
  });
}
ui.formatted.addEventListener("click", (event) => {
  const fold = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-fold]") : null;
  const pointer = fold?.dataset["fold"];
  if (pointer === undefined) return;
  if (expanded.has(pointer)) expanded.delete(pointer);
  else expanded.add(pointer);
  renderRecord();
  applyActive();
});
ui.registry.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-remove]") : null;
  const name = button?.dataset["remove"];
  if (name === undefined) return;
  const values: Record<string, string> = { ...state.values };
  delete values[name];
  state = { ...state, values };
  renderAll();
});
ui.retry.addEventListener("click", () => void (isNatDirty() ? translate() : heal()));
ui.revert.addEventListener("click", () => {
  clearTimeout(debounceTimer);
  inflight?.abort();
  inflight = null;
  natEdited = false;
  ui.nat.value = view.natlang.text;
  phase = idle();
  renderAll();
});
ui.reset.addEventListener("click", () => {
  inflight?.abort();
  inflight = null;
  cancelHeal();
  state = INSTANCE_SEED;
  lastResult = null;
  lastHeal = null;
  rawNote = null;
  natEdited = false;
  expanded.clear();
  ui.template.value = state.ptTemplate;
  phase = idle();
  renderAll();
});

async function checkHealth(): Promise<void> {
  try {
    const health = HealthSchema.parse(await (await fetch("/api/health")).json());
    aiAvailable = health.ai;
    model = health.model;
  } catch {
    aiAvailable = false;
  }
  if (phase.kind === "synced" && !aiAvailable) phase = { kind: "offline" };
  renderAll();
}

ui.template.value = state.ptTemplate;
renderAll();
void checkHealth();
