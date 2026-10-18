import { describe, expect, test } from "bun:test";
import { applyRawEdit, rawSlotOrder, templateFromRaw } from "../shared/raw-edit.js";
import { render } from "../shared/slots.js";
import type { DemoState } from "../shared/state.js";

const state: DemoState = {
  natTemplate: "",
  ptTemplate: "a string between {{min}} and {{max}} characters, colored {{color}} and {{color}}.",
  values: { min: "1", max: "24", color: "red" },
};
const raw = (s: DemoState): string => render(s.ptTemplate, s.values).text;

describe("applyRawEdit", () => {
  test("typing inside a value updates the registry", () => {
    const next = applyRawEdit(state, raw(state).replace("24", "40"));
    expect(next.values.max).toBe("40");
    expect(next.ptTemplate).toBe(state.ptTemplate);
  });

  test("extending a value at its edge keeps it a value edit", () => {
    expect(applyRawEdit(state, raw(state).replace("24", "245")).values.max).toBe("245");
  });

  test("a value edit updates every use of the slot", () => {
    const edited = raw(state).replace("colored red", "colored blue");
    const next = applyRawEdit(state, edited);
    expect(next.values.color).toBe("blue");
    expect(raw(next)).toBe("a string between 1 and 24 characters, colored blue and blue.");
  });

  test("whitespace typed beside a value goes into the template", () => {
    const edited = raw(state).replace("and 24", "and  24");
    const next = applyRawEdit(state, edited);
    expect(next.values.max).toBe("24");
    expect(raw(next)).toBe(edited);
  });

  test("edits outside values change the template and keep the slots", () => {
    const edited = raw(state).replace("a string", "a short string");
    const next = applyRawEdit(state, edited);
    expect(next.ptTemplate).toBe("a short string between {{min}} and {{max}} characters, colored {{color}} and {{color}}.");
    expect(raw(next)).toBe(edited);
  });

  test("an edit spanning a value replaces it with literal text", () => {
    const edited = raw(state).replace("1 and 24", "one or more");
    const next = applyRawEdit(state, edited);
    expect(next.ptTemplate).toBe("a string between one or more characters, colored {{color}} and {{color}}.");
    expect(raw(next)).toBe(edited);
  });

  test("empty values and missing slots keep positions straight", () => {
    const sparse: DemoState = { natTemplate: "", ptTemplate: "x {{empty}}{{gone}} y {{v}} z", values: { empty: "", v: "7" } };
    const edited = raw(sparse).replace(" z", " zz");
    const next = applyRawEdit(sparse, edited);
    expect(next.ptTemplate).toBe("x {{empty}}{{gone}} y {{v}} zz");
    expect(raw(next)).toBe(edited);
  });
});

test("templateFromRaw re-links a rewritten document to the same slots", () => {
  const healed = "A string between 1 and 24 characters; colored red and red!";
  expect(templateFromRaw(healed, rawSlotOrder(state))).toBe(
    "A string between {{min}} and {{max}} characters; colored {{color}} and {{color}}!",
  );
});
