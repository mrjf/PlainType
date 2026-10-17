# PlainType Studio

A local demo server with six synced panes:

| Pane | What it is | Edits |
| --- | --- | --- |
| Natural language | A free-form description | Sent to a small Claude model after a short pause |
| Template | PlainType version 3 (***plain syntax) with `{{slot}}` placeholders | Applied instantly |
| Value registry | Slot name → value | Applied instantly to every pane |
| Raw PlainType | The template with values filled in | Read-only |
| Formatted PlainType | Canonical `formatPlainType` output, syntax highlighted | Read-only |
| JSON Schema | What `toJsonSchema` compiles the raw PlainType to | Read-only |

Each slot has its own color, and hovering it (or putting the caret on it)
lights up the same slot in every pane. That includes the words in the
natural-language text that became PlainType tokens.

## Run

```bash
git submodule update --init   # vendors mrjf/filo into demo/vendor/filo
cd demo
bun install
ANTHROPIC_API_KEY=sk-ant-... bun run dev   # http://localhost:3000
```

Without `ANTHROPIC_API_KEY` the server still runs: the template and registry
panes work, and natural-language edits show a message explaining how to turn
them on.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `PLAINTYPE_MODEL` | `claude-haiku-5-5` | Model used for natural-language edits |
| `PLAINTYPE_EFFORT` | `low` | `low`, `medium` or `high` |

```bash
bun run test        # unit and route tests
bun run typecheck
```

## How it stays in sync

The state is three values: a natural-language template, a PlainType template
and a value registry (`shared/state.ts`). Every pane is a pure function of that
state, so a registry edit re-renders everything synchronously and
deterministically in the browser.

A natural-language edit is the only thing that calls the model
(`src/translate.ts`):

1. The model sees the previous description, template and values plus the new
   description. It returns a PlainType template with `{{slots}}` and a value
   for each slot, copied verbatim from the description.
2. The server checks the reply:
   - every placeholder has exactly one value;
   - every value occurs in the text;
   - the filled-in PlainType compiles.

   If any check fails, it asks the model once more with the exact problems.
3. The server, not the model, builds the natural-language template by finding
   each value in the user's text (`linkNatlang` in `shared/slots.ts`). So
   rendering it always reproduces exactly what the user typed.

In the browser, typing aborts any request in flight, and a reply is applied
only if the text hasn't changed since it was sent.

[filo](https://github.com/mrjf/filo) holds the text-to-token mapping. Both
the natural-language text and the raw PlainType become filo documents with a
`slot` tier: one annotation per slot value, keyed by UTF-8 byte range. The
natural-language document also gets filo's `word` tier. Caret hit-testing in
the natural-language pane uses `annotationsAt`, and the registry shows each
slot's byte range.

The system prompt is built at boot from `docs/language.md` (the version-2 and
version-3 sections) and the version-3 example files, so the model always sees
the grammar as it ships. It is marked for prompt caching.
