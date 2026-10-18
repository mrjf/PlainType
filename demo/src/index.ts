import Anthropic from "@anthropic-ai/sdk";
import homepage from "../web/index.html";
import { createApp } from "./app.js";
import { aiConfigured, env } from "./env.js";
import { createHealer } from "./heal.js";
import { buildHealPrompt, buildSystemPrompt } from "./prompt.js";
import { HealOutputSchema } from "./schemas.js";
import { anthropicModelCall, anthropicStructuredCall, createTranslator } from "./translate.js";

const client = aiConfigured ? new Anthropic({ timeout: 60_000, maxRetries: 1 }) : null;
const callOptions = { model: env.PLAINTYPE_MODEL, effort: env.PLAINTYPE_EFFORT };

const translate = client
  ? createTranslator(anthropicModelCall({ client, systemPrompt: await buildSystemPrompt(), ...callOptions }))
  : null;
const heal = client
  ? createHealer(anthropicStructuredCall({ client, systemPrompt: await buildHealPrompt(), ...callOptions }, HealOutputSchema))
  : null;

const app = createApp({ translate, heal, model: env.PLAINTYPE_MODEL });

const server = Bun.serve({
  port: env.PORT,
  routes: { "/": homepage },
  fetch: app.fetch,
  development: env.NODE_ENV === "development" ? { hmr: true, console: true } : false,
});

console.log(`PlainType demo on ${server.url}`);
console.log(
  translate
    ? `Natural-language edits use ${env.PLAINTYPE_MODEL} (effort ${env.PLAINTYPE_EFFORT}).`
    : "No ANTHROPIC_API_KEY: natural-language edits are disabled; registry and template edits still work.",
);
