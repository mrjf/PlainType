/**
 * PlainType Studio client.
 *
 * All panes are pure renders of `state`. Registry and template edits update
 * `state` directly and re-render synchronously. Free-form natural-language
 * edits mark the text dirty and, after a short pause, ask the server (and the
 * model behind it) for a new state; only the newest answer is ever applied.
 */

import { ErrorResponseSchema, HealthSchema, DemoStateSchema, TranslateResponseSchema, type TranslateResponse } from "../shared/api.js";
import { highlight } from "../shared/highlight.js";
import { placeholderSpans, slotNames } from "../shared/slots.js";
import { SEED, derive, pruneValues, slotAt, type DemoState, type DerivedView } from "../shared/state.js";
import { escapeHtml, paint, slotHue } from "./paint.js";

type Phase =
  | { readonly kind: "synced" }
  | { readonly kind: "typing" }
  | { readonly kind: "thinking" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "offline" };

const STORAGE_KEY = "plaintype-studio-state-v1";
const DEBOUNCE_MS = 450;

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
  natPane: byId("pane-nat", HTMLElement),
  template: byId("template", HTMLTextAreaElement),
  templateBackdrop: byId("template-backdrop", HTMLPreElement),
  registry: byId("registry", HTMLTableSectionElement),
  raw: byId("raw", HTMLPreElement),
  formatted: byId("formatted", HTMLPreElement),
  json: byId("json", HTMLPreElement),
  compileBadge: byId("compile-badge", HTMLSpanElement),
};

let state: DemoState = loadState() ?? SEED;
let view: DerivedView = derive(state);
let phase: Phase = { kind: "synced" };
let aiAvailable = true;
let model = "";
let lastResult: TranslateResponse | null = null;
let activeSlot: string | null = null;
/** True once the user has typed in the natural-language pane since the last applied state. */
let natEdited = false;
let inflight: AbortController | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

// ---------------------------------------------------------------------------
// Rendering

function renderAll(): void {
  view = derive(state);
  const dirty = isNatDirty();

  if (!dirty && ui.nat.value !== view.natlang.text) ui.nat.value = view.natlang.text;
  if (document.activeElement !== ui.template && ui.template.value !== state.ptTemplate) ui.template.value = state.ptTemplate;

  renderNatlang();
  renderTemplate();
  renderRegistry();
  renderOutputs();
  renderStatus();
  applyActive();
  saveState();
}

function isNatDirty(): boolean {
  return natEdited && ui.nat.value !== view.natlang.text;
}

function renderNatlang(): void {
  const dirty = isNatDirty();
  ui.natBackdrop.innerHTML = dirty
    ? paint(ui.nat.value)
    : paint(view.natlang.text, { slots: view.natlang.spans });
  ui.natBackdrop.parentElement?.classList.toggle("dirty", dirty);

  const notes: string[] = [];
  if (lastResult && !dirty) {
    if (lastResult.unmatched.length > 0) {
      notes.push(`<span class="warn">Not found verbatim in the text: ${lastResult.unmatched.map(escapeHtml).join(", ")}</span>`);
    }
    if (lastResult.compileError) notes.push(`<span class="warn">Model output did not compile after ${lastResult.attempts} attempts.</span>`);
  }
  const linked = view.natDoc.tier("slot")?.annotations.length ?? 0;
  const words = view.natDoc.tier("word")?.annotations.length ?? 0;
  if (!dirty) notes.push(`filo: ${linked} of ${words} words are slot tokens`);
  ui.natNotes.innerHTML = notes.join(" · ");
}

function renderTemplate(): void {
  const text = ui.template.value;
  ui.templateBackdrop.innerHTML = paint(text, {
    tokens: highlight(text),
    slots: placeholderSpans(text),
    slotStyle: "placeholder",
    missing: new Set(view.raw.missing),
  });
  syncScroll(ui.template, ui.templateBackdrop);
}

