# PlainType language contract

PlainType has three versioned, deterministic surface grammars over the same
lossless JSON abstract syntax tree. The header selects the parser; it is not a
comment or an advisory version number.

| Header | Style name | Grammar |
| --- | --- | --- |
| `***plaintype 1***` | `structured` | Complete keyword-by-keyword clauses |
| `***plaintype 2***` | `conversational` | Compact object, property, and union declarations |
| `***plaintype***` | `plain` | The version-2 model written in [***plain](https://plainlang.org/docs/language-guide/basic-syntax) syntax |

## Version 1: structured grammar

### Scope

PlainType is controlled English over a lossless JSON abstract syntax tree.
The compiler accepts only documented phrases. Synonyms and free-form prose are
syntax errors, which is what makes reverse translation deterministic.

Version 1 has two separate promises:

1. Any JSON Schema object or boolean can be represented and reconstructed
   without losing JSON data, including unknown keywords and custom vocabulary
   values.
2. The 57 active keywords in the official Draft 2020-12 dialect have friendly,
   structurally aware wording. Four legacy-reserved properties accepted by its
   meta-schema are preserved without migration.

An unknown dialect is lossless but opaque. Supporting its semantics requires a
separate, versioned dialect profile.

### Document grammar

A document starts with the exact version heading:

```plain
***plaintype 1***
```

The schema follows as two-space-indented bullet clauses and semantic `#`
description comments. Blank lines are ignored. Tabs, skipped indentation
levels, unknown sentences, and other prose are errors.

Boolean and empty schemas use exact markers:

```plain
- Every instance is accepted.
- No instance is accepted.
- No constraints or annotations are specified.
```

Each marker is a complete schema and cannot be combined with other clauses.

### Ordered clauses and reversible folding

The baseline representation uses one clause per JSON object member in source
order. The concise forms below may fold adjacent members only when the parser
can reconstruct their exact order, array order, value shape, and raw number
tokens. Otherwise the renderer keeps separate clauses. Duplicate members remain
transportable even though JSON interoperability guidance recommends unique
names.

Values that are data use inline strict JSON:

```plain
# A value with an exact meaning.
- Required properties: ["id","name"].
- Its default annotation is {"enabled":true}.
```

A `#` line is not disposable trivia. It represents a string-valued
`description` member at that exact position. Descriptions containing line
breaks, surrounding whitespace, control characters, or unpaired surrogates use
the JSON-valued description clause instead. The `$comment` keyword remains a
distinct implementation-comment clause.

Schema-valued keywords nest directly:

```plain
- Its additional-property schema is:
  - No instance is accepted.
```

Properties use safe bare names and quote every other name as a JSON string:

```plain
- Properties:
  - name (required):
    # A person's full name.
    - allowed types:
      - string (must contain at least 1 character)
      - null
  - "display name":
    - allowed types:
      - string
```

Bare names match `[A-Za-z_][A-Za-z0-9_-]*`. The `(required)` marker replaces an
immediately following `required` member only when all of these conditions hold:

- the required array is valid, nonempty, and contains unique names;
- all names occur in a properties map with unique keys;
- their array order equals their order in the properties map; and
- `required` immediately follows `properties`.

If any condition fails—including orphan names, `required: []`, reversed order,
or duplicate members—the standalone `Required properties:` clause preserves the
original value and position.

An `allowed types:` block folds a `type` member and an immediately following
valid `minLength` member. One child reconstructs a scalar type; two or more
children reconstruct an ordered type array. A singleton type array therefore
uses the explicit JSON-valued type clause so it cannot be confused with a
scalar. Constraints are attached only to the applicable type:

```plain
- allowed types:
  - string (must contain at least 1 character)
  - null
```

Other maps and arrays of schemas retain explicit wrappers:

```plain

- At least one of these schemas must be satisfied:
  - Schema 1:
    - Its allowed type or types are "string".
  - Schema 2:
    - Its allowed type or types are "null".
```

Pattern, dependency, and definition names are JSON strings. Schema-array
positions are numbered from one and must remain sequential.

### Historical conversational leaf form

The version-1 parser also accepts an earlier conversational leaf form:

```plain
- Properties:
  - name (required), which must be a string containing at least 1 character, or null.
    # A person's full name.
```

The sentence vocabulary, articles, separators, and punctuation are grammar—not
free-form prose. Version-1 canonical output is now selected as the `structured`
style. The current `conversational` style is the version-2 grammar documented
below.

### Exact entries

The universal representation for one object member is:

```plain
- Its exact JSON Schema entry is ["keyword",<any JSON value>].
```

It is canonical for:

- unknown or custom keywords;
- all keywords under an unknown dialect;
- a known keyword whose value has the wrong shape;
- legacy behavior without an installed dialect profile.

The value is opaque. A nested object that happens to contain `$schema`, `type`,
or `properties` is never interpreted recursively.

### Dialect rules

A string-valued `$schema` selects the renderer profile for that schema resource.
Nested rendered schemas inherit their parent's profile unless they declare a
different `$schema`. Version 1 has a semantic profile only for:

```text
https://json-schema.org/draft/2020-12/schema
```

If the root omits `$schema`, APIs and the CLI default its out-of-band context to
that URI. This affects wording only; it never inserts or changes a JSON member.
Set the context to `null` / `--dialect none` for fully opaque output.

PlainType does not fetch dialect URIs, resolve references, infer vocabularies,
or validate instances.

### Round-trip equality

For a valid JSON Schema source `J`, the required law is:

```text
parseJson(toJsonSchema(fromJsonSchema(J, style))) = parseJson(J)
```

Equality covers decoded strings, arbitrary-precision decimal numbers, ordered
arrays, and object members. The implementation also retains raw number spelling,
object member sequence, and duplicate members.

It intentionally does not retain insignificant whitespace, a BOM, or alternate
string escape spelling. A future byte-faithful mode would need to carry source
tokens or the original document alongside PlainType; it is a different
contract from schema round-tripping.

Formatting is canonical and idempotent:

```text
format(format(PlainType, style), style) = format(PlainType, style)
```

## Version 2: conversational grammar

### Header, style, and document shape

A version-2 document starts with:

```plain
***plaintype 2***
```

It contains exactly one root schema bullet. The root may be a named object, a
named `oneOf` union, a boolean-schema marker, or an exact whole-schema escape.
Blank lines and two-space indentation follow the same lexical rules as version
1.

The API and CLI use style names to select the surface version:

- `structured` emits `***plaintype 1***` and is the `from-json` default.
- `conversational` emits `***plaintype 2***`.
- `format` with no style preserves the source header: version 1 becomes
  structured and version 2 remains conversational.
- An explicit format style converts to that style and its corresponding header.

Every header is always accepted by `to-json`, `check`, and the public parser.

### Object declarations

A named object and its properties have this canonical form:

```plain
- Animal: A record describing an animal.
  - name: The animal's name - a string containing at least one character.
  - nickname (optional): A familiar name - a string, or null.
  - owner (optional): The animal's current owner.
    - email: The owner's address - an email string.
```

An unconstrained declaration is an object by default. It needs neither an
`(object)` qualifier nor an `- an object` constraint. The parser continues to
accept the old `(object)` and `(optional, object)` qualifiers, but formatting
removes `object` from them.

Safe names match `[A-Za-z_][A-Za-z0-9_-]*`; every other name is a JSON string.
For leaf properties, the colon separates the declaration from the description,
and the final unquoted ` - ` separates that description from its constraint.
The final period belongs to the grammar. The description is preserved exactly
as written: the compiler does not add or remove description punctuation.

`(optional)` is exceptional. Every unmarked property is appended to the
object's `required` array, in property order. The same marker applies to an
optional nested object; objecthood follows from the absence of a constraint.

Every compact object expands in a fixed member order:

1. `title` for a named root or named union alternative; nested object
   properties do not acquire a title;
2. `type: "object"`;
3. `description`;
4. `properties`;
5. `required`; and
6. optional `$defs`; and
7. `additionalProperties`, unless explicitly left unspecified.

The `properties` and `required` members are emitted even when empty. The
renderer uses this form only when the input already has the same member order,
unique property names, and a unique required-name array in matching property
order. It never silently turns a missing JSON `required` keyword into “all
required.”

### Closed objects and additional properties

Objects authored in version 2 are closed by default. With no directive, the
parser adds an explicit final `additionalProperties: false` member.

Two final-child directives override that rule:

```plain
- OpenRecord: A record that accepts extensions.
  - id: Its identifier - a string.
  - Additional properties allowed

- SchemaDefaultRecord: A record using JSON Schema's own default.
  - id: Its identifier - a string.
  - Additional properties unspecified
```

`Additional properties allowed` emits explicit `additionalProperties: true`.
`Additional properties unspecified` emits no `additionalProperties` member,
retaining JSON Schema's own open default. A directive must be the object's last
child, and an object may contain at most one.

The renderer preserves the same three states: explicit `false` has no surface
directive, explicit `true` says `allowed`, and an absent keyword says
`unspecified`. A schema-valued `additionalProperties` does not fit the concise
object grammar and uses the exact escape.

### Leaf constraints

A concise leaf always expands to `description` followed by the constraint
members shown below, in exactly the listed order. Nullable phrases use the
ordered type array `[<principal type>, "null"]`.

| Constraint text | JSON Schema members after `description` |
| --- | --- |
| any strict JSON value, such as `"microchip"` | `const` |
| `one of "dog", "cat", or "bird"` | string-valued `enum` |
| `a string` | `type: "string"` |
| `a string, or null` | `type: ["string", "null"]` |
| `a string containing at least one character` | `type`, `minLength` |
| `a string of exactly 15 characters` | `type`, `minLength`, `maxLength` |
| `a string between 1 and 40 characters` | `type`, `minLength`, `maxLength` |
| `a string of exactly 15 digits` | `type`, the exact digit `pattern` |
| `a date in YYYY-MM-DD format` | `type: "string"`, `format: "date"` |
| `an email string` | `type: "string"`, `format: "email"` |
| `a UUID string` | `type: "string"`, `format: "uuid"` |
| `an integer` | `type: "integer"` |
| `a non-negative integer` | `type: "integer"`, `minimum: 0` |
| `an integer between 0 and 200` | `type`, `minimum`, `maximum` |
| `an Animal` | `$ref: "#/$defs/Animal"` |
| `an AnimalFamily` when that is the root name | `$ref: "#"` |
| `an array of Animal` | `type: "array"`, `items: {"$ref":"#/$defs/Animal"}` |
| `a reference to "URI"` | `$ref: "URI"` |

The string and integer forms may end in `, or null`. Counts and bounds retain
their JSON number tokens; canonical output spells the exact raw token `1` as
`one` where it forms a singular count (`at least one character`, for example).
Range endpoints remain numeric, as in `between 1 and 40 characters`. Inline
enums are nonempty, unique lists of JSON strings.
Other keyword combinations use the exact escape rather than being approximated.

Named schema constraints use uppercase-initial safe names matching
`[A-Z][A-Za-z0-9_-]*`. They are case-sensitive and resolve against the root
name or names in the root `Definitions:` section. They always mean schema reuse
via `$ref`. Consequently the canonical phrase is `an array of Animal`, not `an
array of Animal references`: the instance contains Animal values, while only
their schema is referenced. Unknown names are errors. Lowercase, quoted, and
external reference targets use `a reference to "URI"`; arrays using those
targets and arrays of inline object schemas use the exact escape for now.

### Reusable definitions

The reserved root child `Definitions:` maps to `$defs`. A definition's displayed
name is its `$defs` key and does not add a `title` to the definition schema.
Forward, mutual, and root-recursive references are allowed because names are
collected before constraints are parsed.

```plain
- AnimalFamily: A family tree for an animal
  - animal: The animal represented here - an Animal.
  - parents (optional): Its known parents - an array of Animal.
  - offspring (optional): Its known offspring - an array of AnimalFamily.

  - Definitions:
    - Animal: A reusable animal record
      - name: The animal's name - a string containing at least one character.
```

Concise definitions are currently root-scoped object schemas. A definition may
not have the root schema's name. Nested `$defs`, arbitrary reference URIs inside
arrays, and definition shapes outside the concise object grammar use the exact
escape. When present, `Definitions:` follows ordinary properties and precedes
the final additional-properties directive.

### Exactly-one unions

A compact `oneOf` schema is written:

```plain
- AnimalIdentifier: An identifier attached to an animal. Exactly one of:
  - Microchip: Identification using an implanted microchip.
    - kind: The identifier kind - "microchip".
  - CollarTag: Identification using a collar tag.
    - kind: The identifier kind - "collar-tag".
```

It expands, in order, to `title`, `description`, and `oneOf`. Each indented
alternative is itself a complete version-2 schema declaration. A displayed
alternative name is therefore a real `title`, not a cosmetic label. An
alternative that does not fit a concise declaration may use the exact escape.

### Exact whole-schema escape

The universal version-2 representation is:

```plain
- Exact JSON Schema: {"type":"number","multipleOf":0.25}
```

There is no decorative period after the JSON. The payload must be a JSON object
or boolean and is interpreted as one complete schema, not as a member value.
The renderer uses this form whenever a schema cannot be represented by an
entire concise plan without changing member order or values. This includes
unknown dialects, unsupported keyword combinations, duplicate members,
noncanonical ordering, unsafe inline descriptions, and distinctions such as a
singleton type array.

Boolean schemas retain their direct markers:

```plain
- Every instance is accepted.
- No instance is accepted.
```

The empty object schema is represented as `Exact JSON Schema: {}` in version 2.

### Version-2 round trips

Version 2 does not apply its authoring defaults while importing arbitrary JSON.
It first attempts an exact concise plan and otherwise transports the entire
schema opaquely. Therefore the same lossless law applies to both styles:

```text
parseJson(toJsonSchema(fromJsonSchema(J, style))) = parseJson(J)
```

The canonical examples are
[`animal-identifier.conversational.plaintype`](../examples/animal-identifier.conversational.plaintype)
and its fixed-order
[`animal-identifier.schema.json`](../examples/animal-identifier.schema.json), plus
the recursive pair
[`animal-family.conversational.plaintype`](../examples/animal-family.conversational.plaintype)
and [`animal-family.schema.json`](../examples/animal-family.schema.json).

## Version 3: ***plain-aligned grammar

Version 3 carries exactly the version-2 declaration model, but spells it with
the conventions of the [***plain](https://plainlang.org/docs/language-guide/basic-syntax)
specification language, so a PlainType file reads like a ***plain
`***definitions***` section. It adds two annotation sentences, for `default` and
`examples`, and it maps `>` comments to `$comment`.

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

### What comes from ***plain

| ***plain convention | Version 3 |
| --- | --- |
| Optional YAML frontmatter between `---` fences, first in the file | Accepted before the header. It is module metadata: the compiler ignores it, and `format` reproduces it verbatim when the output style is `plain`. Other styles have nowhere to keep it and drop it. |
| `***section***` headers | Declarations live in exactly one `***definitions***` section after the header. Any other section is an error, because a PlainType module only defines data. |
| Concepts written `:ConceptName:` using letters, digits, `+`, `-`, `.`, and `_` | Every named schema (the root, union alternatives, and definitions) is a concept: `- :Animal: A reusable animal record.` References name the concept: `an :Animal:`, `an array of :Animal:`. |
| Definitions start with the concept name; attributes are nested `Name - description` bullets | Properties are attributes: `- name - The animal's name - a string containing at least one character.` |
| Lines starting with `>` are comments | A comment inside `***definitions***` describes the declaration below it and compiles to that schema's `$comment`. See [Comments](#comments). Comments before the section are module notes: they are ignored, and `format` does not reproduce them. |
| Markdown links to files in the module's folder are linked resources | A `$ref` to a relative path inside the folder is written `a reference to [path](path)`. The link text must equal its target. Other references keep `a reference to "URI"`. |
| Liquid templates expand textually before interpretation | PlainType parses the expanded text. `{{ variable }}` placeholders, as used by the demo's templates, must be filled in before compiling. |

### Document shape

The header comes first, after any frontmatter, followed by the
`***definitions***` section. Its first bullet is the root schema. When the root
is a named object, the following bullets are its reusable `$defs`, in order:

```plain
***plaintype***

***definitions***

- :AnimalFamily: A family tree for an animal.
  - animal - The animal represented here - an :Animal:.
  - parents (optional) - Its known parents - an array of :Animal:.
  - offspring (optional) - Its known offspring - an array of :AnimalFamily:.

- :Animal: A reusable animal record.
  - name - The animal's name - a string containing at least one character.
```

That document expands in the version-2 fixed member order. `$defs` is placed
after `required` and before `additionalProperties`, so the root's
additional-properties directive stays the root's last child, above the
definitions. A union root, a boolean marker, and `Exact JSON Schema:` cannot be
followed by definitions.

Concept names follow ***plain's character set. A `title` or `$defs` key outside
it is still transported losslessly through `Exact JSON Schema:`. Property names
keep the version-2 rule: safe names are bare, and every other name is a JSON
string such as `"display name"`. The only declaration qualifier is
`(optional)`.

### Attributes

A property is `name - description - constraint.`. A property without a
constraint is a nested object whose attributes follow at the next indentation.
The first ` - ` after the name separates it from the description, and the last
unquoted ` - ` separates the description from the constraint. The constraint
vocabulary is exactly version 2's, with concept tokens in references.

### Defaults and examples

A leaf may end with up to two annotation sentences, in this order:

```plain
  - theme - The color theme - one of "light" or "dark". Defaults to "light". For example: "dark".
```

| Sentence | JSON Schema member, after the constraint members |
| --- | --- |
| `Defaults to <JSON>.` | `default` |
| `For example: <JSON list>.` | `examples`, a nonempty array |

Values are strict JSON. An example list uses the same separators as inline
enums: `"a"`, `"a" or "b"`, `"a", "b", or "c"`. Unlike enums, any JSON values
are allowed, including objects, arrays, and repeats. A leaf whose `default` and
`examples` appear in another order, or whose `examples` array is empty, uses
the exact escape.

### Comments

JSON Schema's `$comment` is a note for schema maintainers with no validation
effect. In version 3 it is written as `>` lines directly above the declaration
it belongs to: a root, union, alternative, definition, nested object, or leaf.

```plain
> This is a rough draft.
- :Button: A clickable control.
  > Product wants this configurable later.
  - borderColor - The color of its border - "red".
```

| Position | `$comment` member order |
| --- | --- |
| Object | after `description`, before `properties` |
| Union | after `description`, before `oneOf` |
| Leaf | after `description`, before the constraint members |

Consecutive `>` lines join with line breaks, and a bare `>` is an empty line.
One space after `>` is removed. Blank lines may separate a comment from its
declaration, but a comment must have a declaration after it. A comment cannot
describe a boolean marker, an `Exact JSON Schema:` clause, or an
additional-properties directive; an exact schema carries its own `$comment`
inside the JSON. A `$comment` in another position, or one containing control
characters or trailing whitespace on a line, uses the exact escape.

Comments between the header and `***definitions***` are module notes that do
not belong to any schema. They are ignored and not reproduced by `format`. Use
frontmatter for module notes that should survive formatting.

### Version-3 round trips

The lossless law and canonical formatting apply unchanged:

```text
parseJson(toJsonSchema(fromJsonSchema(J, "plain"))) = parseJson(J)
format(format(PlainType, "plain"), "plain") = format(PlainType, "plain")
```

`format` converts between versions 2 and 3 without changing the JSON Schema.
