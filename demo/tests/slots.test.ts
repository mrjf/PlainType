import { describe, expect, test } from "bun:test";
import { linkNatlang, locate, placeholderSpans, render, slotNames } from "../shared/slots.js";

describe("render", () => {
  test("substitutes values and records where each landed", () => {
    const result = render("between {{min}} and {{max}}", { min: "1", max: "24" });
    expect(result.text).toBe("between 1 and 24");
    expect(result.spans).toEqual([
      { slot: "min", start: 8, end: 9 },
      { slot: "max", start: 14, end: 16 },
    ]);
    expect(result.missing).toEqual([]);
  });

  test("keeps placeholders without values and reports them", () => {
    const result = render("a {{known}} and {{unknown}}", { known: "x" });
    expect(result.text).toBe("a x and {{unknown}}");
    expect(result.missing).toEqual(["unknown"]);
  });

  test("ignores inherited object keys", () => {
    expect(render("{{constructor}}", {}).text).toBe("{{constructor}}");
  });
});

describe("slotNames and placeholderSpans", () => {
  test("list unique names in order and their template ranges", () => {
    expect(slotNames("{{b}} {{a}} {{b}} {{ c }}")).toEqual(["b", "a", "c"]);
    expect(placeholderSpans("x {{a}}")).toEqual([{ slot: "a", start: 2, end: 7 }]);
  });
});

describe("locate", () => {
  test("matches whole tokens only", () => {
    const { spans, unmatched } = locate("from 12 to 1", [{ name: "low", value: "1" }]);
    expect(spans).toEqual([{ slot: "low", start: 11, end: 12 }]);
    expect(unmatched).toEqual([]);
  });

  test("assigns repeated values left to right", () => {
    const { spans } = locate("0 then 0", [
      { name: "first", value: "0" },
      { name: "second", value: "0" },
    ]);
    expect(spans.map((span) => [span.slot, span.start])).toEqual([["first", 0], ["second", 7]]);
  });

  test("falls back to earlier text when the order differs", () => {
    const { spans } = locate("red then 24", [
      { name: "max", value: "24" },
      { name: "color", value: "red" },
    ]);
    expect(spans.map((span) => span.slot)).toEqual(["color", "max"]);
  });

  test("reports values that are absent or empty", () => {
    expect(locate("abc", [{ name: "x", value: "zzz" }, { name: "y", value: "" }]).unmatched).toEqual(["x", "y"]);
  });
});

describe("linkNatlang", () => {
  test("rendering the produced template reproduces the text exactly", () => {
    const text = "A Button has a label of up to 24 characters and a red border.";
    const slots = [
      { name: "typeName", value: "Button" },
      { name: "labelMax", value: "24" },
      { name: "borderColor", value: "red" },
    ];
    const link = linkNatlang(text, slots);
    expect(link.template).toBe("A {{typeName}} has a label of up to {{labelMax}} characters and a {{borderColor}} border.");
    expect(render(link.template, { typeName: "Button", labelMax: "24", borderColor: "red" }).text).toBe(text);
  });
});
