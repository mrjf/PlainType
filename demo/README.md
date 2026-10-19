# PlainType Studio

A local demo server with six synced panes:

| Pane | What it is | Edits |
| --- | --- | --- |
| Natural language | A free-form description | Sent to a small Claude model after a short pause |
| Template | PlainType version 3 (***plain syntax) with `{{slot}}` placeholders | Applied instantly |
| Value registry | Slot name → value | Applied instantly to every pane |
| Raw PlainType | The template with values filled in | Applied instantly; the model repairs text that stops compiling |
| Formatted PlainType | A reader view of the canonical `formatPlainType` output | Read-only |
| JSON Schema | What `toJsonSchema` compiles the raw PlainType to | Read-only |

Each slot has its own color. In the editing panes it shows as a thin
underline; hovering a slot, putting the caret on it, or editing it in the
registry fills it in every pane, including the words in the natural-language
text that became PlainType tokens. The formatted pane is what an app would
show: no header or section markers, bold definitions, italic comments, and
no slot color until you hover or edit one.

Editing the raw PlainType maps back onto the state without the model
(`shared/raw-edit.ts`). Typing inside a value updates that slot in the
registry; typing anywhere else edits the template. If the edit stops
compiling, the model gets the text and the compiler error after a short pause
and returns a corrected document, which the server checks and formats
canonically (`src/heal.ts`). The values are then found again in the repaired
text, so the slots survive the repair.

## Instance Studio

The **Instance** tab (`/instance`) is the same six-pane studio for one JSON
record of the schema the Schema tab currently holds. Its PlainType-style
notation for data (`shared/instance-notation.ts`) reads like this:

```plain
***plaintype data 1***

- :Button:
  - label - "Buy now"
  - priority - 2
  - owner
    - name - "Ada"
  - history
    - #1 - "created"
```

Members are `key - <JSON>`, objects nest, and list items are numbered `#n`.
Values are strict JSON, read with PlainType's lossless parser, so key order and
number spellings survive. The Record pane is the reader view, and the JSON pane
shows the value validated against the compiled schema with Ajv (draft 2020-12).
Members that fail validation are flagged in the record.

The studio is meant for small records. Long strings (over 48 characters) move
into the registry as slots and are folded to `…` everywhere: in the raw editor
(where they cannot be edited in place), the record (expandable), the JSON pane,
and everything sent to the model. A slot the model hands back in its folded
form gets its full value back.

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