function renderOutputs(): void {
  ui.raw.innerHTML = paint(view.raw.text, { slots: view.raw.spans });
  const compiled = view.compiled;
  if (compiled.ok) {
    ui.formatted.innerHTML = paint(compiled.formatted, { tokens: highlight(compiled.formatted), slots: compiled.formattedSpans });
    ui.json.textContent = compiled.json;
    ui.compileBadge.textContent = compiled.formatted === view.raw.text ? "✓ compiles · canonical" : "✓ compiles";
    ui.compileBadge.className = "badge ok";
  } else {
    ui.formatted.innerHTML = `<span class="error-line">${escapeHtml(compiled.error)}</span>${paint(view.raw.text, {
      tokens: highlight(view.raw.text),
      slots: view.raw.spans,
    })}`;
    ui.json.textContent = "—";
    ui.compileBadge.textContent = compiled.line === null ? "✗ error" : `✗ line ${compiled.line}`;
    ui.compileBadge.className = "badge err";
  }
}

const registryRows = new Map<string, { row: HTMLTableRowElement; input: HTMLInputElement; used: HTMLDivElement }>();

function renderRegistry(): void {
  const locked = isNatDirty() || phase.kind === "thinking";
  const names = view.slots.map((slot) => slot.name);
  const sameRows = names.length === registryRows.size && names.every((name) => registryRows.has(name));
  if (!sameRows) {
    registryRows.clear();
    ui.registry.replaceChildren(...names.map((name) => buildRow(name)));
  }
  for (const slot of view.slots) {
    const entry = registryRows.get(slot.name);
    if (!entry) continue;
    const value = slot.value ?? "";
    if (document.activeElement !== entry.input && entry.input.value !== value) entry.input.value = value;
    entry.input.disabled = locked;
    entry.input.classList.toggle("empty", value === "");
    const bytes = slot.natBytes ? `<span class="bytes" title="UTF-8 byte range in the natural-language text, from filo">${slot.natBytes.start}–${slot.natBytes.end}</span>` : "";
    const unused = !slot.inNatlang && !slot.inPlainType;
    entry.used.innerHTML =
      `<span class="chip ${slot.inNatlang ? "on" : ""}" title="natural language">NL</span>` +
      `<span class="chip ${slot.inPlainType ? "on" : ""}" title="PlainType template">PT</span>${bytes}` +
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
  registryRows.set(name, { row, input, used });
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
  switch (phase.kind) {
    case "synced":
      ui.statusText.textContent = "In sync";
      ui.statusMeta.textContent = lastResult
        ? `${lastResult.model} · ${lastResult.ms} ms · ${lastResult.attempts} attempt${lastResult.attempts === 1 ? "" : "s"} · ${lastResult.usage.cacheRead} cached tokens`
        : aiAvailable ? model : "";
      break;
    case "typing":
      ui.statusText.textContent = "Editing…";
      ui.statusMeta.textContent = "";
      break;
    case "thinking":
      ui.statusText.textContent = `Asking ${model}…`;
      ui.statusMeta.textContent = "";
      break;
    case "error":
      ui.statusText.textContent = phase.message;
      ui.statusMeta.textContent = "";
      break;
    case "offline":
      ui.statusText.textContent = "AI off: natural-language edits need ANTHROPIC_API_KEY on the server";
      ui.statusMeta.textContent = "registry & template edits still work";
      break;
  }
}

function syncScroll(textarea: HTMLTextAreaElement, backdrop: HTMLElement): void {
  backdrop.scrollTop = textarea.scrollTop;
  backdrop.scrollLeft = textarea.scrollLeft;
}

// ---------------------------------------------------------------------------
// Deterministic edits

function setValue(name: string, value: string): void {
  if (isNatDirty()) return;
  state = { ...state, values: { ...state.values, [name]: value } };
  lastResult = lastResult && { ...lastResult, unmatched: [] };
  renderAll();
}

function setTemplate(text: string): void {
  const values: Record<string, string> = { ...state.values };
  for (const name of slotNames(text)) if (!Object.hasOwn(values, name)) values[name] = "";
  state = { ...state, ptTemplate: text, values };
  renderAll();
}

// ---------------------------------------------------------------------------
// Natural-language edits go to the model

function onNatInput(): void {
  natEdited = true;
  clearTimeout(debounceTimer);
  inflight?.abort();
  inflight = null;
  if (!isNatDirty()) {
    phase = aiAvailable ? { kind: "synced" } : { kind: "offline" };
    renderAll();
    return;
  }
  if (!aiAvailable) {
    phase = { kind: "offline" };
    renderAll();
    return;
  }
  phase = { kind: "typing" };
  renderAll();
  debounceTimer = setTimeout(() => void translate(), DEBOUNCE_MS);
}

async function translate(): Promise<void> {
  const natlang = ui.nat.value;
  if (natlang.trim() === "") return;
  const controller = new AbortController();
  inflight = controller;
  phase = { kind: "thinking" };
  renderAll();
  try {
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ natlang, previous: state }),
      signal: controller.signal,
    });
    const body: unknown = await response.json();
    if (inflight !== controller || ui.nat.value !== natlang) return; // superseded
    if (!response.ok) {
      const error = ErrorResponseSchema.safeParse(body);
      phase = { kind: "error", message: error.success ? error.data.message ?? error.data.error : `HTTP ${response.status}` };
      if (response.status === 503) aiAvailable = false;
      return;
    }
    const result = TranslateResponseSchema.parse(body);
    lastResult = result;
    state = pruneValues(result.state);
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

