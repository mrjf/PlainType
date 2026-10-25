# PlainType

PlainType is a controlled-natural-language notation for JSON Schema. It borrows
the readable, Markdown-like shape of
[`***plain`](https://www.plainlang.org/docs/), while giving every sentence a
deterministic grammar so a compiler—not an LLM—decides its meaning.

Its primary invariant is:

```text
JSON Schema -> PlainType -> JSON Schema = the same JSON data
```

PlainType has three versioned surfaces. Version 1 is the complete, structured
notation for Draft 2020-12. Version 2 is a compact conversational notation for
common object, property, and union shapes, backed by an exact whole-schema
escape. Version 3 is the same compact model written in ***plain's own syntax
(concepts, attributes, sections, frontmatter, `>` comments, linked resources),
plus sentences for defaults and examples. Schemas from older, custom, and
future dialects remain lossless; their semantics are not guessed.

## ***plain-aligned example (version 3)

```plain
---
description: "Per-user display settings"
---

***plaintype***

***definitions***

> Shared by the web and desktop clients.
- :DisplaySettings: How the app is displayed for one user.
  - theme - The color theme - one of "light", "dark", or "system". Defaults to "system". For example: "dark".
  - fontSize - The body font size in points - an integer between 8 and 72. Defaults to 14.
  - displayName (optional) - The name shown in the header - a string between 1 and 40 characters. For example: "Ada" or "Grace Hopper".
  - stylesheet (optional) - Extra CSS rules - a reference to [styles/custom.schema.json](styles/custom.schema.json).
```

Named schemas are ***plain concepts (`:DisplaySettings:`), properties are
`name - description - constraint.` attributes, and reusable definitions follow
the root in the same `***definitions***` list. `Defaults to …` and
`For example: …` become JSON Schema's `default` and `examples`, and a `>`
comment above a declaration becomes its `$comment`. The frontmatter is module
metadata that the compiler ignores. The pair is
[display-settings.plain.plaintype](examples/display-settings.plain.plaintype)
and [display-settings.schema.json](examples/display-settings.schema.json); the
[version-3 section of the language contract](docs/language.md#version-3-plain-aligned-grammar)
maps each ***plain convention.

## Conversational example (version 2)

```plain
***plaintype 2***

- AnimalIdentifier: An identifier attached to an animal. Exactly one of:
  - Microchip: Identification using an implanted microchip.
    - kind: The identifier kind - "microchip".
    - number: The microchip number - a string of exactly 15 digits.
    - implantedOn (optional): The implantation date - a date in YYYY-MM-DD format.
  - CollarTag: Identification using a collar tag.
    - kind: The identifier kind - "collar-tag".
    - text: The text printed on the tag - a string between 1 and 40 characters.
    - phone (optional): A contact phone number - a string, or null.
    - Additional properties allowed
```

Properties are required by default; `(optional)` removes a name from the
generated `required` array. A declaration with no ` - constraint.` suffix is an
object, so object markers are unnecessary. Objects are closed by default, so no
directive means an explicit `"additionalProperties": false`. The indented
override above emits explicit `true`. A third directive, `Additional properties
unspecified`, omits the JSON Schema keyword and therefore retains JSON Schema's
own open default.

Named schemas are types in conversational prose. `an Animal` maps to a local
`$ref`; `an array of Animal` maps to an array whose `items` schema uses that
reference. The JSON values are Animals—not reference or pointer values—so the
surface language does not say “Animal references.”

The complete paired files are
[animal-identifier.conversational.plaintype](examples/animal-identifier.conversational.plaintype)
and [animal-identifier.schema.json](examples/animal-identifier.schema.json).
The recursive-reference form is demonstrated by
[animal-family.conversational.plaintype](examples/animal-family.conversational.plaintype)
and [animal-family.schema.json](examples/animal-family.schema.json).

Version 2 uses a fixed expansion order so its concise phrases are exactly
reversible. When a schema does not fit that order or the supported concise
vocabulary, it uses the universal form:

```plain
***plaintype 2***

- Exact JSON Schema: {"type":"number","multipleOf":0.25}
```

## Structured example (version 1)

This JSON Schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Person",
  "type": "object",
  "properties": {
    "name": {
      "description": "The person's full name.",
      "type": ["string", "null"],
      "minLength": 1
    },
    "age": { "type": "integer", "minimum": 0 }
  },
  "required": ["name"],
  "additionalProperties": false,
  "x-owner": { "team": "identity" }
}
```

becomes:

```plain
***plaintype 1***

- It declares JSON Schema dialect "https://json-schema.org/draft/2020-12/schema".
- Its title is "Person".
- Its allowed type or types are "object".
- Properties:
  - name (required):
    # The person's full name.
    - allowed types:
      - string (must contain at least 1 character)
      - null
  - age:
    - allowed types:
      - integer
    - A numeric instance must be at least 0.
- Its additional-property schema is:
  - No instance is accepted.
- Its exact JSON Schema entry is ["x-owner",{"team":"identity"}].
```

The final sentence is version 1's member-level escape hatch. It preserves an
unknown keyword and any JSON value without interpreting data inside that value
as a schema.

`#` lines are semantic description comments: they map to JSON Schema's
`description` keyword and therefore survive both directions in version 1.
Version 2 instead places descriptions after the declaration colon. `$comment`
remains a separate JSON Schema keyword.

## Use

Node.js 20 or newer is required.

```bash
npm install
npm run build

node dist/src/cli.js from-json person.schema.json -o person.plaintype
node dist/src/cli.js from-json person.schema.json --style conversational
node dist/src/cli.js from-json person.schema.json --style plain
node dist/src/cli.js to-json person.plaintype -o person.schema.json
node dist/src/cli.js check person.plaintype
node dist/src/cli.js format person.plaintype
```

An installed or linked package exposes the shorter `plaintype` binary. Both
conversion commands also accept standard input and write to standard output
when paths are omitted.

`structured` emits `***plaintype 1***` and is the default for `from-json`.
`conversational` emits `***plaintype 2***`, and `plain` emits `***plaintype***`.
With no `--style`, `format`
preserves the input document's version; an explicit style converts to that
style and header.

The library API exposes `fromJsonSchema`, `toJsonSchema`,
`formatPlainType`, and a lossless JSON AST:

```ts
import { fromJsonSchema, toJsonSchema } from "plaintype";

const plain = fromJsonSchema('{"type":"string"}', { style: "conversational" });
const json = toJsonSchema(plain);
```

## What “lossless” means

The normative guarantee is JSON-data preservation, not byte-for-byte source
preservation. JSON whitespace and string-escape spelling are canonicalized.
PlainType additionally retains object member order, duplicate member names,
and raw number tokens such as `1e400` or a 40-digit integer, even though the JSON
Schema data model does not require all of those distinctions.

No input keyword is normalized, dereferenced, defaulted, merged, sorted, or
dropped. In particular, `{}` is not replaced with `true`, annotations remain
present, and objects inside `const`, `enum`, `default`, `examples`, or unknown
keywords remain opaque instance data.

Version 2's required and closed defaults are authoring rules, not assumptions
about an imported schema. Its renderer uses conversational shorthand only when
the corresponding `required` and `additionalProperties` state can be recovered
exactly. Otherwise it emits `Exact JSON Schema:`.

When `$schema` is absent, the friendly renderer uses Draft 2020-12 as an
out-of-band interpretation context but does not add `$schema` to the result.
Pass `--dialect none` to render every entry opaquely, or `--dialect URI` to set
an explicit context. See [the language contract](docs/language.md) for the exact
boundary and grammar.

## Demo

[`demo/`](demo/README.md) is a Bun + Hono dev server with six synced panes:
natural language, a slotted PlainType template, a value registry, raw and
formatted PlainType, and the compiled JSON Schema. Registry edits update every
pane instantly; natural-language edits go through a small Claude model.

## Verification

```bash
npm test
npm run check
npm run verify:suite -- /path/to/JSON-Schema-Test-Suite/tests/draft2020-12
```

The suite verifier runs the JSON → PlainType → JSON invariant over every
schema in a local checkout of the official
[JSON Schema Test Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite).

Draft 2020-12 remains the latest published JSON Schema dialect; future and
custom vocabularies are transported losslessly until a semantic codec is
explicitly registered rather than inferred.
