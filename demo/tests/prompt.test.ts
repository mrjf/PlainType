import { expect, test } from "bun:test";
import { buildSystemPrompt } from "../src/prompt.js";

test("the system prompt carries the version-2 grammar and examples, not version 1", async () => {
  const prompt = await buildSystemPrompt();
  expect(prompt).toContain("## Version 2: conversational grammar");
  expect(prompt).toContain("***plaintype 2***");
  expect(prompt).not.toContain("## Version 1: structured grammar");
  expect(await buildSystemPrompt()).toBe(prompt);
});
