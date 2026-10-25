import { describe, expect, test } from "bun:test";
import { parseJson, stringifyJson } from "../../src/index.js";
import { FOLD_AT, foldValue } from "../shared/fold.js";
import { formatInstance, parseInstance } from "../shared/instance-notation.js";
import { INSTANCE_SEED, deriveInstance, displaySlotOrder, slotLongStrings, unfoldReturnedValues } from "../shared/instance-state.js";
import { applyDisplayedRawEdit, templateFromRaw } from "../shared/raw-edit.js";
import { SEED, derive } from "../shared/state.js";
import { compileValidator } from "../shared/validate.js";

const LONG = "Click here to finish checking out and pay for everything in your basket right now";

describe("PlainType data notation", () => {
  const cases = [
    '{"label":"Buy now","priority":2,"tags":["a","b"],"owner":{"name":"Ada","emails":[]},"meta":{}}',
    '{"history":[{"at":"2026-10-19","n":1e400},"plain",null,true,[1,2]],"display name":"x","#1":"hash"}',
    '{"a":1,"a":2}',
    '["x",{"y":0.10}]',
    '"just a string"',
    "{}",
    `{"tags":["${"a".repeat(30)}","${"b".repeat(30)}"]}`,
  ];
  for (const json of cases) {
    test(`round-trips ${json.slice(0, 40)}`, () => {
      const text = formatInstance(parseJson(json), "Thing");
      const parsed = parseInstance(text);
      expect(stringifyJson(parsed.value)).toBe(stringifyJson(parseJson(json)));
      expect(formatInstance(parsed.value, "Thing")).toBe(text);
    });
  }

  test("writes members, nested objects, and numbered items", () => {
    expect(formatInstance(parseJson('{"label":"Go","owner":{"name":"Ada"},"log":[{"at":1},"x"],"tags":["a"]}'), "Button")).toBe(
      `***plaintype data 1***

- :Button:
  - label - "Go"
  - owner
    - name - "Ada"
  - log
    - #1
      - at - 1
    - #2 - "x"
  - tags - ["a"]
`,
    );
  });

  test("reports notation errors with line numbers", () => {
    expect(() => parseInstance("- :A:")).toThrow(/Expected \*\*\*plaintype data 1\*\*\* at line 1/);
    expect(() => parseInstance("***plaintype data 1***\n\n- :A:\n  - a: 1")).toThrow(/Expected ' - ' between the member name and its value at line 4/);
    expect(() => parseInstance("***plaintype data 1***\n\n- :A:\n  - a - 'x'")).toThrow(/Invalid JSON value .* at line 4/);
    expect(() => parseInstance("***plaintype data 1***\n\n- :A:\n  - list\n    - #2 - 1")).toThrow(/Expected item #1 at line 5/);
    expect(() => parseInstance("***plaintype data 1***\n\n- :A:\n  - empty")).toThrow(/write an empty one inline as \{\} or \[\] at line 4/);
  });

  test("> lines are comments", () => {
    expect(stringifyJson(parseInstance("***plaintype data 1***\n> note\n- :A:\n  > about a\n  - a - 1").value)).toBe('{"a":1}');
  });
});

describe("folding", () => {
  test("short strings are untouched; long ones keep whole escapes and end with …", () => {
    expect(foldValue("short")).toBe("short");
    expect(foldValue(LONG)).toBe("Click here to finish checking ou…");
    const escaped = `${"x".repeat(30)}\\u00e9${"y".repeat(FOLD_AT)}`;
    expect(foldValue(escaped)).toBe(`${"x".repeat(30)}…`);
  });

  test("a folded slot is atomic in the raw editor", () => {
    const state = { natTemplate: "", ptTemplate: '- a - "{{long}}"\n- b - {{n}}', values: { long: LONG, n: "1" } };
    const display = { long: foldValue(LONG), n: "1" };
    const shown = `- a - "${foldValue(LONG)}"\n- b - 1`;
    expect(applyDisplayedRawEdit(state, shown.replace("Click", "Tap"), display)).toBeNull();
    expect(applyDisplayedRawEdit(state, shown.replace("- b - 1", "- b - 2"), display)?.values).toEqual({ long: LONG, n: "2" });
    expect(applyDisplayedRawEdit(state, shown.replace("- a", "- aa"), display)?.ptTemplate).toBe('- aa - "{{long}}"\n- b - {{n}}');
  });

  test("a repaired folded document re-links to the full values", () => {
    const state = slotLongStrings({ ...INSTANCE_SEED, ptTemplate: INSTANCE_SEED.ptTemplate.replace("  - priority", `  - tooltip - "${LONG}"\n  - priority`) });
    const view = deriveInstance(state, { title: "Button", validator: null });
    const healed = view.display.text.replace("- priority -", "- priority -");
    const template = templateFromRaw(healed, displaySlotOrder(view));
    expect(template).toContain('"{{tooltip}}"');
    expect(deriveInstance({ ...state, ptTemplate: template }, { title: "Button", validator: null }).raw.text).toContain(LONG);
  });

  test("folded values handed back by the model get their full text back", () => {
    expect(unfoldReturnedValues({ tooltip: foldValue(LONG), label: "Go" }, { tooltip: LONG, label: "Buy" })).toEqual({ tooltip: LONG, label: "Go" });
  });
});

describe("instance state", () => {
  const schemaView = derive(SEED);
  if (!schemaView.compiled.ok) throw new Error("seed schema must compile");
  const context = { title: "Button", validator: compileValidator(schemaView.compiled.json) };

  test("the seed instance parses and is valid against the seed schema", () => {
    const view = deriveInstance(INSTANCE_SEED, context);
    expect(view.parsed.ok && JSON.parse(view.parsed.json)).toEqual({ label: "Buy now", borderColor: "red", priority: 2 });
    expect(view.issues).toEqual([]);
    expect(view.natlang.text).toBe('Our checkout button says "Buy now", has a red border and priority 2.');
  });

  test("validation reports paths for bad values, extra and missing members", () => {
    const state = { ...INSTANCE_SEED, ptTemplate: INSTANCE_SEED.ptTemplate.replace('  - borderColor - "{{borderColor}}"\n', '  - extra - true\n'), values: { ...INSTANCE_SEED.values, priority: "9" } };
    const issues = deriveInstance(state, context).issues ?? [];
    expect(issues.map((issue) => issue.path).sort()).toEqual(["", "/extra", "/priority"]);
    expect(issues.find((issue) => issue.path === "")?.message).toContain("borderColor");
  });

  test("long literals move into the registry under their member name", () => {
    const state = slotLongStrings({ natTemplate: "", ptTemplate: `***plaintype data 1***\n\n- :A:\n  - notes\n    - #1 - "${LONG}"\n  - "display name" - "${LONG}"`, values: {} });
    expect(state.ptTemplate).toContain('- #1 - "{{notes1}}"');
    expect(state.ptTemplate).toContain('- "display name" - "{{displayName}}"');
    expect(state.values).toEqual({ notes1: LONG, displayName: LONG });
  });
});
