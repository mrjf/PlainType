import { expect, test } from "bun:test";
import { buildSystemPrompt } from "../src/prompt.js";

test("the system prompt carries the compact grammars and version-3 examples, not version 1", async () => {
  const prompt = await buildSystemPrompt();
  expect(prompt).toContain("## Version 2: conversational grammar");
  expect(prompt).toContain("## Version 3: ***plain-aligned grammar");
  expect(prompt).toContain("- :AnimalFamily: A family tree for an animal.");
  expect(prompt).not.toContain("## Version 1: structured grammar");
  expect(await buildSystemPrompt()).toBe(prompt);
});
