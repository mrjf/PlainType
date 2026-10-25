import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app.js";
import { SEED } from "../shared/state.js";
import type { Translate } from "../src/translate.js";

const fakeTranslate: Translate = async (request) => ({
  state: { natTemplate: request.natlang, ptTemplate: request.previous.ptTemplate, values: request.previous.values },
  unmatched: [],
  compileError: null,
  attempts: 1,
  model: "fake",
  ms: 1,
  usage: { input: 0, output: 0, cacheRead: 0 },
});

function post(app: ReturnType<typeof createApp>, body: unknown) {
  return app.request("/api/translate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("routes", () => {
  test("health reports whether the model is available", async () => {
    const response = await createApp({ translate: null, heal: null, instanceTranslate: null, instanceHeal: null, model: "m" }).request("/api/health");
    expect(await response.json()).toEqual({ ok: true, ai: false, model: "m" });
  });

  test("translate returns the translator's result", async () => {
    const response = await post(createApp({ translate: fakeTranslate, heal: null, instanceTranslate: null, instanceHeal: null, model: "fake" }), { natlang: "hello", previous: SEED });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ model: "fake", state: { natTemplate: "hello" } });
  });

  test("translate rejects malformed requests", async () => {
    const response = await post(createApp({ translate: fakeTranslate, heal: null, instanceTranslate: null, instanceHeal: null, model: "fake" }), { natlang: "", previous: { values: { "bad name": 1 } } });
    expect(response.status).toBe(400);
  });

  test("translate explains how to enable the model when it is not configured", async () => {
    const response = await post(createApp({ translate: null, heal: null, instanceTranslate: null, instanceHeal: null, model: "m" }), { natlang: "hello", previous: SEED });
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).toContain("ANTHROPIC_API_KEY");
  });
});

describe("heal route", () => {
  test("returns the healer's result", async () => {
    const app = createApp({
      translate: null,
      heal: async (request) => ({ raw: request.raw.toUpperCase(), compileError: null, attempts: 1, model: "fake", ms: 1, usage: { input: 0, output: 0, cacheRead: 0 } }),
      instanceTranslate: null,
      instanceHeal: null,
      model: "fake",
    });
    const response = await app.request("/api/heal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ raw: "abc" }) });
    expect(await response.json()).toMatchObject({ raw: "ABC" });
  });

  test("explains how to enable the model when it is not configured", async () => {
    const response = await createApp({ translate: null, heal: null, instanceTranslate: null, instanceHeal: null, model: "m" }).request("/api/heal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw: "abc" }),
    });
    expect(response.status).toBe(503);
  });
});
