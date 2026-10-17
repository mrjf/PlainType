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