function revertNatlang(): void {
  clearTimeout(debounceTimer);
  inflight?.abort();
  inflight = null;
  natEdited = false;
  ui.nat.value = view.natlang.text;
  phase = aiAvailable ? { kind: "synced" } : { kind: "offline" };
  renderAll();
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

/** The textarea sits on top of its backdrop, so look through it for a slot mark. */
function slotUnderPointer(event: MouseEvent): string | null {
  for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
    if (element instanceof HTMLElement && element.dataset["slot"] !== undefined) return element.dataset["slot"];
  }
  return null;
}

function slotAtCaret(textarea: HTMLTextAreaElement): string | null {
  const caret = textarea.selectionStart;
  if (textarea === ui.nat) return isNatDirty() ? null : slotAt(view.natDoc, caret);
  return placeholderSpans(textarea.value).find((span) => span.start <= caret && caret <= span.end)?.slot ?? null;
}

// ---------------------------------------------------------------------------
// Wiring

ui.nat.addEventListener("input", onNatInput);
ui.template.addEventListener("input", () => setTemplate(ui.template.value));
for (const [textarea, backdrop] of [[ui.nat, ui.natBackdrop], [ui.template, ui.templateBackdrop]] as const) {
  textarea.addEventListener("scroll", () => syncScroll(textarea, backdrop));
  textarea.addEventListener("mousemove", (event) => setActive(slotUnderPointer(event) ?? (document.activeElement === textarea ? slotAtCaret(textarea) : null)));
  textarea.addEventListener("mouseleave", () => setActive(document.activeElement === textarea ? slotAtCaret(textarea) : null));
  for (const type of ["keyup", "click", "focus"] as const) textarea.addEventListener(type, () => setActive(slotAtCaret(textarea)));
  textarea.addEventListener("blur", () => setActive(null));
}
for (const pane of [ui.raw, ui.formatted, ui.registry]) {
  pane.addEventListener("mouseover", (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-slot]") : null;
    if (target) setActive(target.dataset["slot"] ?? null);
  });
  pane.addEventListener("mouseleave", () => {
    if (!(document.activeElement instanceof HTMLInputElement)) setActive(null);
  });
}
ui.registry.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-remove]") : null;
  const name = button?.dataset["remove"];
  if (name === undefined) return;
  const values: Record<string, string> = { ...state.values };
  delete values[name];
  state = { ...state, values };
  renderAll();
});
ui.retry.addEventListener("click", () => void translate());
ui.revert.addEventListener("click", revertNatlang);
ui.reset.addEventListener("click", () => {
  inflight?.abort();
  inflight = null;
  state = SEED;
  lastResult = null;
  natEdited = false;
  ui.template.value = SEED.ptTemplate;
  phase = aiAvailable ? { kind: "synced" } : { kind: "offline" };
  renderAll();
});

function loadState(): DemoState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = DemoStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function saveState(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode, blocked): the demo works without it.
  }
}

async function checkHealth(): Promise<void> {
  try {
    const response = await fetch("/api/health");
    const health = HealthSchema.parse(await response.json());
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
