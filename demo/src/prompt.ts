/**
 * The system prompt: task rules plus the version-2 grammar and examples read
 * from this repository, so the model always sees the language as shipped.
 * It is built once at boot and never varies, which keeps it cacheable.
 */

const repo = new URL("../../", import.meta.url);

async function read(path: string): Promise<string> {
  return Bun.file(new URL(path, repo)).text();
}

/** Version 3 reuses version 2's declaration model and constraint vocabulary, so both sections are needed. */
function compactGrammarSections(languageDoc: string): string {
  const start = languageDoc.indexOf("## Version 2: conversational grammar");
  return start === -1 ? languageDoc : languageDoc.slice(start);
}

const RULES = `You translate a short natural-language description of a data shape into a PlainType version-3 document, written as a template with named slots.

PlainType is controlled English that compiles deterministically to JSON Schema. Only the documented phrases are valid; anything else is a syntax error. Version 3 is written in ***plain syntax: named schemas are concepts like :Animal:, properties are attributes "name - description - constraint.", and everything sits in a ***definitions*** section. The grammar (the version-2 declaration model and constraint vocabulary, then the version-3 spelling) and examples follow these rules.

Output two things:

1. plaintypeTemplate: a complete PlainType version-3 document: the line "***plaintype***", a blank line, the line "***definitions***", a blank line, then the root concept and any reusable definitions after it. Wherever the document contains a value that the user chose in their description, write a slot placeholder {{slotName}} instead of the value.
2. slots: one entry per placeholder, {"name": slotName, "value": the exact text}, listed in the order the values appear in the natural-language description.

What becomes a slot:
- type names (the root name, alternative names, definition names), counts and numeric bounds, string constants, enum members, defaults, examples, and other specific values the user stated.
- The value must be copied character for character from the natural-language description, because the demo highlights it there. If the description says "red", the value is "red" and the template writes "{{borderColor}}" inside the JSON string quotes, as in: - "{{borderColor}}". A slotted concept name keeps its colons in the template: - :{{typeName}}: A clickable control.
- When the description gives a default value or an example (including "e.g.", "such as", "like"), use the "Defaults to …." and "For example: …." sentences after the constraint.
- Remarks about the description or the data rather than its shape (for example "This is a rough draft." or "We may change this later.") become ">" comment lines directly above the declaration they concern, which compile to $comment. A remark about the whole description goes above the root concept. Slot the comment text when it is copied verbatim, as in: > {{draftNote}}
- If a value cannot be copied verbatim from the description (for example the text says "one" but the grammar needs the digit 1), write it literally in the template instead of making it a slot.
- Do not slot grammar words, property descriptions, or punctuation.

Slot names are short lowerCamelCase identifiers matching [A-Za-z_][A-Za-z0-9_.-]* that describe the role of the value (borderColor, labelMax, typeName).

You will also receive the previous description, template, and values. Treat this as an edit: keep the existing structure, property names, descriptions, and slot names wherever the meaning is unchanged, and change only what the new description changes. Every placeholder in the template must have exactly one slot entry and every slot entry must be used.

Use only constraint phrases from the grammar. When the description asks for something the concise grammar cannot express, choose the closest concise phrase that is still faithful, or use the "Exact JSON Schema:" escape for that schema.`;

const HEAL_RULES = `You repair PlainType documents that a person edited by hand and that no longer compile.

PlainType is controlled English that compiles deterministically to JSON Schema. Only the documented phrases are valid. You receive the document and the compiler's error. Return plaintype: the complete corrected document, written as PlainType version 3 (the line "***plaintype***", a blank line, "***definitions***", a blank line, then the definitions).

- Make the smallest change that makes the document valid. Keep every concept name, property name, description, comment, value, and number exactly as the person wrote them, and keep their intended meaning.
- Fix only what the grammar does not allow: wrong or misspelled constraint phrases, missing punctuation or separators, indentation, a missing header or section, version-1 or version-2 spellings.
- When the person wrote a constraint in their own words, rewrite it as the closest grammar phrase with the same meaning, keeping their numbers and strings.
- Never add properties, examples, or defaults the person did not write, and never drop ones they did.`;

/** The healer shares the grammar and examples, under its own rules. */
export async function buildHealPrompt(): Promise<string> {
  const translatePrompt = await buildSystemPrompt();
  return `${HEAL_RULES}\n${translatePrompt.slice(translatePrompt.indexOf("<grammar>"))}`;
}

