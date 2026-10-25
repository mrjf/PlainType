import { expect, test } from "bun:test";
import { highlight, type TokenClass } from "../shared/highlight.js";

function classes(line: string): Array<[string, TokenClass]> {
  return highlight(line).map((token) => [line.slice(token.start, token.end), token.cls]);
}

test("classifies a version-2 leaf line", () => {
  expect(classes('  - phone (optional): A contact number - a string, or "x".')).toEqual([
    ["-", "bullet"],
    ["phone", "name"],
    [" (optional)", "qualifier"],
    [":", "punct"],
    [" A contact number", "desc"],
    ["-", "punct"],
    ["a", "keyword"],
    ["string", "keyword"],
    ["or", "keyword"],
    ['"x"', "string"],
  ]);
});

test("classifies headers, directives, unions and exact escapes", () => {
  expect(classes("***plaintype 2***")).toEqual([["***plaintype 2***", "header"]]);
  expect(classes("***definitions***")).toEqual([["***definitions***", "header"]]);
  expect(classes("  - Additional properties allowed")).toEqual([["-", "bullet"], ["Additional properties allowed", "keyword"]]);
  expect(classes("- Id: An identifier. Exactly one of:").at(-1)).toEqual(["Exactly one of:", "keyword"]);
  expect(classes('- Exact JSON Schema: {"type":"number"}').slice(1)).toEqual([
    ["Exact JSON Schema: ", "keyword"],
    ['{"type":"number"}', "json"],
  ]);
});

test("a dash inside a quoted constant does not split description and constraint", () => {
  const tokens = classes('  - kind: The kind - "collar - tag".');
  expect(tokens.at(-1)).toEqual(['"collar - tag"', "string"]);
});

test("classifies version-3 concepts, attributes, annotations, links and comments", () => {
  expect(classes("- :Animal: A reusable animal record.")).toEqual([
    ["-", "bullet"],
    [":Animal:", "concept"],
    [" A reusable animal record.", "desc"],
  ]);
  expect(classes('  - theme (optional) - The theme - one of "a" or "b". Defaults to "a". For example: "b".')).toEqual([
    ["-", "bullet"],
    ["theme", "name"],
    [" (optional)", "qualifier"],
    ["-", "punct"],
    [" The theme", "desc"],
    ["-", "punct"],
    ["one", "keyword"],
    ["of", "keyword"],
    ['"a"', "string"],
    ["or", "keyword"],
    ['"b"', "string"],
    ["Defaults", "keyword"],
    ["to", "keyword"],
    ['"a"', "string"],
    ["For", "keyword"],
    ["example", "keyword"],
    ['"b"', "string"],
  ]);
  expect(classes("  - pet - A pet - an array of :Animal:.").at(-1)).toEqual([":Animal:", "concept"]);
  expect(classes("  - css - Rules - a reference to [a.json](a.json).").at(-1)).toEqual(["[a.json](a.json)", "string"]);
  expect(classes("  > a note")).toEqual([["> a note", "comment"]]);
});

test("frontmatter lines are metadata", () => {
  const text = '---\ndescription: "x"\n---\n***plaintype***';
  expect(highlight(text).map((token) => [text.slice(token.start, token.end), token.cls])).toEqual([
    ["---", "meta"],
    ['description: "x"', "meta"],
    ["---", "meta"],
    ["***plaintype***", "header"],
  ]);
});

test("classifies the library sentences, constraints and the property escape", () => {
  expect(classes('  - mail - Its mail - an email string. Sensitive. Defaults to "a".').slice(-5)).toEqual([
    ["string", "keyword"],
    ["Sensitive", "keyword"],
    ["Defaults", "keyword"],
    ["to", "keyword"],
    ['"a"', "string"],
  ]);
  expect(classes('- :Colour: A colour - a string matching "^#[0-9a-f]{6}$".').slice(-2)).toEqual([
    ["matching", "keyword"],
    ['"^#[0-9a-f]{6}$"', "string"],
  ]);
  expect(classes("  - a - A - a non-negative number, or null.").filter(([, cls]) => cls === "keyword")).toEqual([
    ["a", "keyword"],
    ["non-negative", "keyword"],
    ["number", "keyword"],
    ["or", "keyword"],
    ["null", "keyword"],
  ]);
  expect(classes('  - weight (optional) - Exact JSON Schema: {"type":"number"}').slice(-2)).toEqual([
    ["Exact JSON Schema: ", "keyword"],
    ['{"type":"number"}', "json"],
  ]);
});
