import { describe, expect, test } from "bun:test";
import { SEED, derive, pruneValues, slotAt, stateFromSlots } from "../shared/state.js";

describe("derive", () => {
  test("the seed renders, compiles, and links every slot in both languages", () => {
    const view = derive(SEED);
    expect(view.compiled.ok).toBe(true);
    expect(view.natlang.text).toContain("its border is always red");
    expect(view.compiled.ok && view.compiled.formatted).toBe(view.raw.text);
    if (view.compiled.ok) {
      const radius = JSON.parse(view.compiled.json).properties.cornerRadius;
      expect([radius.default, JSON.parse(view.compiled.json).properties.label.examples]).toEqual([4, ["Buy now"]]);
    }
    expect(view.slots.every((slot) => slot.inNatlang && slot.inPlainType)).toBe(true);
    if (view.compiled.ok) {
      expect(JSON.parse(view.compiled.json).properties.borderColor.const).toBe("red");
      expect(view.compiled.formattedSpans.map((span) => span.slot)).toEqual(view.raw.spans.map((span) => span.slot));
    }
  });

  test("changing a registry value changes every pane deterministically", () => {
    const view = derive({ ...SEED, values: { ...SEED.values, borderColor: "blue", labelMax: "40" } });
    expect(view.natlang.text).toContain("always blue");
    expect(view.raw.text).toContain('"blue"');
    expect(view.compiled.ok && JSON.parse(view.compiled.json).properties.label.maxLength).toBe(40);
    const again = derive({ ...SEED, values: { ...SEED.values, borderColor: "blue", labelMax: "40" } });
    expect([again.natlang, again.raw, again.compiled, again.slots]).toEqual([view.natlang, view.raw, view.compiled, view.slots]);
  });

  test("an invalid value surfaces as a compile error with a line number", () => {
    const view = derive({ ...SEED, values: { ...SEED.values, labelMax: "lots" } });
    expect(view.compiled.ok).toBe(false);
    if (!view.compiled.ok) expect(view.compiled.line).toBe(6);
  });

  test("filo byte ranges account for multi-byte characters", () => {
    const view = derive({ natTemplate: "Café {{x}}", ptTemplate: "", values: { x: "rouge" } });
    const slot = view.slots.find((candidate) => candidate.name === "x");
    expect(slot?.natBytes).toEqual({ start: 6, end: 11 });
    expect(slotAt(view.natDoc, 5)).toBe("x");
    expect(slotAt(view.natDoc, 2)).toBeNull();
  });
});

describe("stateFromSlots and pruneValues", () => {
  test("build the natural-language template from slot values", () => {
    const { state, unmatched } = stateFromSlots("Max 5 items", "{{max}}", [{ name: "max", value: "5" }, { name: "gone", value: "9" }]);
    expect(state.natTemplate).toBe("Max {{max}} items");
    expect(unmatched).toEqual(["gone"]);
    expect(pruneValues(state).values).toEqual({ max: "5" });
  });
});