export async function buildSystemPrompt(): Promise<string> {
  const [languageDoc, identifier, family, settings, identifierJson] = await Promise.all([
    read("docs/language.md"),
    read("examples/animal-identifier.plain.plaintype"),
    read("examples/animal-family.plain.plaintype"),
    read("examples/display-settings.plain.plaintype"),
    read("examples/animal-identifier.schema.json"),
  ]);
  return [
    RULES,
    "<grammar>",
    compactGrammarSections(languageDoc).trim(),
    "</grammar>",
    "<example name=\"animal-identifier.plaintype\">",
    identifier.trim(),
    "</example>",
    "<example name=\"animal-identifier.schema.json\" note=\"what the example above compiles to\">",
    identifierJson.trim(),
    "</example>",
    "<example name=\"animal-family.plaintype\">",
    family.trim(),
    "</example>",
    "<example name=\"display-settings.plaintype\">",
    settings.trim(),
    "</example>",
    "<example name=\"template with slots\">",
    "Description: This is a rough draft. A Button is a clickable control. Its label is between 1 and 24 characters long, like \"Buy now\", and its border is always red.",
    "plaintypeTemplate:",
    "***plaintype***",
    "",
    "***definitions***",
    "",
    "> {{draftNote}}",
    "- :{{typeName}}: A clickable control.",
    "  - label - The text shown on the control - a string between {{labelMin}} and {{labelMax}} characters. For example: \"{{labelExample}}\".",
    "  - borderColor - The color of its border - \"{{borderColor}}\".",
    "slots: draftNote=This is a rough draft., typeName=Button, labelMin=1, labelMax=24, labelExample=Buy now, borderColor=red",
    "</example>",
  ].join("\n");
}

const INSTANCE_NOTATION = `PlainType data notation (one JSON value, usually an object):

***plaintype data 1***

- :Button:
  - label - "Buy now"
  - priority - 2
  - tags - ["sale","cta"]
  - owner
    - name - "Ada"
  - history
    - #1 - "created"
    - #2
      - at - "2026-10-19"

- The first line is exactly "***plaintype data 1***", then a blank line, then one root bullet labelled with the schema's concept name, such as - :Button:.
- A member is "key - <JSON value>", or a bare "key" whose indented children are its members or its numbered list items "#1", "#2", …
- Values are strict JSON: strings in double quotes, numbers, true, false, null. Empty containers are written inline as {} and [].
- Keys that are not simple identifiers are JSON strings: - "display name" - "Ada".
- Indentation is two spaces per level. Lines starting with > are comments.`;

const INSTANCE_RULES = `You write one instance of a data schema from a short natural-language description. The schema is given in PlainType (controlled English for JSON Schema); its grammar follows these rules. The instance is written in PlainType data notation, as a template with named slots.

Output two things:

1. instanceTemplate: a complete PlainType data document for the description. Wherever it contains a value the user stated, write a slot placeholder {{slotName}} instead: inside the quotes for strings ("{{label}}"), bare for numbers and booleans ({{priority}}).
2. slots: one entry per placeholder, {"name": slotName, "value": the exact text}, in the order the values appear in the description. Copy each value character for character from the description. If a value cannot be copied verbatim (the text says "two" but the JSON needs 2), write it literally in the template instead of making it a slot.

Use the schema's property names, nesting, and JSON types exactly. Include properties the description states; include required properties even when the description is silent, choosing a sensible value and writing it literally. Do not add properties the schema does not define. Keep the user's values even when they break a schema constraint; the user sees validation results.

You also receive the previous description, template, and slots. Treat this as an edit: keep slot names and structure wherever the meaning is unchanged. Values ending in … are folded long strings: return them unchanged under the same slot name to keep their full text.`;

const INSTANCE_HEAL_RULES = `You repair PlainType data documents that a person edited by hand and that no longer parse. You receive the document and the parser's error. Return plaintype: the complete corrected document.

- Make the smallest change that makes the document parse. Keep every key, value, and comment exactly as written, including strings that end in … (they are folded long strings and must stay as they are).
- Fix only notation: the header line, bullets, indentation, the " - " separator, list numbering, and JSON syntax such as missing quotes or trailing commas.
- Never add or drop members.`;

function grammarAndNotation(translatePrompt: string): string {
  return `${INSTANCE_NOTATION}\n${translatePrompt.slice(translatePrompt.indexOf("<grammar>"))}`;
}

export async function buildInstancePrompt(): Promise<string> {
  return `${INSTANCE_RULES}\n\n${grammarAndNotation(await buildSystemPrompt())}`;
}

export async function buildInstanceHealPrompt(): Promise<string> {
  return `${INSTANCE_HEAL_RULES}\n\n${INSTANCE_NOTATION}`;
}
