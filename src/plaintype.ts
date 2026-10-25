import {
  DRAFT_2020_12,
  SCHEMA_ARRAY_CODECS_2020_12,
  SCHEMA_CODECS_2020_12,
  SCHEMA_MAP_CODECS_2020_12,
  VALUE_CODECS_2020_12,
  schemaMapContainsOnlySchemas,
  type SchemaArrayCodec,
  type SchemaCodec,
  type SchemaMapCodec,
  type ValueCodec,
} from "./codecs.js";
import {
  arrayNode,
  isSchemaNode,
  jsonString,
  objectNode,
  parseJson,
  stringifyJson,
  type JsonNode,
  type JsonObject,
  type JsonObjectEntry,
} from "./json.js";

const HEADER_V1 = "***plaintype 1***";
const HEADER_V2 = "***plaintype 2***";
const HEADER_V3 = "***plaintype***";
const V3_DEFINITIONS_SECTION = "***definitions***";
const V3_DEFAULT_LEAD = ". Defaults to ";
const V3_EXAMPLES_LEAD = ". For example: ";
const V3_SENSITIVE_LEAD = ". Sensitive";
const FRONTMATTER_FENCE = "---";
const ALLOW_ALL = "Every instance is accepted.";
const DENY_ALL = "No instance is accepted.";
const EMPTY_SCHEMA = "No constraints or annotations are specified.";
const EXACT_ENTRY_LEAD = "Its exact JSON Schema entry is";
const PROPERTIES_CLAUSE = "Properties:";
const ALLOWED_TYPES_CLAUSE = "allowed types:";
const LEGACY_REQUIRED_LEAD = "Its required property names are";
const V2_EXACT_SCHEMA_LEAD = "Exact JSON Schema:";
const V2_ADDITIONAL_ALLOWED = "Additional properties allowed";
const V2_ADDITIONAL_UNSPECIFIED = "Additional properties unspecified";
const V2_DEFINITIONS = "Definitions:";
const V2_UNION_SUFFIX = " Exactly one of:";

/** The types whose `["<type>", "null"]` array a leaf writes as `, or null`. */
const V2_NULLABLE_TYPES: readonly string[] = ["string", "integer"];
const V3_NULLABLE_TYPES: readonly string[] = ["string", "integer", "number", "boolean"];

/**
 * Version 3: the leaf constraints that can be an array's items, each with the
 * plural it takes after `an array of`. Constraints with a count, a range or an
 * enumeration have no plural, and an array of them is written in the escape.
 */
const V3_ARRAY_ELEMENTS: ReadonlyMap<string, string> = new Map([
  ["a string", "strings"],
  ["an integer", "integers"],
  ["a number", "numbers"],
  ["a boolean", "booleans"],
  ["a non-negative integer", "non-negative integers"],
  ["a non-negative number", "non-negative numbers"],
  ["an email string", "email strings"],
  ["a URL string", "URL strings"],
  ["a date-time string", "date-time strings"],
  ["a UUID string", "UUID strings"],
  ["a date in YYYY-MM-DD format", "dates in YYYY-MM-DD format"],
]);
const V3_ARRAY_ELEMENT_BY_PLURAL: ReadonlyMap<string, string> = new Map(
  [...V3_ARRAY_ELEMENTS].map(([singular, plural]) => [plural, singular]),
);

type PlainTypeVersion = 1 | 2 | 3;
/** The two grammars that share the compact declaration model. */
type ConversationalVersion = 2 | 3;

export type RenderStyle = "structured" | "conversational" | "plain";

/**
 * Names the schemas of a library that lives outside the module, so a version-3
 * document can say `a :Currency:` for a schema it does not declare. Each
 * answer is the caller's: a name it cannot resolve, or a `$ref` it has no name
 * for, is `null`. Only the `plain` style (version 3) has concepts to bind.
 */
export interface ConceptBinding {
  /** The `$ref` a concept used but not declared in the module stands for, e.g. `sys0:Currency`. */
  ref(name: string): string | null;
  /** The concept a `$ref` is written as when rendering, or null to keep `a reference to "…"`. */
  concept(ref: string): string | null;
}

export interface ParseOptions {
  /** External concepts. Without it, a concept the module does not declare is an error. */
  readonly concepts?: ConceptBinding;
}

export interface FromJsonOptions {
  /**
   * Dialect used when the root schema has no string-valued `$schema`.
   * Set to null to force opaque rendering in that case.
   */
  readonly defaultDialect?: string | null;
  /**
   * Canonical surface form. `structured` uses the v1 grammar and is the
   * default; `conversational` uses the compact v2 grammar; `plain` uses the
   * v3 grammar, which follows ***plain's concept and section syntax.
   */
  readonly style?: RenderStyle;
  /**
   * External concepts. Rendering writes a `$ref` the binding names as that
   * concept (`a :Currency:`); `formatPlainType` parses with the same binding.
   */
  readonly concepts?: ConceptBinding;
}

export interface ToJsonOptions extends ParseOptions {
  /** Number of spaces in emitted JSON. Defaults to 2; use 0 for compact JSON. */
  readonly space?: number;
}

export class PlainTypeSyntaxError extends SyntaxError {
  public readonly line: number;

  public constructor(message: string, line: number) {
    super(`${message} at line ${line}`);
    this.name = "PlainTypeSyntaxError";
    this.line = line;
  }
}

interface Bullet {
  readonly text: string;
  readonly line: number;
  readonly children: Bullet[];
}

interface RenderProfile {
  readonly values: readonly ValueCodec[];
  readonly schemas: readonly SchemaCodec[];
  readonly maps: readonly SchemaMapCodec[];
  readonly arrays: readonly SchemaArrayCodec[];
}

const DRAFT_2020_12_PROFILE: RenderProfile = {
  values: VALUE_CODECS_2020_12,
  schemas: SCHEMA_CODECS_2020_12,
  maps: SCHEMA_MAP_CODECS_2020_12,
  arrays: SCHEMA_ARRAY_CODECS_2020_12,
};

const NO_PROFILE: RenderProfile = { values: [], schemas: [], maps: [], arrays: [] };

/** Convert a JSON Schema JSON document into canonical PlainType. */
export function fromJsonSchema(json: string, options: FromJsonOptions = {}): string {
  const schema = parseJson(json);
  if (!isSchemaNode(schema)) {
    throw new TypeError("A JSON Schema document must have an object or boolean at its root");
  }
  const fallbackDialect = options.defaultDialect === undefined ? DRAFT_2020_12 : options.defaultDialect;
  const dialect = dialectDeclaredBy(schema) ?? fallbackDialect;
  const style = options.style ?? "structured";
  return `${renderDocumentLines(schema, dialect, style, options.concepts).join("\n")}\n`;
}

function renderDocumentLines(
  schema: JsonNode,
  dialect: string | null,
  style: RenderStyle,
  concepts: ConceptBinding | undefined,
): string[] {
  switch (style) {
    case "plain":
      return [HEADER_V3, "", V3_DEFINITIONS_SECTION, "", ...renderSchemaV2(schema, 0, dialect, 3, concepts)];
    case "conversational":
      return [HEADER_V2, "", ...renderSchemaV2(schema, 0, dialect, 2)];
    case "structured":
      return [HEADER_V1, "", ...renderSchema(schema, 0, dialect, style)];
  }
}

/** Convert PlainType into canonical JSON Schema JSON. */
export function toJsonSchema(source: string, options: ToJsonOptions = {}): string {
  const schema = parsePlainType(source, options);
  const space = options.space ?? 2;
  return `${stringifyJson(schema, space)}\n`;
}

/** Parse PlainType into the lossless JSON AST used by the converter. */
export function parsePlainType(source: string, options: ParseOptions = {}): JsonNode {
  return parsePlainTypeDocument(source, options.concepts).schema;
}

interface ParsedDocument {
  readonly version: PlainTypeVersion;
  readonly schema: JsonNode;
  /** The verbatim YAML frontmatter block, fences included (version 3 only). */
  readonly frontmatter: string | null;
}

function parsePlainTypeDocument(source: string, concepts?: ConceptBinding): ParsedDocument {
  const normalized = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = normalized.split("\n");
  let headerIndex = skipBlankLines(lines, 0);

  // ***plain modules may open with YAML frontmatter. It is module metadata, not
  // schema data, so it is carried through formatting but never compiled.
  let frontmatter: string | null = null;
  const frontmatterLine = headerIndex + 1;
  if (lines[headerIndex] === FRONTMATTER_FENCE) {
    const close = lines.indexOf(FRONTMATTER_FENCE, headerIndex + 1);
    if (close < 0) throw new PlainTypeSyntaxError("Unclosed YAML frontmatter", frontmatterLine);
    frontmatter = lines.slice(headerIndex, close + 1).join("\n");
    headerIndex = skipBlankLines(lines, close + 1);
  }

  const header = lines[headerIndex];
  const version: PlainTypeVersion = header === HEADER_V1
    ? 1
    : header === HEADER_V2
      ? 2
      : header === HEADER_V3
        ? 3
        : (() => {
            throw new PlainTypeSyntaxError(`Expected ${HEADER_V1}, ${HEADER_V2}, or ${HEADER_V3}`, headerIndex + 1);
          })();
  if (frontmatter !== null && version !== 3) {
    throw new PlainTypeSyntaxError(`YAML frontmatter requires ${HEADER_V3}`, frontmatterLine);
  }

  const v3Body = version === 3 ? stripV3SectionsAndComments(lines, headerIndex + 1) : null;
  const bullets = parseBullets(v3Body?.lines ?? lines, headerIndex + 1);
  if (bullets.length === 0) {
    throw new PlainTypeSyntaxError("Expected at least one schema clause", headerIndex + 2);
  }
  const schema = v3Body !== null
    ? schemaFromV3Bullets(bullets, v3Body.comments, concepts)
    : version === 2
      ? schemaFromV2Bullets(bullets)
      : schemaFromBullets(bullets);
  return { version, schema, frontmatter };
}

function skipBlankLines(lines: readonly string[], start: number): number {
  let index = start;
  while (index < lines.length && lines[index]?.trim() === "") {
    if (lines[index]?.includes("\t")) {
      throw new PlainTypeSyntaxError("Tabs are not allowed for indentation", index + 1);
    }
    index += 1;
  }
  return index;
}

/**
 * Version 3 follows ***plain's file layout: `>` lines are comments, and the
 * declarations live in the one `***definitions***` section. Both are blanked
 * here (keeping line numbers) so the shared bullet parser sees only clauses.
 *
 * A comment inside the section describes the declaration that follows it and
 * becomes that schema's `$comment`; consecutive lines join with line breaks.
 * Comments before the section are module notes and are not compiled.
 */
function stripV3SectionsAndComments(
  lines: readonly string[],
  start: number,
): { lines: string[]; comments: Map<number, string> } {
  const result = [...lines];
  const comments = new Map<number, string>();
  let pending: string[] = [];
  let pendingLine = 0;
  let sawSection = false;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const comment = /^ *>( ?)([\s\S]*)$/.exec(line);
    if (comment !== null) {
      if (line.includes("\t")) throw new PlainTypeSyntaxError("Tabs are not allowed in comments", index + 1);
      if (sawSection) {
        if (pending.length === 0) pendingLine = index + 1;
        pending.push(comment[2] ?? "");
      }
      result[index] = "";
      continue;
    }
    const section = /^\*\*\*([^*]+)\*\*\*$/.exec(line);
    if (section !== null) {
      if (line !== V3_DEFINITIONS_SECTION) {
        throw new PlainTypeSyntaxError(
          `A PlainType module contains only ${V3_DEFINITIONS_SECTION}; found ***${section[1] ?? ""}***`,
          index + 1,
        );
      }
      if (sawSection) throw new PlainTypeSyntaxError(`Duplicate ${V3_DEFINITIONS_SECTION} section`, index + 1);
      sawSection = true;
      result[index] = "";
      continue;
    }
    if (!sawSection && line.trim() !== "") {
      throw new PlainTypeSyntaxError(`Expected ${V3_DEFINITIONS_SECTION} before the first definition`, index + 1);
    }
    if (line.trim() !== "" && pending.length > 0) {
      comments.set(index + 1, pending.join("\n"));
      pending = [];
    }
  }
  if (!sawSection) throw new PlainTypeSyntaxError(`Expected a ${V3_DEFINITIONS_SECTION} section`, start + 1);
  if (pending.length > 0) {
    throw new PlainTypeSyntaxError("A comment must be followed by the declaration it describes", pendingLine);
  }
  return { lines: result, comments };
}

const STYLE_FOR_VERSION: Readonly<Record<PlainTypeVersion, RenderStyle>> = {
  1: "structured",
  2: "conversational",
  3: "plain",
};

/** Canonicalize an already-authored PlainType document. */
export function formatPlainType(source: string, options: FromJsonOptions = {}): string {
  const parsed = parsePlainTypeDocument(source, options.concepts);
  const schema = parsed.schema;
  const fallbackDialect = options.defaultDialect === undefined ? DRAFT_2020_12 : options.defaultDialect;
  const dialect = dialectDeclaredBy(schema) ?? fallbackDialect;
  const style = options.style ?? STYLE_FOR_VERSION[parsed.version];
  const lines = renderDocumentLines(schema, dialect, style, options.concepts);
  // Frontmatter is v3 module metadata; other grammars have nowhere to keep it.
  const frontmatter = style === "plain" && parsed.frontmatter !== null ? [parsed.frontmatter, ""] : [];
  return `${[...frontmatter, ...lines].join("\n")}\n`;
}

function renderSchema(
  node: JsonNode,
  depth: number,
  inheritedDialect: string | null,
  style: RenderStyle,
): string[] {
  const prefix = indent(depth);
  if (node.type === "boolean") return [`${prefix}- ${node.value ? ALLOW_ALL : DENY_ALL}`];
  if (node.type !== "object") throw new TypeError("A subschema must be an object or boolean");
  if (node.entries.length === 0) return [`${prefix}- ${EMPTY_SCHEMA}`];

  const dialect = dialectDeclaredBy(node) ?? inheritedDialect;
  const profile = dialect === DRAFT_2020_12 ? DRAFT_2020_12_PROFILE : NO_PROFILE;
  const lines: string[] = [];
  for (let index = 0; index < node.entries.length; index += 1) {
    const entry = node.entries[index];
    if (entry === undefined) continue;
    const next = node.entries[index + 1];
    const foldedRequired = dialect === DRAFT_2020_12 ? foldableRequiredNames(entry, next) : null;
    if (foldedRequired !== null) {
      lines.push(...renderProperties(entry.value as JsonObject, foldedRequired, depth, dialect, style));
      index += 1;
      continue;
    }
    lines.push(...renderEntry(entry, depth, dialect, profile, style));
  }
  return lines;
}

function renderEntry(
  entry: JsonObjectEntry,
  depth: number,
  dialect: string | null,
  profile: RenderProfile,
  style: RenderStyle,
): string[] {
  const schemaMapCodec = profile.maps.find(({ keyword }) => keyword === entry.key);
  if (
    schemaMapCodec !== undefined &&
    entry.value.type === "object" &&
    schemaMapContainsOnlySchemas(entry.value)
  ) {
    if (entry.key === "properties") {
      return renderProperties(entry.value, [], depth, dialect, style);
    }
    return renderSchemaMap(entry.value, schemaMapCodec, depth, dialect, style);
  }

  const schemaCodec = profile.schemas.find(({ keyword }) => keyword === entry.key);
  if (schemaCodec !== undefined && isSchemaNode(entry.value)) {
    return [
      `${indent(depth)}- ${schemaCodec.clause}`,
      ...renderSchema(entry.value, depth + 1, dialect, style),
    ];
  }

  const schemaArrayCodec = profile.arrays.find(({ keyword }) => keyword === entry.key);
  if (
    schemaArrayCodec !== undefined &&
    entry.value.type === "array" &&
    entry.value.items.length > 0 &&
    entry.value.items.every(isSchemaNode)
  ) {
    return renderSchemaArray(entry.value.items, schemaArrayCodec, depth, dialect, style);
  }

  const valueCodec = profile.values.find(({ keyword }) => keyword === entry.key);
  if (valueCodec !== undefined && valueCodec.accepts(entry.value)) {
    if (entry.key === "description" && entry.value.type === "string" && isSafeDescriptionComment(entry.value.value)) {
      return [`${indent(depth)}#${entry.value.value === "" ? "" : ` ${entry.value.value}`}`];
    }
    return [`${indent(depth)}- ${valueCodec.lead} ${stringifyJson(entry.value)}.`];
  }

  const exactPair = arrayNode([
    { type: "string", value: entry.key },
    entry.value,
  ]);
  return [`${indent(depth)}- ${EXACT_ENTRY_LEAD} ${stringifyJson(exactPair)}.`];
}

function foldableRequiredNames(
  propertiesEntry: JsonObjectEntry,
  requiredEntry: JsonObjectEntry | undefined,
): readonly string[] | null {
  if (
    propertiesEntry.key !== "properties" ||
    propertiesEntry.value.type !== "object" ||
    !schemaMapContainsOnlySchemas(propertiesEntry.value) ||
    requiredEntry?.key !== "required" ||
    requiredEntry.value.type !== "array" ||
    requiredEntry.value.items.length === 0 ||
    !requiredEntry.value.items.every((item) => item.type === "string")
  ) {
    return null;
  }

  const propertyNames = propertiesEntry.value.entries.map(({ key }) => key);
  if (new Set(propertyNames).size !== propertyNames.length) return null;
  const requiredNames = requiredEntry.value.items.map((item) => item.type === "string" ? item.value : "");
  if (new Set(requiredNames).size !== requiredNames.length) return null;
  const requiredSet = new Set(requiredNames);
  if (requiredNames.some((name) => !propertyNames.includes(name))) return null;
  const namesInPropertyOrder = propertyNames.filter((name) => requiredSet.has(name));
  return arraysEqual(namesInPropertyOrder, requiredNames) ? requiredNames : null;
}

function renderProperties(
  value: JsonObject,
  requiredNames: readonly string[],
  depth: number,
  dialect: string | null,
  style: RenderStyle,
): string[] {
  const required = new Set(requiredNames);
  const lines = [`${indent(depth)}- ${PROPERTIES_CLAUSE}`];
  for (const entry of value.entries) {
    const name = renderPropertyName(entry.key);
    const requiredMarker = required.has(entry.key) ? " (required)" : "";
    const conversational = style === "conversational"
      ? conversationalPropertyConstraint(entry.value, dialect)
      : null;
    if (conversational !== null) {
      lines.push(`${indent(depth + 1)}- ${name}${requiredMarker}, ${conversational.sentence}`);
      for (const description of conversational.leadingDescriptions) {
        lines.push(`${indent(depth + 2)}#${description === "" ? "" : ` ${description}`}`);
      }
      continue;
    }
    lines.push(`${indent(depth + 1)}- ${name}${requiredMarker}:`);
    lines.push(...renderPropertySchema(entry.value, depth + 2, dialect, style));
  }
  return lines;
}

function renderPropertySchema(
  node: JsonNode,
  depth: number,
  inheritedDialect: string | null,
  style: RenderStyle,
): string[] {
  if (node.type !== "object" || node.entries.length === 0) {
    return renderSchema(node, depth, inheritedDialect, style);
  }
  const dialect = dialectDeclaredBy(node) ?? inheritedDialect;
  const profile = dialect === DRAFT_2020_12 ? DRAFT_2020_12_PROFILE : NO_PROFILE;
  const lines: string[] = [];
  for (let index = 0; index < node.entries.length; index += 1) {
    const entry = node.entries[index];
    if (entry === undefined) continue;
    const next = node.entries[index + 1];
    const foldedRequired = dialect === DRAFT_2020_12 ? foldableRequiredNames(entry, next) : null;
    if (foldedRequired !== null) {
      lines.push(...renderProperties(entry.value as JsonObject, foldedRequired, depth, dialect, style));
      index += 1;
      continue;
    }
    const group = typeConstraintGroup(entry, next, profile);
    if (group !== null) {
      lines.push(...renderAllowedTypes(group.types, group.minLength, depth));
      if (group.minLength !== null) index += 1;
      continue;
    }
    lines.push(...renderEntry(entry, depth, dialect, profile, style));
  }
  return lines;
}

interface TypeConstraintGroup {
  readonly types: readonly string[];
  readonly minLength: JsonNode | null;
}

function typeConstraintGroup(
  typeEntry: JsonObjectEntry,
  nextEntry: JsonObjectEntry | undefined,
  profile: RenderProfile,
): TypeConstraintGroup | null {
  if (typeEntry.key !== "type") return null;
  const typeCodec = profile.values.find(({ keyword }) => keyword === "type");
  if (typeCodec === undefined || !typeCodec.accepts(typeEntry.value)) return null;
  let types: string[];
  if (typeEntry.value.type === "string") {
    types = [typeEntry.value.value];
  } else if (
    typeEntry.value.type === "array" &&
    typeEntry.value.items.length > 1 &&
    typeEntry.value.items.every((item) => item.type === "string")
  ) {
    types = typeEntry.value.items.map((item) => item.type === "string" ? item.value : "");
  } else {
    // A one-item JSON array must remain distinguishable from a scalar type.
    return null;
  }

  const minCodec = profile.values.find(({ keyword }) => keyword === "minLength");
  const minLength =
    types.includes("string") &&
    nextEntry?.key === "minLength" &&
    minCodec !== undefined &&
    minCodec.accepts(nextEntry.value)
      ? nextEntry.value
      : null;
  return { types, minLength };
}

function renderAllowedTypes(
  types: readonly string[],
  minLength: JsonNode | null,
  depth: number,
): string[] {
  const lines = [`${indent(depth)}- ${ALLOWED_TYPES_CLAUSE}`];
  for (const type of types) {
    let constraint = "";
    if (type === "string" && minLength?.type === "number") {
      constraint = ` (must contain at least ${minLength.raw} ${isMathematicalOne(minLength.raw) ? "character" : "characters"})`;
    }
    lines.push(`${indent(depth + 1)}- ${type}${constraint}`);
  }
  return lines;
}

interface ConversationalPropertyConstraint {
  readonly sentence: string;
  readonly leadingDescriptions: readonly string[];
}

function conversationalPropertyConstraint(
  node: JsonNode,
  inheritedDialect: string | null,
): ConversationalPropertyConstraint | null {
  if (node.type === "boolean") {
    return {
      sentence: node.value ? "which accepts every value." : "which accepts no value.",
      leadingDescriptions: [],
    };
  }
  if (node.type !== "object") return null;
  if (node.entries.length === 0) return { sentence: "which has no constraints.", leadingDescriptions: [] };
  const dialect = dialectDeclaredBy(node) ?? inheritedDialect;
  if (dialect !== DRAFT_2020_12) return null;
  const leadingDescriptions: string[] = [];
  let offset = 0;
  while (true) {
    const entry = node.entries[offset];
    if (
      entry?.key !== "description" ||
      entry.value.type !== "string" ||
      !isSafeDescriptionComment(entry.value.value)
    ) {
      break;
    }
    leadingDescriptions.push(entry.value.value);
    offset += 1;
  }
  const first = node.entries[offset];
  if (first === undefined) return null;
  const group = typeConstraintGroup(first, node.entries[offset + 1], DRAFT_2020_12_PROFILE);
  if (group === null) return null;
  const expectedLength = offset + (group.minLength === null ? 1 : 2);
  if (node.entries.length !== expectedLength) return null;
  return {
    sentence: `which must be ${joinConversationalTypes(group.types, group.minLength)}.`,
    leadingDescriptions,
  };
}

function joinConversationalTypes(types: readonly string[], minLength: JsonNode | null): string {
  const phrases = types.map((type) => conversationalType(type, minLength));
  if (phrases.length === 1) return phrases[0] ?? "";
  if (phrases.length === 2) return `${phrases[0]}, or ${phrases[1]}`;
  return `${phrases.slice(0, -1).join(", ")}, or ${phrases.at(-1)}`;
}

function conversationalType(type: string, minLength: JsonNode | null): string {
  if (type === "null") return "null";
  const article = type === "array" || type === "integer" || type === "object" ? "an" : "a";
  const length = type === "string" && minLength?.type === "number"
    ? ` containing at least ${minLength.raw} ${isMathematicalOne(minLength.raw) ? "character" : "characters"}`
    : "";
  return `${article} ${type}${length}`;
}

function renderPropertyName(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(name) ? name : jsonString(name);
}

function isSafeDescriptionComment(value: string): boolean {
  return value === value.trim() &&
    !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(value) &&
    !hasUnpairedSurrogate(value);
}

function isSafeV2InlineDescription(value: string): boolean {
  return isSafeDescriptionComment(value) &&
    lastUnquotedSeparator(`${value} - "probe"`, " - ") === value.length;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isMathematicalOne(raw: string): boolean {
  const node = parseJson(raw);
  if (node.type !== "number") return false;
  const match = /^(-)?(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(node.raw);
  if (match === null || match[1] === "-") return false;
  const fraction = match[3] ?? "";
  const digits = `${match[2]}${fraction}`.replace(/^0+/, "") || "0";
  const exponent = BigInt(match[4] ?? "0") - BigInt(fraction.length);
  if (digits === "1" && exponent === 0n) return true;
  if (!/^10*$/.test(digits)) return false;
  return exponent + BigInt(digits.length - 1) === 0n;
}

function renderSchemaMap(
  value: JsonObject,
  codec: SchemaMapCodec,
  depth: number,
  dialect: string | null,
  style: RenderStyle,
): string[] {
  const lines = [`${indent(depth)}- ${codec.clause}`];
  for (const entry of value.entries) {
    lines.push(`${indent(depth + 1)}- ${codec.itemLabel} ${jsonString(entry.key)}:`);
    lines.push(...renderSchema(entry.value, depth + 2, dialect, style));
  }
  return lines;
}

function renderSchemaArray(
  items: readonly JsonNode[],
  codec: SchemaArrayCodec,
  depth: number,
  dialect: string | null,
  style: RenderStyle,
): string[] {
  const lines = [`${indent(depth)}- ${codec.clause}`];
  items.forEach((item, index) => {
    lines.push(`${indent(depth + 1)}- ${codec.itemLabel} ${index + 1}:`);
    lines.push(...renderSchema(item, depth + 2, dialect, style));
  });
  return lines;
}

interface V2ObjectPlan {
  readonly name: string | null;
  readonly description: string;
  /** Version 3: `$comment`, rendered as `>` lines above the declaration. */
  readonly comment: string | null;
  readonly properties: JsonObject;
  readonly requiredNames: readonly string[];
  readonly definitions: JsonObject | null;
  readonly additionalMode: "closed" | "allowed" | "unspecified";
}

interface V2LeafPlan {
  readonly description: string;
  readonly comment: string | null;
  readonly constraint: string;
  /** Version 3 only: trailing ` Sensitive. Defaults to …. For example: ….` sentences. */
  readonly annotations: string;
}

interface V2UnionPlan {
  readonly name: string;
  readonly description: string;
  readonly comment: string | null;
  readonly alternatives: readonly JsonNode[];
}

interface V2Declaration {
  readonly name: string;
  readonly optional: boolean;
  readonly object: boolean;
  readonly body: string;
}

interface V2ReferenceContext {
  readonly rootName: string | null;
  readonly definitionNames: ReadonlySet<string>;
  /** Version 3: `$comment` text keyed by the line of the declaration it precedes. */
  readonly comments?: ReadonlyMap<number, string>;
  /** Version 3: schemas named outside the module. */
  readonly concepts?: ConceptBinding;
}

/** Render the compact version-2 conversational grammar, with an exact universal escape. */
function renderSchemaV2(
  node: JsonNode,
  depth: number,
  inheritedDialect: string | null,
  version: ConversationalVersion,
  concepts?: ConceptBinding,
): string[] {
  if (node.type === "boolean") {
    return [`${indent(depth)}- ${node.value ? ALLOW_ALL : DENY_ALL}`];
  }
  if (node.type !== "object") return renderV2ExactSchema(node, depth);
  const dialect = dialectDeclaredBy(node) ?? inheritedDialect;
  const context = v2ReferenceContextFromSchema(node, version === 3 ? concepts : undefined);
  if (context === null) return renderV2ExactSchema(node, depth);
  if (dialect === DRAFT_2020_12) {
    const union = v2UnionPlan(node, version);
    if (union !== null) return renderV2Union(union, depth, dialect, context, version);
    const object = v2ObjectPlan(node, true, context, true, version);
    if (object !== null) return renderV2Object(object, depth, dialect, false, false, context, version);
    const leaf = version === 3 ? v3NamedLeafPlan(node, context) : null;
    if (leaf !== null) return renderV3NamedLeaf(leaf.name, leaf.plan, depth);
  }
  return renderV2ExactSchema(node, depth);
}

function renderV2SchemaAlternative(
  node: JsonNode,
  depth: number,
  dialect: string | null,
  context: V2ReferenceContext,
  version: ConversationalVersion,
): string[] {
  if (node.type === "object" && dialect === DRAFT_2020_12) {
    const union = v2UnionPlan(node, version);
    if (union !== null) return renderV2Union(union, depth, dialect, context, version);
    const object = v2ObjectPlan(node, true, context, false, version);
    if (object !== null) return renderV2Object(object, depth, dialect, false, false, context, version);
    const leaf = version === 3 ? v3NamedLeafPlan(node, context) : null;
    if (leaf !== null) return renderV3NamedLeaf(leaf.name, leaf.plan, depth);
  }
  return renderV2ExactSchema(node, depth);
}

function renderV2ExactSchema(node: JsonNode, depth: number): string[] {
  return [`${indent(depth)}- ${V2_EXACT_SCHEMA_LEAD} ${stringifyJson(node)}`];
}

/** A property whose schema no concise form carries: `name (optional) - Exact JSON Schema: {…}`. */
function renderV3ExactProperty(name: string, optional: boolean, node: JsonNode, depth: number): string {
  const marker = optional ? " (optional)" : "";
  return `${indent(depth)}- ${renderPropertyName(name)}${marker} - ${V2_EXACT_SCHEMA_LEAD} ${stringifyJson(node)}`;
}

function v2ObjectPlan(
  node: JsonObject,
  named: boolean,
  context: V2ReferenceContext,
  allowDefinitions: boolean,
  version: ConversationalVersion,
): V2ObjectPlan | null {
  let index = 0;
  let name: string | null = null;
  if (named) {
    const title = node.entries[index];
    if (title?.key !== "title" || title.value.type !== "string") return null;
    if (version === 3 && !isConceptName(title.value.value)) return null;
    name = title.value.value;
    index += 1;
  }

  const type = node.entries[index];
  if (type?.key !== "type" || type.value.type !== "string" || type.value.value !== "object") return null;
  index += 1;

  const description = node.entries[index];
  if (
    description?.key !== "description" ||
    description.value.type !== "string" ||
    description.value.value === "" ||
    !isSafeV2InlineDescription(description.value.value) ||
    description.value.value.endsWith(V2_UNION_SUFFIX)
  ) {
    return null;
  }
  index += 1;

  const comment = version === 3 ? v3Comment(node.entries[index]) : null;
  if (comment !== null) index += 1;

  const properties = node.entries[index];
  if (
    properties?.key !== "properties" ||
    properties.value.type !== "object" ||
    !schemaMapContainsOnlySchemas(properties.value)
  ) {
    return null;
  }
  index += 1;

  const required = node.entries[index];
  if (
    required?.key !== "required" ||
    required.value.type !== "array" ||
    !required.value.items.every((item) => item.type === "string")
  ) {
    return null;
  }
  index += 1;

  const propertyNames = properties.value.entries.map(({ key }) => key);
  if (new Set(propertyNames).size !== propertyNames.length) return null;
  const requiredNames = required.value.items.map((item) => item.type === "string" ? item.value : "");
  if (new Set(requiredNames).size !== requiredNames.length) return null;
  if (requiredNames.some((requiredName) => !propertyNames.includes(requiredName))) return null;
  const requiredSet = new Set(requiredNames);
  if (!arraysEqual(propertyNames.filter((propertyName) => requiredSet.has(propertyName)), requiredNames)) return null;

  let definitions: JsonObject | null = null;
  const definitionsEntry = node.entries[index];
  if (definitionsEntry?.key === "$defs") {
    if (
      !allowDefinitions ||
      definitionsEntry.value.type !== "object" ||
      !schemaMapContainsOnlySchemas(definitionsEntry.value) ||
      new Set(definitionsEntry.value.entries.map(({ key }) => key)).size !== definitionsEntry.value.entries.length ||
      // v3 lists definitions beside the root, so an empty `$defs` has no line to read it back from.
      (version === 3 && definitionsEntry.value.entries.length === 0) ||
      (version === 3 && !definitionsEntry.value.entries.every(({ key }) => isConceptName(key)))
    ) {
      return null;
    }
    definitions = definitionsEntry.value;
    index += 1;
  }

  let additionalMode: V2ObjectPlan["additionalMode"] = "unspecified";
  const additional = node.entries[index];
  if (additional !== undefined) {
    if (additional.key !== "additionalProperties" || additional.value.type !== "boolean") return null;
    additionalMode = additional.value.value ? "allowed" : "closed";
    index += 1;
  }
  if (index !== node.entries.length) return null;
  // With no attribute lines, an object whose prose reads like a leaf would be read back as one.
  if (
    version === 3 && properties.value.entries.length === 0 && additionalMode === "closed" &&
    isLeafBody(description.value.value)
  ) {
    return null;
  }

  for (const property of properties.value.entries) {
    if (propertyShape(property.value, context, version) === null) return null;
  }

  if (definitions !== null) {
    for (const definition of definitions.entries) {
      if (
        definition.value.type !== "object" ||
        (v2ObjectPlan(definition.value, false, context, false, version) === null &&
          (version !== 3 || v2LeafPlan(definition.value, context, version) === null))
      ) {
        return null;
      }
    }
  }

  return {
    name,
    description: description.value.value,
    comment,
    properties: properties.value,
    requiredNames,
    definitions,
    additionalMode,
  };
}

function v2ObjectDescriptionLooksLikeLeaf(plan: V2ObjectPlan): boolean {
  return plan.description.endsWith(".") &&
    lastUnquotedSeparator(plan.description, " - ") >= 0;
}

/** How one property is written: as a leaf, as a nested object, or (version 3 only) in the exact escape. */
type PropertyShape =
  | { readonly kind: "leaf"; readonly leaf: V2LeafPlan }
  | { readonly kind: "object"; readonly plan: V2ObjectPlan }
  | { readonly kind: "exact" };

/**
 * Version 2 has no way to write one odd property, so it makes its whole schema
 * exact (null). Version 3 writes just that property in the exact escape, which
 * is also how it writes a description that would otherwise read as the escape.
 */
function propertyShape(node: JsonNode, context: V2ReferenceContext, version: ConversationalVersion): PropertyShape | null {
  const leaf = v2LeafPlan(node, context, version);
  if (leaf !== null && !(version === 3 && leaf.description.startsWith(V2_EXACT_SCHEMA_LEAD))) {
    return { kind: "leaf", leaf };
  }
  if (leaf === null && node.type === "object") {
    const plan = v2ObjectPlan(node, false, context, false, version);
    if (
      plan !== null &&
      !v2ObjectDescriptionLooksLikeLeaf(plan) &&
      !(version === 3 && plan.description.startsWith(V2_EXACT_SCHEMA_LEAD))
    ) {
      return { kind: "object", plan };
    }
  }
  return version === 3 ? { kind: "exact" } : null;
}

/** A named root, alternative or definition that is a leaf, as `- :Email: An email address - an email string.`. */
function v3NamedLeafPlan(
  node: JsonObject,
  context: V2ReferenceContext,
): { readonly name: string; readonly plan: V2LeafPlan } | null {
  const title = node.entries[0];
  if (title?.key !== "title" || title.value.type !== "string" || !isConceptName(title.value.value)) return null;
  const plan = v2LeafPlan(objectNode(node.entries.slice(1)), context, 3);
  return plan === null ? null : { name: title.value.value, plan };
}

function renderV3NamedLeaf(name: string, leaf: V2LeafPlan, depth: number): string[] {
  return [
    ...renderV3Comment(leaf.comment, depth),
    `${indent(depth)}- ${conceptToken(name)} ${leaf.description} - ${leaf.constraint}${leaf.annotations}.`,
  ];
}

function v2LeafPlan(node: JsonNode, context: V2ReferenceContext, version: ConversationalVersion): V2LeafPlan | null {
  if (node.type !== "object") return null;
  const description = node.entries[0];
  if (
    description?.key !== "description" ||
    description.value.type !== "string" ||
    description.value.value === "" ||
    !isSafeV2InlineDescription(description.value.value)
  ) {
    return null;
  }
  let rest = node.entries.slice(1);
  const comment = version === 3 ? v3Comment(rest[0]) : null;
  if (comment !== null) rest = rest.slice(1);
  let annotations = "";
  if (version === 3) {
    // Fixed order after the constraint members: `label`, `default`, then `examples`.
    const examples = rest.at(-1);
    if (examples?.key === "examples" && examples.value.type === "array" && examples.value.items.length > 0) {
      annotations = `${V3_EXAMPLES_LEAD}${joinNaturalList(examples.value.items.map((item) => stringifyJson(item)))}`;
      rest = rest.slice(0, -1);
    }
    const fallback = rest.at(-1);
    if (fallback?.key === "default") {
      annotations = `${V3_DEFAULT_LEAD}${stringifyJson(fallback.value)}${annotations}`;
      rest = rest.slice(0, -1);
    }
    const label = rest.at(-1);
    if (label?.key === "label" && label.value.type === "string" && label.value.value === "sensitive") {
      annotations = `${V3_SENSITIVE_LEAD}${annotations}`;
      rest = rest.slice(0, -1);
    }
  }
  const constraint = renderV2Constraint(rest, context, version);
  return constraint === null
    ? null
    : { description: description.value.value, comment, constraint, annotations };
}

/** A `$comment` member that `>` lines can carry exactly. */
function v3Comment(entry: JsonObjectEntry | undefined): string | null {
  if (entry?.key !== "$comment" || entry.value.type !== "string") return null;
  const value = entry.value.value;
  const linesSafe = value.split("\n").every((line) =>
    !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(line) && !/\s$/u.test(line)
  );
  return linesSafe && !hasUnpairedSurrogate(value) ? value : null;
}

function renderV3Comment(comment: string | null, depth: number): string[] {
  if (comment === null) return [];
  return comment.split("\n").map((line) => `${indent(depth)}>${line === "" ? "" : ` ${line}`}`);
}

function v2UnionPlan(node: JsonObject, version: ConversationalVersion): V2UnionPlan | null {
  const comment = version === 3 && node.entries.length === 4 ? v3Comment(node.entries[2]) : null;
  if (node.entries.length !== (comment === null ? 3 : 4)) return null;
  const [title, description] = node.entries;
  const oneOf = node.entries.at(-1);
  if (
    title?.key !== "title" || title.value.type !== "string" ||
    (version === 3 && !isConceptName(title.value.value)) ||
    description?.key !== "description" || description.value.type !== "string" ||
    description.value.value === "" || !isSafeV2InlineDescription(description.value.value) ||
    oneOf?.key !== "oneOf" || oneOf.value.type !== "array" || oneOf.value.items.length === 0 ||
    !oneOf.value.items.every(isSchemaNode)
  ) {
    return null;
  }
  return {
    name: title.value.value,
    description: description.value.value,
    comment,
    alternatives: oneOf.value.items,
  };
}

function renderV2Union(
  plan: V2UnionPlan,
  depth: number,
  dialect: string | null,
  context: V2ReferenceContext,
  version: ConversationalVersion,
): string[] {
  const head = version === 3 ? `${conceptToken(plan.name)} ` : `${renderPropertyName(plan.name)}: `;
  const lines = [...renderV3Comment(plan.comment, depth), `${indent(depth)}- ${head}${plan.description}${V2_UNION_SUFFIX}`];
  for (const alternative of plan.alternatives) {
    lines.push(...renderV2SchemaAlternative(alternative, depth + 1, dialect, context, version));
  }
  return lines;
}

function renderV2Object(
  plan: V2ObjectPlan,
  depth: number,
  dialect: string | null,
  optional: boolean,
  propertyContext: boolean,
  context: V2ReferenceContext,
  version: ConversationalVersion,
): string[] {
  const marker = propertyContext && optional ? " (optional)" : "";
  const name = plan.name === null ? "" : plan.name;
  // v3 names schemas as ***plain concepts and properties as `Name - description` attributes.
  const head = version === 2
    ? `${renderPropertyName(name)}${marker}: `
    : propertyContext
      ? `${renderPropertyName(name)}${marker} - `
      : `${conceptToken(name)} `;
  const lines = [...renderV3Comment(plan.comment, depth), `${indent(depth)}- ${head}${plan.description}`];
  const required = new Set(plan.requiredNames);
  for (const property of plan.properties.entries) {
    const propertyOptional = !required.has(property.key);
    const shape = propertyShape(property.value, context, version);
    if (shape === null) throw new TypeError("A planned v2 property became unrenderable");
    if (shape.kind === "object") {
      lines.push(...renderV2Object(
        { ...shape.plan, name: property.key },
        depth + 1,
        dialect,
        propertyOptional,
        true,
        context,
        version,
      ));
      continue;
    }
    if (shape.kind === "exact") {
      lines.push(renderV3ExactProperty(property.key, propertyOptional, property.value, depth + 1));
      continue;
    }
    const leaf = shape.leaf;
    const optionalMarker = propertyOptional ? " (optional)" : "";
    const separator = version === 2 ? ":" : " -";
    lines.push(...renderV3Comment(leaf.comment, depth + 1));
    lines.push(
      `${indent(depth + 1)}- ${renderPropertyName(property.key)}${optionalMarker}${separator} ${leaf.description} - ${leaf.constraint}${leaf.annotations}.`,
    );
  }
  const definitionLines: string[] = [];
  if (plan.definitions !== null) {
    // v2 nests definitions under the root; v3 lists them beside it in ***definitions***.
    const definitionDepth = version === 2 ? depth + 2 : depth;
    if (version === 2) {
      lines.push("");
      lines.push(`${indent(depth + 1)}- ${V2_DEFINITIONS}`);
    }
    for (const definition of plan.definitions.entries) {
      if (definition.value.type !== "object") {
        throw new TypeError("A planned v2 definition became unrenderable");
      }
      const definitionPlan = v2ObjectPlan(definition.value, false, context, false, version);
      let rendered: string[];
      if (definitionPlan !== null) {
        rendered = renderV2Object(
          { ...definitionPlan, name: definition.key },
          definitionDepth,
          dialect,
          false,
          false,
          context,
          version,
        );
      } else {
        const definitionLeaf = version === 3 ? v2LeafPlan(definition.value, context, version) : null;
        if (definitionLeaf === null) throw new TypeError("A planned v2 definition became unrenderable");
        rendered = renderV3NamedLeaf(definition.key, definitionLeaf, definitionDepth);
      }
      if (version === 2) lines.push(...rendered);
      else definitionLines.push("", ...rendered);
    }
  }
  if (plan.additionalMode === "allowed") {
    lines.push(`${indent(depth + 1)}- ${V2_ADDITIONAL_ALLOWED}`);
  } else if (plan.additionalMode === "unspecified") {
    lines.push(`${indent(depth + 1)}- ${V2_ADDITIONAL_UNSPECIFIED}`);
  }
  return [...lines, ...definitionLines];
}

function renderV2Constraint(
  entries: readonly JsonObjectEntry[],
  context: V2ReferenceContext,
  version: ConversationalVersion,
): string | null {
  if (entries.length === 1 && entries[0]?.key === "$ref" && entries[0].value.type === "string") {
    return renderV2Reference(entries[0].value.value, context, version);
  }
  if (
    entries.length === 2 &&
    entries[0]?.key === "type" && entries[0].value.type === "string" && entries[0].value.value === "array" &&
    entries[1]?.key === "items" && entries[1].value.type === "object" &&
    entries[1].value.entries.length === 1 &&
    entries[1].value.entries[0]?.key === "$ref" && entries[1].value.entries[0].value.type === "string"
  ) {
    const name = renderV2ReferenceName(entries[1].value.entries[0].value.value, context, version);
    if (name === null) return null;
    return `an array of ${version === 3 ? conceptToken(name) : name}`;
  }
  if (
    version === 3 &&
    entries.length === 2 &&
    entries[0]?.key === "type" && entries[0].value.type === "string" && entries[0].value.value === "array" &&
    entries[1]?.key === "items" && entries[1].value.type === "object"
  ) {
    const element = renderV2Constraint(entries[1].value.entries, context, version);
    const plural = element === null ? undefined : V3_ARRAY_ELEMENTS.get(element);
    if (plural !== undefined) return `an array of ${plural}`;
  }
  if (entries.length === 1 && entries[0]?.key === "const") {
    return stringifyJson(entries[0].value);
  }
  if (entries.length === 1 && entries[0]?.key === "enum" && entries[0].value.type === "array") {
    const items = entries[0].value.items;
    if (
      items.length === 0 ||
      !items.every((item) => item.type === "string") ||
      new Set(items.map((item) => item.type === "string" ? item.value : "")).size !== items.length
    ) {
      return null;
    }
    return `one of ${joinNaturalList(items.map((item) => stringifyJson(item)))}`;
  }

  const typeEntry = entries[0];
  if (typeEntry?.key !== "type") return null;
  const types = v2TypeNames(typeEntry.value);
  if (types === null) return null;
  const nullableSuffix = (version === 3 ? V3_NULLABLE_TYPES : V2_NULLABLE_TYPES)
    .some((nullable) => arraysEqual(types, [nullable, "null"]))
    ? ", or null"
    : "";
  const principal = nullableSuffix === "" ? types : [types[0] ?? ""];
  if (principal.length !== 1) return null;

  const type = principal[0];
  const rest = entries.slice(1);
  if (type === "string") {
    if (rest.length === 0) return `a string${nullableSuffix}`;
    if (
      rest.length === 1 && rest[0]?.key === "format" && rest[0].value.type === "string"
    ) {
      if (rest[0].value.value === "date") return `a date in YYYY-MM-DD format${nullableSuffix}`;
      if (rest[0].value.value === "email") return `an email string${nullableSuffix}`;
      if (rest[0].value.value === "uuid") return `a UUID string${nullableSuffix}`;
      if (version === 3 && rest[0].value.value === "date-time") return `a date-time string${nullableSuffix}`;
      if (version === 3 && rest[0].value.value === "uri") return `a URL string${nullableSuffix}`;
      return null;
    }
    if (rest.length === 1 && rest[0]?.key === "pattern" && rest[0].value.type === "string") {
      const digits = /^\^\[0-9\]\{(0|[1-9][0-9]*)\}\$$/.exec(rest[0].value.value);
      if (digits !== null) {
        const count = digits[1] ?? "0";
        return `a string of exactly ${v2RenderCount(count)} ${count === "1" ? "digit" : "digits"}${nullableSuffix}`;
      }
      if (version === 3) return `a string matching ${jsonString(rest[0].value.value)}${nullableSuffix}`;
      return null;
    }
    if (
      rest.length === 1 &&
      rest[0]?.key === "minLength" &&
      rest[0].value.type === "number" &&
      v2AcceptsLength("minLength", rest[0].value)
    ) {
      const count = v2RenderCount(rest[0].value.raw);
      const unit = isMathematicalOne(rest[0].value.raw) ? "character" : "characters";
      return `a string containing at least ${count} ${unit}${nullableSuffix}`;
    }
    if (
      rest.length === 2 &&
      rest[0]?.key === "minLength" && rest[0].value.type === "number" &&
      rest[1]?.key === "maxLength" && rest[1].value.type === "number" &&
      v2AcceptsLength("minLength", rest[0].value) &&
      v2AcceptsLength("maxLength", rest[1].value)
    ) {
      if (rest[0].value.raw === rest[1].value.raw) {
        const count = v2RenderCount(rest[0].value.raw);
        const unit = isMathematicalOne(rest[0].value.raw) ? "character" : "characters";
        return `a string of exactly ${count} ${unit}${nullableSuffix}`;
      }
      return `a string between ${rest[0].value.raw} and ${rest[1].value.raw} characters${nullableSuffix}`;
    }
    return null;
  }

  if (type === "integer") {
    if (rest.length === 0) return `an integer${nullableSuffix}`;
    if (
      rest.length === 1 && rest[0]?.key === "minimum" &&
      rest[0].value.type === "number" && rest[0].value.raw === "0"
    ) {
      return `a non-negative integer${nullableSuffix}`;
    }
    if (
      rest.length === 2 &&
      rest[0]?.key === "minimum" && rest[0].value.type === "number" &&
      rest[1]?.key === "maximum" && rest[1].value.type === "number"
    ) {
      return `an integer between ${rest[0].value.raw} and ${rest[1].value.raw}${nullableSuffix}`;
    }
  }

  if (version === 3 && type === "number") {
    if (rest.length === 0) return `a number${nullableSuffix}`;
    if (
      rest.length === 1 && rest[0]?.key === "minimum" &&
      rest[0].value.type === "number" && rest[0].value.raw === "0"
    ) {
      return `a non-negative number${nullableSuffix}`;
    }
    if (
      rest.length === 2 &&
      rest[0]?.key === "minimum" && rest[0].value.type === "number" &&
      rest[1]?.key === "maximum" && rest[1].value.type === "number"
    ) {
      return `a number between ${rest[0].value.raw} and ${rest[1].value.raw}${nullableSuffix}`;
    }
  }
  if (version === 3 && type === "boolean" && rest.length === 0) return `a boolean${nullableSuffix}`;
  return null;
}

function renderV2Reference(reference: string, context: V2ReferenceContext, version: ConversationalVersion): string {
  const name = renderV2ReferenceName(reference, context, version);
  if (name !== null) {
    return `${v2IndefiniteArticle(name)} ${version === 3 ? conceptToken(name) : name}`;
  }
  // v3 writes a local file reference as a ***plain linked resource.
  if (version === 3 && isLinkableReference(reference)) return `a reference to [${reference}](${reference})`;
  return `a reference to ${jsonString(reference)}`;
}

function renderV2ReferenceName(
  reference: string,
  context: V2ReferenceContext,
  version: ConversationalVersion,
): string | null {
  const safe = version === 3 ? isConceptName : isSafeV2SchemaName;
  if (
    reference === "#" &&
    context.rootName !== null &&
    safe(context.rootName)
  ) {
    return context.rootName;
  }
  const prefix = "#/$defs/";
  if (reference.startsWith(prefix)) {
    const token = reference.slice(prefix.length);
    if (safe(token) && context.definitionNames.has(token)) return token;
  }
  return v3ExternalConceptName(reference, context, version);
}

/**
 * The concept a bound library names `reference`, only when reading it back
 * gives the same reference: the name is not one the module declares (a
 * declared name always means the declaration) and the binding resolves it to
 * this reference, so the written document can never mean something else.
 */
function v3ExternalConceptName(
  reference: string,
  context: V2ReferenceContext,
  version: ConversationalVersion,
): string | null {
  if (version !== 3 || context.concepts === undefined) return null;
  const name = context.concepts.concept(reference);
  if (
    name === null ||
    !isConceptName(name) ||
    name === context.rootName ||
    context.definitionNames.has(name) ||
    context.concepts.ref(name) !== reference
  ) {
    return null;
  }
  return name;
}

/** ***plain concept names: letters, digits, `+`, `-`, `.`, and `_`. */
function isConceptName(name: string): boolean {
  return /^[A-Za-z0-9+._-]+$/.test(name);
}

function conceptToken(name: string): string {
  return `:${name}:`;
}

/** A relative path inside the module's folder, which ***plain can attach as a linked resource. */
function isLinkableReference(reference: string): boolean {
  return /^(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\/)[A-Za-z0-9._~\/-]+$/.test(reference) &&
    !reference.split("/").includes("..");
}

function v2IndefiniteArticle(name: string): "a" | "an" {
  return /^[AEIOU]/i.test(name) ? "an" : "a";
}

function isSafeV2SchemaName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9_-]*$/.test(name);
}

function v2AcceptsLength(keyword: "minLength" | "maxLength", node: JsonNode): boolean {
  return VALUE_CODECS_2020_12.find((codec) => codec.keyword === keyword)?.accepts(node) === true;
}

function v2TypeNames(node: JsonNode): string[] | null {
  if (node.type === "string") return [node.value];
  if (
    node.type === "array" &&
    node.items.length > 1 &&
    node.items.every((item) => item.type === "string")
  ) {
    const names = node.items.map((item) => item.type === "string" ? item.value : "");
    return new Set(names).size === names.length ? names : null;
  }
  return null;
}

function v2ReferenceContextFromSchema(node: JsonObject, concepts?: ConceptBinding): V2ReferenceContext | null {
  const title = node.entries[0];
  const rootName = title?.key === "title" && title.value.type === "string"
    ? title.value.value
    : null;
  const definitionEntries = node.entries.filter(({ key }) => key === "$defs");
  if (definitionEntries.length > 1) return null;
  const definitions = definitionEntries[0]?.value;
  if (definitions !== undefined && definitions.type !== "object") return null;
  const definitionNames = new Set(
    definitions?.type === "object" ? definitions.entries.map(({ key }) => key) : [],
  );
  if (definitions?.type === "object" && definitionNames.size !== definitions.entries.length) return null;
  if (rootName !== null && definitionNames.has(rootName)) return null;
  return concepts === undefined ? { rootName, definitionNames } : { rootName, definitionNames, concepts };
}

function v2RenderCount(raw: string): string {
  return raw === "1" ? "one" : raw;
}

function joinNaturalList(values: readonly string[]): string {
  if (values.length === 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} or ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, or ${values.at(-1)}`;
}

function schemaFromV2Bullets(bullets: readonly Bullet[]): JsonNode {
  if (bullets.length !== 1) {
    throw new PlainTypeSyntaxError("A version-2 document needs exactly one root schema declaration", bullets[1]?.line ?? bullets[0]?.line ?? 1);
  }
  const bullet = bullets[0];
  if (bullet === undefined) throw new PlainTypeSyntaxError("Expected a schema declaration", 1);
  const context = v2ReferenceContextFromBullet(bullet);
  return schemaFromV2Bullet(bullet, context, true, 2);
}

/**
 * Version 3: the `***definitions***` list holds the root schema first and its
 * reusable `$defs` after it, each written as a ***plain concept definition.
 */
function schemaFromV3Bullets(
  bullets: readonly Bullet[],
  comments: ReadonlyMap<number, string>,
  concepts: ConceptBinding | undefined,
): JsonNode {
  const [root, ...definitions] = bullets;
  if (root === undefined) throw new PlainTypeSyntaxError("Expected a schema declaration", 1);
  const context: V2ReferenceContext = {
    ...v3ReferenceContextFromBullets(root, definitions),
    comments,
    ...(concepts === undefined ? {} : { concepts }),
  };
  if (isV2MarkerClause(root.text)) {
    if (definitions[0] !== undefined) {
      throw new PlainTypeSyntaxError("Reusable definitions need a named object as the first definition", definitions[0].line);
    }
    return schemaFromV2Bullet(root, context, false, 3);
  }
  const declaration = parseV3ConceptDeclaration(root.text, root.line);
  if (declaration.body.endsWith(V2_UNION_SUFFIX) || isLeafConcept(declaration, root)) {
    if (definitions[0] !== undefined) {
      throw new PlainTypeSyntaxError("Reusable definitions need a named object as the first definition", definitions[0].line);
    }
    return schemaFromV2Bullet(root, context, false, 3);
  }
  return schemaFromV2Object(declaration, root, true, context, false, 3, definitions);
}

function isV2MarkerClause(text: string): boolean {
  return text === ALLOW_ALL || text === DENY_ALL || text.startsWith(`${V2_EXACT_SCHEMA_LEAD} `);
}

function v3ReferenceContextFromBullets(root: Bullet, definitions: readonly Bullet[]): V2ReferenceContext {
  const rootName = isV2MarkerClause(root.text) ? null : parseV3ConceptDeclaration(root.text, root.line).name;
  const definitionNames = new Set<string>();
  for (const definitionBullet of definitions) {
    const definition = parseV3ConceptDeclaration(definitionBullet.text, definitionBullet.line);
    if (definitionNames.has(definition.name)) {
      throw new PlainTypeSyntaxError(`Duplicate definition ${conceptToken(definition.name)}`, definitionBullet.line);
    }
    if (definition.name === rootName) {
      throw new PlainTypeSyntaxError("A definition cannot have the same name as the root schema", definitionBullet.line);
    }
    definitionNames.add(definition.name);
  }
  return { rootName, definitionNames };
}

function v2ReferenceContextFromBullet(bullet: Bullet): V2ReferenceContext {
  if (
    bullet.text === ALLOW_ALL ||
    bullet.text === DENY_ALL ||
    bullet.text.startsWith(`${V2_EXACT_SCHEMA_LEAD} `)
  ) {
    return { rootName: null, definitionNames: new Set() };
  }
  const root = parseV2Declaration(bullet.text, bullet.line);
  const definitionsSections = bullet.children.filter(({ text }) => text === V2_DEFINITIONS);
  if (definitionsSections.length > 1) {
    throw new PlainTypeSyntaxError("An object may have only one Definitions section", definitionsSections[1]?.line ?? bullet.line);
  }
  const definitionNames = new Set<string>();
  for (const definitionBullet of definitionsSections[0]?.children ?? []) {
    const definition = parseV2Declaration(definitionBullet.text, definitionBullet.line);
    if (definitionNames.has(definition.name)) {
      throw new PlainTypeSyntaxError(`Duplicate definition ${jsonString(definition.name)}`, definitionBullet.line);
    }
    if (definition.name === root.name) {
      throw new PlainTypeSyntaxError("A definition cannot have the same name as the root schema", definitionBullet.line);
    }
    definitionNames.add(definition.name);
  }
  return { rootName: root.name, definitionNames };
}

function schemaFromV2Bullet(
  bullet: Bullet,
  context: V2ReferenceContext,
  allowDefinitions: boolean,
  version: ConversationalVersion,
): JsonNode {
  if (isV2MarkerClause(bullet.text) && context.comments?.has(bullet.line)) {
    throw new PlainTypeSyntaxError("A comment cannot describe this clause; put $comment inside an exact JSON Schema", bullet.line);
  }
  if (bullet.text === ALLOW_ALL || bullet.text === DENY_ALL) {
    requireNoChildren(bullet);
    return { type: "boolean", value: bullet.text === ALLOW_ALL };
  }
  const exactPrefix = `${V2_EXACT_SCHEMA_LEAD} `;
  if (bullet.text.startsWith(exactPrefix)) {
    requireNoChildren(bullet);
    const schema = parseEmbeddedJson(bullet.text.slice(exactPrefix.length), bullet.line);
    if (!isSchemaNode(schema)) {
      throw new PlainTypeSyntaxError("An exact JSON Schema must be an object or boolean", bullet.line);
    }
    return schema;
  }

  const declaration = version === 3
    ? parseV3ConceptDeclaration(bullet.text, bullet.line)
    : parseV2Declaration(bullet.text, bullet.line);
  if (declaration.optional) {
    throw new PlainTypeSyntaxError("A root schema or alternative cannot be optional", bullet.line);
  }

  if (version === 3 && isLeafConcept(declaration, bullet)) {
    return objectNode([
      { key: "title", value: { type: "string", value: declaration.name } },
      ...leafEntries(declaration.body, bullet, context, version, "leaf concept"),
    ]);
  }
  if (!declaration.body.endsWith(V2_UNION_SUFFIX)) {
    return schemaFromV2Object(declaration, bullet, true, context, allowDefinitions, version);
  }
  const description = declaration.body.slice(0, -V2_UNION_SUFFIX.length);
  if (description === "" || !isSafeV2InlineDescription(description)) {
    throw new PlainTypeSyntaxError("A named alternative schema needs a safe inline description", bullet.line);
  }
  if (bullet.children.length === 0) {
    throw new PlainTypeSyntaxError("'exactly one of:' needs at least one alternative", bullet.line);
  }
  return objectNode([
    { key: "title", value: { type: "string", value: declaration.name } },
    { key: "description", value: { type: "string", value: description } },
    ...commentEntries(bullet, context),
    {
      key: "oneOf",
      value: arrayNode(bullet.children.map((child) => schemaFromV2Bullet(child, context, false, version))),
    },
  ]);
}

function schemaFromV2Object(
  declaration: V2Declaration,
  bullet: Bullet,
  named: boolean,
  context: V2ReferenceContext,
  allowDefinitions: boolean,
  version: ConversationalVersion,
  /** Version 3: the root's sibling definitions from the ***definitions*** list. */
  siblingDefinitions: readonly Bullet[] = [],
): JsonObject {
  if (declaration.body === "" || !isSafeV2InlineDescription(declaration.body)) {
    throw new PlainTypeSyntaxError("An object declaration needs a safe inline description", bullet.line);
  }
  const properties: JsonObjectEntry[] = [];
  const required: JsonNode[] = [];
  let definitions: JsonObject | null = null;
  let additionalMode: V2ObjectPlan["additionalMode"] = "closed";
  let sawAdditionalDirective = false;
  let sawDefinitions = false;

  for (const [index, child] of bullet.children.entries()) {
    if (child.text === V2_ADDITIONAL_ALLOWED || child.text === V2_ADDITIONAL_UNSPECIFIED) {
      requireNoChildren(child);
      if (context.comments?.has(child.line)) {
        throw new PlainTypeSyntaxError("A comment cannot describe an additional-properties directive", child.line);
      }
      if (sawAdditionalDirective) {
        throw new PlainTypeSyntaxError("An object may have only one additional-properties directive", child.line);
      }
      if (index !== bullet.children.length - 1) {
        throw new PlainTypeSyntaxError("The additional-properties directive must be the object's final child", child.line);
      }
      sawAdditionalDirective = true;
      additionalMode = child.text === V2_ADDITIONAL_ALLOWED ? "allowed" : "unspecified";
      continue;
    }

    if (version === 2 && child.text === V2_DEFINITIONS) {
      if (!allowDefinitions) {
        throw new PlainTypeSyntaxError("Definitions are supported only on the root object", child.line);
      }
      if (sawDefinitions) {
        throw new PlainTypeSyntaxError("An object may have only one Definitions section", child.line);
      }
      if (sawAdditionalDirective) {
        throw new PlainTypeSyntaxError("Definitions must precede the additional-properties directive", child.line);
      }
      sawDefinitions = true;
      const entries: JsonObjectEntry[] = [];
      for (const definitionBullet of child.children) {
        const definition = parseV2Declaration(definitionBullet.text, definitionBullet.line);
        if (definition.optional) {
          throw new PlainTypeSyntaxError("A reusable definition cannot be optional", definitionBullet.line);
        }
        if (definition.body.endsWith(V2_UNION_SUFFIX)) {
          throw new PlainTypeSyntaxError("A concise reusable definition must be an object", definitionBullet.line);
        }
        if (entries.some(({ key }) => key === definition.name)) {
          throw new PlainTypeSyntaxError(`Duplicate definition ${jsonString(definition.name)}`, definitionBullet.line);
        }
        entries.push({
          key: definition.name,
          value: schemaFromV2Object(definition, definitionBullet, false, context, false, version),
        });
      }
      definitions = objectNode(entries);
      continue;
    }

    if (sawDefinitions) {
      throw new PlainTypeSyntaxError("Only the additional-properties directive may follow Definitions", child.line);
    }

    const parsed = propertyFromV2Bullet(child, context, version);
    if (properties.some(({ key }) => key === parsed.name)) {
      throw new PlainTypeSyntaxError(`Duplicate compact property ${jsonString(parsed.name)} is ambiguous`, child.line);
    }
    properties.push({ key: parsed.name, value: parsed.schema });
    if (!parsed.optional) required.push({ type: "string", value: parsed.name });
  }

  if (siblingDefinitions.length > 0) {
    const entries: JsonObjectEntry[] = [];
    for (const definitionBullet of siblingDefinitions) {
      const definition = parseV3ConceptDeclaration(definitionBullet.text, definitionBullet.line);
      if (definition.body.endsWith(V2_UNION_SUFFIX)) {
        throw new PlainTypeSyntaxError("A concise reusable definition must be an object or a leaf", definitionBullet.line);
      }
      entries.push({
        key: definition.name,
        value: isLeafConcept(definition, definitionBullet)
          ? objectNode(leafEntries(definition.body, definitionBullet, context, version, "leaf concept"))
          : schemaFromV2Object(definition, definitionBullet, false, context, false, version),
      });
    }
    definitions = objectNode(entries);
  }

  return objectNode([
    ...(named ? [{ key: "title", value: { type: "string", value: declaration.name } } as JsonObjectEntry] : []),
    { key: "type", value: { type: "string", value: "object" } },
    { key: "description", value: { type: "string", value: declaration.body } },
    ...commentEntries(bullet, context),
    { key: "properties", value: objectNode(properties) },
    { key: "required", value: arrayNode(required) },
    ...(definitions === null
      ? []
      : [{ key: "$defs", value: definitions } as JsonObjectEntry]),
    ...(additionalMode === "unspecified"
      ? []
      : [{ key: "additionalProperties", value: { type: "boolean", value: additionalMode === "allowed" } } as JsonObjectEntry]),
  ]);
}

function propertyFromV2Bullet(
  bullet: Bullet,
  context: V2ReferenceContext,
  version: ConversationalVersion,
): { name: string; optional: boolean; schema: JsonNode } {
  const declaration = version === 3
    ? parseV3AttributeDeclaration(bullet.text, bullet.line)
    : parseV2Declaration(bullet.text, bullet.line);
  if (version === 3 && declaration.body.startsWith(`${V2_EXACT_SCHEMA_LEAD} `)) {
    requireNoChildren(bullet);
    if (context.comments?.has(bullet.line)) {
      throw new PlainTypeSyntaxError("A comment cannot describe this clause; put $comment inside an exact JSON Schema", bullet.line);
    }
    const schema = parseEmbeddedJson(declaration.body.slice(V2_EXACT_SCHEMA_LEAD.length + 1), bullet.line);
    if (!isSchemaNode(schema)) {
      throw new PlainTypeSyntaxError("An exact JSON Schema must be an object or boolean", bullet.line);
    }
    return { name: declaration.name, optional: declaration.optional, schema };
  }
  if (declaration.body.endsWith(V2_UNION_SUFFIX)) {
    throw new PlainTypeSyntaxError("Exactly-one unions are not supported as object properties", bullet.line);
  }
  if (declaration.object || !isLeafBody(declaration.body)) {
    return {
      name: declaration.name,
      optional: declaration.optional,
      schema: schemaFromV2Object(declaration, bullet, false, context, false, version),
    };
  }
  return {
    name: declaration.name,
    optional: declaration.optional,
    schema: objectNode(leafEntries(declaration.body, bullet, context, version, "property")),
  };
}

/** A body that ends with a period after a last unquoted ` - ` is a leaf: `description - constraint.`. */
function isLeafBody(body: string): boolean {
  return body.endsWith(".") && lastUnquotedSeparator(body, " - ") >= 0;
}

/**
 * A concept is a leaf when its text is a leaf's and it has no attributes. An
 * object can have such a description (a dash and a period in the middle of its
 * prose), so one with attributes is still an object.
 */
function isLeafConcept(declaration: V2Declaration, bullet: Bullet): boolean {
  return bullet.children.length === 0 && isLeafBody(declaration.body);
}

/** The members of a leaf's schema: its description, its comment, its constraint, then its annotations. */
function leafEntries(
  body: string,
  bullet: Bullet,
  context: V2ReferenceContext,
  version: ConversationalVersion,
  subject: "property" | "leaf concept",
): JsonObjectEntry[] {
  requireNoChildren(bullet);
  const separator = lastUnquotedSeparator(body, " - ");
  const description = body.slice(0, separator);
  const tail = body.slice(separator + 3, -1);
  if (description === "" || !isSafeV2InlineDescription(description)) {
    throw new PlainTypeSyntaxError(`A ${subject} needs a safe inline description`, bullet.line);
  }
  const { constraint, annotations } = version === 3
    ? splitV3Annotations(tail, bullet.line)
    : { constraint: tail, annotations: [] };
  return [
    { key: "description", value: { type: "string", value: description } },
    ...commentEntries(bullet, context),
    ...entriesFromV2Constraint(constraint, bullet.line, context, version),
    ...annotations,
  ];
}

function commentEntries(bullet: Bullet, context: V2ReferenceContext): JsonObjectEntry[] {
  const comment = context.comments?.get(bullet.line);
  return comment === undefined ? [] : [{ key: "$comment", value: { type: "string", value: comment } }];
}

/** Split `constraint. Sensitive. Defaults to X. For example: A or B` into the constraint and annotation members. */
function splitV3Annotations(source: string, line: number): { constraint: string; annotations: JsonObjectEntry[] } {
  let constraint = source;
  let examples: JsonObjectEntry | null = null;
  const examplesAt = lastUnquotedSeparator(constraint, V3_EXAMPLES_LEAD);
  if (examplesAt >= 0) {
    const values = parseJsonNaturalList(constraint.slice(examplesAt + V3_EXAMPLES_LEAD.length), line);
    examples = { key: "examples", value: arrayNode(values) };
    constraint = constraint.slice(0, examplesAt);
  }
  let fallback: JsonObjectEntry | null = null;
  const defaultAt = lastUnquotedSeparator(constraint, V3_DEFAULT_LEAD);
  if (defaultAt >= 0) {
    fallback = { key: "default", value: parseEmbeddedJson(constraint.slice(defaultAt + V3_DEFAULT_LEAD.length), line) };
    constraint = constraint.slice(0, defaultAt);
  }
  let label: JsonObjectEntry | null = null;
  if (constraint.endsWith(V3_SENSITIVE_LEAD)) {
    label = { key: "label", value: { type: "string", value: "sensitive" } };
    constraint = constraint.slice(0, -V3_SENSITIVE_LEAD.length);
  }
  return {
    constraint,
    annotations: [...(label ? [label] : []), ...(fallback ? [fallback] : []), ...(examples ? [examples] : [])],
  };
}

function entriesFromV2Constraint(
  source: string,
  line: number,
  context: V2ReferenceContext,
  version: ConversationalVersion,
): JsonObjectEntry[] {
  const literal = tryParseEmbeddedJson(source);
  if (literal !== null) return [{ key: "const", value: literal }];

  if (source.startsWith("one of ")) {
    const values = parseV2NaturalStringList(source.slice("one of ".length), line);
    return [{ key: "enum", value: arrayNode(values.map((value) => ({ type: "string", value }))) }];
  }

  const nullable = source.endsWith(", or null");
  const base = nullable ? source.slice(0, -", or null".length) : source;
  const typeEntry = (type: "string" | "integer" | "number" | "boolean"): JsonObjectEntry => ({
    key: "type",
    value: nullable
      ? arrayNode([{ type: "string", value: type }, { type: "string", value: "null" }])
      : { type: "string", value: type },
  });

  if (base === "a string") return [typeEntry("string")];
  if (base === "an integer") return [typeEntry("integer")];
  if (base === "a non-negative integer") {
    return [typeEntry("integer"), { key: "minimum", value: { type: "number", raw: "0" } }];
  }
  if (base === "a date in YYYY-MM-DD format") {
    return [typeEntry("string"), { key: "format", value: { type: "string", value: "date" } }];
  }
  if (base === "an email string") {
    return [typeEntry("string"), { key: "format", value: { type: "string", value: "email" } }];
  }
  if (base === "a UUID string") {
    return [typeEntry("string"), { key: "format", value: { type: "string", value: "uuid" } }];
  }
  if (version === 3) {
    const entries = v3LeafEntries(base, typeEntry, line);
    if (entries !== null) return entries;
  }

  const externalReference = nullable ? null : /^a reference to ("(?:[^"\\]|\\[\s\S])*")$/.exec(base);
  if (externalReference !== null) {
    const reference = parseEmbeddedJson(externalReference[1] ?? "", line);
    if (reference.type !== "string") throw new PlainTypeSyntaxError("Expected a reference URI string", line);
    return [{ key: "$ref", value: reference }];
  }

  const linkedReference = nullable || version === 2 ? null : /^a reference to \[([^\]]+)\]\(([^)]+)\)$/.exec(base);
  if (linkedReference !== null) {
    const [, text, target] = linkedReference;
    if (text !== target || target === undefined || !isLinkableReference(target)) {
      throw new PlainTypeSyntaxError("A linked reference must be a relative file path whose link text equals its target", line);
    }
    return [{ key: "$ref", value: { type: "string", value: target } }];
  }

  const arrayReference = nullable
    ? null
    : version === 3
      ? /^an array of :([A-Za-z0-9+._-]+):$/.exec(base)
      : /^an array of ([A-Z][A-Za-z0-9_-]*)$/.exec(base);
  if (arrayReference !== null) {
    const reference = v2NamedReference(arrayReference[1] ?? "", line, context);
    return [
      { key: "type", value: { type: "string", value: "array" } },
      { key: "items", value: objectNode([{ key: "$ref", value: { type: "string", value: reference } }]) },
    ];
  }

  const arrayElements = version === 3 && !nullable ? /^an array of (.+)$/.exec(base) : null;
  const element = arrayElements === null ? undefined : V3_ARRAY_ELEMENT_BY_PLURAL.get(arrayElements[1] ?? "");
  if (element !== undefined) {
    return [
      { key: "type", value: { type: "string", value: "array" } },
      { key: "items", value: objectNode(entriesFromV2Constraint(element, line, context, version)) },
    ];
  }

  const namedReference = nullable
    ? null
    : version === 3
      ? /^(?:a|an) :([A-Za-z0-9+._-]+):$/.exec(base)
      : /^(?:a|an) ([A-Z][A-Za-z0-9_-]*)$/.exec(base);
  if (namedReference !== null) {
    const name = namedReference[1] ?? "";
    return [{ key: "$ref", value: { type: "string", value: v2NamedReference(name, line, context) } }];
  }

  const digits = /^a string of exactly (one|0|[1-9][0-9]*) (digit|digits)$/.exec(base);
  if (digits !== null) {
    const raw = digits[1] === "one" ? "1" : digits[1] ?? "0";
    const expected = raw === "1" ? "digit" : "digits";
    if (digits[2] !== expected) throw new PlainTypeSyntaxError(`Expected ${JSON.stringify(expected)}`, line);
    return [
      typeEntry("string"),
      { key: "pattern", value: { type: "string", value: `^[0-9]{${raw}}$` } },
    ];
  }

  const atLeast = /^a string containing at least (one|.+) (character|characters)$/.exec(base);
  if (atLeast !== null) {
    const length = v2CountNode(atLeast[1] ?? "", line);
    const expected = isMathematicalOne(length.raw) ? "character" : "characters";
    if (atLeast[2] !== expected) throw new PlainTypeSyntaxError(`Expected ${JSON.stringify(expected)}`, line);
    return [typeEntry("string"), { key: "minLength", value: length }];
  }

  const exact = /^a string of exactly (one|.+) (character|characters)$/.exec(base);
  if (exact !== null) {
    const length = v2CountNode(exact[1] ?? "", line);
    const expected = isMathematicalOne(length.raw) ? "character" : "characters";
    if (exact[2] !== expected) throw new PlainTypeSyntaxError(`Expected ${JSON.stringify(expected)}`, line);
    return [
      typeEntry("string"),
      { key: "minLength", value: length },
      { key: "maxLength", value: length },
    ];
  }

  const stringRange = /^a string between (one|.+) and (one|.+) characters$/.exec(base);
  if (stringRange !== null) {
    return [
      typeEntry("string"),
      { key: "minLength", value: v2CountNode(stringRange[1] ?? "", line) },
      { key: "maxLength", value: v2CountNode(stringRange[2] ?? "", line) },
    ];
  }

  const integerRange = /^an integer between (.+) and (.+)$/.exec(base);
  if (integerRange !== null) {
    return [
      typeEntry("integer"),
      { key: "minimum", value: v2NumberNode(integerRange[1] ?? "", line) },
      { key: "maximum", value: v2NumberNode(integerRange[2] ?? "", line) },
    ];
  }

  throw new PlainTypeSyntaxError(`Unknown version-${version} constraint ${JSON.stringify(source)}`, line);
}

/** Version 3's additions to the type-led constraints, or null when `base` is none of them. */
function v3LeafEntries(
  base: string,
  typeEntry: (type: "string" | "integer" | "number" | "boolean") => JsonObjectEntry,
  line: number,
): JsonObjectEntry[] | null {
  const format = (value: string): JsonObjectEntry => ({ key: "format", value: { type: "string", value } });
  if (base === "a number") return [typeEntry("number")];
  if (base === "a non-negative number") {
    return [typeEntry("number"), { key: "minimum", value: { type: "number", raw: "0" } }];
  }
  if (base === "a boolean") return [typeEntry("boolean")];
  if (base === "a date-time string") return [typeEntry("string"), format("date-time")];
  if (base === "a URL string") return [typeEntry("string"), format("uri")];

  const numberRange = /^a number between (\S+) and (\S+)$/.exec(base);
  if (numberRange !== null) {
    return [
      typeEntry("number"),
      { key: "minimum", value: v2NumberNode(numberRange[1] ?? "", line) },
      { key: "maximum", value: v2NumberNode(numberRange[2] ?? "", line) },
    ];
  }

  const matching = /^a string matching ("(?:[^"\\]|\\[\s\S])*")$/.exec(base);
  if (matching !== null) {
    const pattern = parseEmbeddedJson(matching[1] ?? "", line);
    if (pattern.type !== "string") throw new PlainTypeSyntaxError("Expected a regular expression string", line);
    return [typeEntry("string"), { key: "pattern", value: pattern }];
  }
  return null;
}

function v2NamedReference(name: string, line: number, context: V2ReferenceContext): string {
  if (name === context.rootName) return "#";
  if (context.definitionNames.has(name)) return `#/$defs/${name}`;
  const external = context.concepts?.ref(name);
  if (external !== undefined && external !== null) return external;
  throw new PlainTypeSyntaxError(`Unknown schema name ${jsonString(name)}`, line);
}

/** A comma/"or" list of JSON values, as rendered by `joinNaturalList`. */
function parseJsonNaturalList(source: string, line: number): JsonNode[] {
  const values: JsonNode[] = [];
  let cursor = 0;
  let finalExpected = false;
  while (cursor < source.length) {
    const end = endOfJsonValueToken(source, cursor, line);
    values.push(parseEmbeddedJson(source.slice(cursor, end), line));
    cursor = end;
    if (finalExpected) {
      if (cursor !== source.length) throw new PlainTypeSyntaxError("The final example must end the sentence", line);
      finalExpected = false;
      break;
    }
    if (cursor === source.length) break;
    if (source.startsWith(", or ", cursor)) {
      cursor += ", or ".length;
      finalExpected = true;
    } else if (source.startsWith(" or ", cursor)) {
      cursor += " or ".length;
      finalExpected = true;
    } else if (source.startsWith(", ", cursor)) {
      cursor += 2;
    } else {
      throw new PlainTypeSyntaxError("Expected a comma or 'or' between examples", line);
    }
  }
  if (finalExpected || values.length === 0) throw new PlainTypeSyntaxError("Expected an example value", line);
  return values;
}

function endOfJsonValueToken(source: string, start: number, line: number): number {
  const first = source[start];
  if (first === '"') return endOfJsonStringToken(source, start, line);
  if (first === "{" || first === "[") {
    let depth = 0;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (character === '"') {
        index = endOfJsonStringToken(source, index, line) - 1;
      } else if (character === "{" || character === "[") {
        depth += 1;
      } else if (character === "}" || character === "]") {
        depth -= 1;
        if (depth === 0) return index + 1;
      }
    }
    throw new PlainTypeSyntaxError("Unterminated JSON value", line);
  }
  const scalar = /^(?:-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null)/.exec(source.slice(start));
  if (scalar === null) throw new PlainTypeSyntaxError("Expected a JSON value", line);
  return start + scalar[0].length;
}

function v2CountNode(source: string, line: number): Extract<JsonNode, { type: "number" }> {
  const node = v2NumberNode(source === "one" ? "1" : source, line);
  const codec = VALUE_CODECS_2020_12.find(({ keyword }) => keyword === "minLength");
  if (codec === undefined || !codec.accepts(node)) {
    throw new PlainTypeSyntaxError("A character count must be a non-negative JSON integer", line);
  }
  return node;
}

function v2NumberNode(source: string, line: number): Extract<JsonNode, { type: "number" }> {
  const node = parseEmbeddedJson(source, line);
  if (node.type !== "number") throw new PlainTypeSyntaxError("Expected a JSON number", line);
  return node;
}

function tryParseEmbeddedJson(source: string): JsonNode | null {
  try {
    return parseJson(source);
  } catch {
    return null;
  }
}

function parseV2NaturalStringList(source: string, line: number): string[] {
  const values: string[] = [];
  let cursor = 0;
  let finalExpected = false;
  while (cursor < source.length) {
    const parsingFinalValue = finalExpected;
    if (source[cursor] !== '"') {
      throw new PlainTypeSyntaxError("An inline enum currently supports JSON strings only", line);
    }
    const end = endOfJsonStringToken(source, cursor, line);
    const value = parseEmbeddedJson(source.slice(cursor, end), line);
    if (value.type !== "string") throw new PlainTypeSyntaxError("Expected an enum string", line);
    values.push(value.value);
    cursor = end;
    if (parsingFinalValue) {
      if (cursor !== source.length) {
        throw new PlainTypeSyntaxError("The final enum value must end the constraint", line);
      }
      finalExpected = false;
      break;
    }
    if (cursor === source.length) break;
    if (source.startsWith(", or ", cursor)) {
      cursor += ", or ".length;
      finalExpected = true;
    } else if (source.startsWith(" or ", cursor)) {
      cursor += " or ".length;
      finalExpected = true;
    } else if (source.startsWith(", ", cursor)) {
      cursor += 2;
    } else {
      throw new PlainTypeSyntaxError("Expected a comma or 'or' between enum values", line);
    }
  }
  if (finalExpected) throw new PlainTypeSyntaxError("Expected the final enum value", line);
  if (values.length === 0 || new Set(values).size !== values.length) {
    throw new PlainTypeSyntaxError("An inline enum needs unique string values", line);
  }
  return values;
}

function parseV2Declaration(source: string, line: number): V2Declaration {
  let cursor = 0;
  let nameToken: string;
  if (source.startsWith('"')) {
    const end = endOfJsonStringToken(source, 0, line);
    nameToken = source.slice(0, end);
    cursor = end;
  } else {
    const match = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(source);
    if (match === null) throw new PlainTypeSyntaxError("Expected a safe name or JSON string", line);
    nameToken = match[0];
    cursor = nameToken.length;
  }
  const name = parsePropertyName(nameToken, line);
  let optional = false;
  let object = false;
  if (source.startsWith(" (", cursor)) {
    const close = source.indexOf(")", cursor + 2);
    if (close < 0) throw new PlainTypeSyntaxError("Unclosed declaration qualifiers", line);
    const qualifiers = source.slice(cursor + 2, close).split(", ");
    if (new Set(qualifiers).size !== qualifiers.length) {
      throw new PlainTypeSyntaxError("Duplicate declaration qualifier", line);
    }
    for (const qualifier of qualifiers) {
      if (qualifier === "optional") optional = true;
      else if (qualifier === "object") object = true;
      else throw new PlainTypeSyntaxError(`Unknown declaration qualifier ${JSON.stringify(qualifier)}`, line);
    }
    cursor = close + 1;
  }
  if (source[cursor] !== ":") throw new PlainTypeSyntaxError("Expected ':' after the declaration name", line);
  cursor += 1;
  if (source[cursor] === " ") cursor += 1;
  return { name, optional, object, body: source.slice(cursor) };
}

/** `:Concept: description` — how v3 names a root, alternative, or definition. */
function parseV3ConceptDeclaration(source: string, line: number): V2Declaration {
  const match = /^:([A-Za-z0-9+._-]+):(?: ([\s\S]*))?$/.exec(source);
  if (match === null) throw new PlainTypeSyntaxError("Expected a :ConceptName: declaration", line);
  return { name: match[1] ?? "", optional: false, object: false, body: match[2] ?? "" };
}

/** `name (optional) - description …` — how v3 declares a property, as a ***plain attribute. */
function parseV3AttributeDeclaration(source: string, line: number): V2Declaration {
  let nameToken: string;
  if (source.startsWith('"')) {
    nameToken = source.slice(0, endOfJsonStringToken(source, 0, line));
  } else {
    const match = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(source);
    if (match === null) throw new PlainTypeSyntaxError("Expected a safe name or JSON string", line);
    nameToken = match[0];
  }
  const name = parsePropertyName(nameToken, line);
  let cursor = nameToken.length;
  let optional = false;
  if (source.startsWith(" (optional)", cursor)) {
    optional = true;
    cursor += " (optional)".length;
  }
  if (!source.startsWith(" - ", cursor)) {
    throw new PlainTypeSyntaxError("Expected ' - ' between the attribute name and its description", line);
  }
  return { name, optional, object: false, body: source.slice(cursor + 3) };
}

function endOfJsonStringToken(source: string, start: number, line: number): number {
  let escaped = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === '"') {
      return index + 1;
    }
  }
  throw new PlainTypeSyntaxError("Unterminated JSON string token", line);
}

function lastUnquotedSeparator(source: string, separator: string): number {
  let quoted = false;
  let escaped = false;
  let found = -1;
  for (let index = 0; index <= source.length - separator.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (source.startsWith(separator, index)) found = index;
  }
  return found;
}

function dialectDeclaredBy(node: JsonNode): string | null {
  if (node.type !== "object") return null;
  const declaration = node.entries.find(
    ({ key, value }) => key === "$schema" && value.type === "string",
  );
  return declaration?.value.type === "string" ? declaration.value.value : null;
}

function parseBullets(lines: readonly string[], startIndex: number): Bullet[] {
  const roots: Bullet[] = [];
  const lists: Bullet[][] = [roots];

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.includes("\t")) {
      throw new PlainTypeSyntaxError("Tabs are not allowed for indentation", index + 1);
    }
    if (line.trim() === "") continue;
    const bulletMatch = /^( *)(- )([\s\S]*)$/.exec(line);
    const commentMatch = /^( *)#(?: ([\s\S]*))?$/.exec(line);
    if (bulletMatch === null && commentMatch === null) {
      throw new PlainTypeSyntaxError("Expected a bullet clause or '# ' description", index + 1);
    }
    const spaces = (bulletMatch?.[1] ?? commentMatch?.[1])?.length ?? 0;
    if (spaces % 2 !== 0) {
      throw new PlainTypeSyntaxError("Indentation must use multiples of two spaces", index + 1);
    }
    const depth = spaces / 2;
    while (lists.length > depth + 1) lists.pop();
    if (depth > lists.length) {
      throw new PlainTypeSyntaxError("Indentation skipped a nesting level", index + 1);
    }
    if (depth === lists.length) {
      const parentList = lists[depth - 1];
      const parent = parentList?.at(-1);
      if (parent === undefined) {
        throw new PlainTypeSyntaxError("An indented clause needs a parent clause", index + 1);
      }
      lists.push(parent.children);
    }
    const comment = commentMatch === null ? null : commentMatch[2] ?? "";
    const text = comment === null
      ? bulletMatch?.[3] ?? ""
      : `Its description is ${jsonString(comment)}.`;
    if (text === "") throw new PlainTypeSyntaxError("A bullet clause cannot be empty", index + 1);
    lists[depth]?.push({ text, line: index + 1, children: [] });
  }
  return roots;
}

function schemaFromBullets(bullets: readonly Bullet[]): JsonNode {
  if (bullets.length === 1) {
    const only = bullets[0];
    if (only !== undefined && only.text === ALLOW_ALL) {
      requireNoChildren(only);
      return { type: "boolean", value: true };
    }
    if (only !== undefined && only.text === DENY_ALL) {
      requireNoChildren(only);
      return { type: "boolean", value: false };
    }
    if (only !== undefined && only.text === EMPTY_SCHEMA) {
      requireNoChildren(only);
      return objectNode([]);
    }
  }

  const marker = bullets.find(
    ({ text }) => text === ALLOW_ALL || text === DENY_ALL || text === EMPTY_SCHEMA,
  );
  if (marker !== undefined) {
    throw new PlainTypeSyntaxError("A boolean or empty schema marker must be the only clause", marker.line);
  }
  return objectNode(bullets.flatMap(entriesFromBullet));
}

function entriesFromBullet(bullet: Bullet): JsonObjectEntry[] {
  if (bullet.text === PROPERTIES_CLAUSE) return propertyEntriesFromBullet(bullet);
  if (bullet.text === ALLOWED_TYPES_CLAUSE) return allowedTypeEntriesFromBullet(bullet);

  const legacyRequired = terminalJsonValue(bullet.text, LEGACY_REQUIRED_LEAD);
  if (legacyRequired !== null) {
    requireNoChildren(bullet);
    const value = parseEmbeddedJson(legacyRequired, bullet.line);
    const codec = VALUE_CODECS_2020_12.find(({ keyword }) => keyword === "required");
    if (codec === undefined || !codec.accepts(value)) {
      throw new PlainTypeSyntaxError("Legacy required properties must be a unique array of strings", bullet.line);
    }
    return [{ key: "required", value }];
  }

  for (const codec of VALUE_CODECS_2020_12) {
    const raw = terminalJsonValue(bullet.text, codec.lead);
    if (raw === null) continue;
    requireNoChildren(bullet);
    const value = parseEmbeddedJson(raw, bullet.line);
    if (!codec.accepts(value)) {
      throw new PlainTypeSyntaxError(
        `The value does not have the required shape for ${JSON.stringify(codec.keyword)}; use the exact-entry clause to preserve it opaquely`,
        bullet.line,
      );
    }
    return [{ key: codec.keyword, value }];
  }

  const exactRaw = terminalJsonValue(bullet.text, EXACT_ENTRY_LEAD);
  if (exactRaw !== null) {
    requireNoChildren(bullet);
    const pair = parseEmbeddedJson(exactRaw, bullet.line);
    if (pair.type !== "array" || pair.items.length !== 2 || pair.items[0]?.type !== "string") {
      throw new PlainTypeSyntaxError(
        "An exact entry must be a two-item JSON array containing a string name and its value",
        bullet.line,
      );
    }
    const value = pair.items[1];
    if (value === undefined) throw new PlainTypeSyntaxError("The exact entry has no value", bullet.line);
    return [{ key: pair.items[0].value, value }];
  }

  for (const codec of SCHEMA_CODECS_2020_12) {
    if (bullet.text !== codec.clause) continue;
    if (bullet.children.length === 0) {
      throw new PlainTypeSyntaxError(`${JSON.stringify(codec.keyword)} needs a nested schema`, bullet.line);
    }
    return [{ key: codec.keyword, value: schemaFromBullets(bullet.children) }];
  }

  for (const codec of SCHEMA_MAP_CODECS_2020_12) {
    if (bullet.text !== codec.clause) continue;
    return [{ key: codec.keyword, value: schemaMapFromBullet(bullet, codec) }];
  }

  for (const codec of SCHEMA_ARRAY_CODECS_2020_12) {
    if (bullet.text !== codec.clause) continue;
    return [{ key: codec.keyword, value: schemaArrayFromBullet(bullet, codec) }];
  }

  throw new PlainTypeSyntaxError(`Unknown schema clause ${JSON.stringify(bullet.text)}`, bullet.line);
}

function propertyEntriesFromBullet(bullet: Bullet): JsonObjectEntry[] {
  const properties: JsonObjectEntry[] = [];
  const required: JsonNode[] = [];

  for (const child of bullet.children) {
    if (child.text.endsWith(":")) {
      const parsed = structuredPropertyLabel(child);
      if (child.children.length === 0) {
        throw new PlainTypeSyntaxError(`Property ${jsonString(parsed.name)} needs a nested schema`, child.line);
      }
      properties.push({ key: parsed.name, value: schemaFromBullets(child.children) });
      if (parsed.required) required.push({ type: "string", value: parsed.name });
      continue;
    }

    const conversational = propertyFromConversationalBullet(child);
    if (conversational === null) {
      throw new PlainTypeSyntaxError("Expected '<property name>:' or a conversational property sentence", child.line);
    }
    properties.push({ key: conversational.name, value: conversational.schema });
    if (conversational.required) required.push({ type: "string", value: conversational.name });
  }

  return [
    { key: "properties", value: objectNode(properties) },
    ...(required.length === 0 ? [] : [{ key: "required", value: arrayNode(required) }]),
  ];
}

function structuredPropertyLabel(bullet: Bullet): { name: string; required: boolean } {
  if (!bullet.text.endsWith(":")) {
    throw new PlainTypeSyntaxError("Expected '<property name>:' or a conversational property sentence", bullet.line);
  }
  let token = bullet.text.slice(0, -1);
  let required = false;
  if (token.endsWith(" (required)")) {
    required = true;
    token = token.slice(0, -" (required)".length);
  }

  // Read version-1 files emitted before the concise Properties syntax.
  if (token.startsWith("Property ")) token = token.slice("Property ".length);
  return { name: parsePropertyName(token, bullet.line), required };
}

function propertyFromConversationalBullet(
  bullet: Bullet,
): { name: string; required: boolean; schema: JsonNode } | null {
  const requiredConnector = " (required), which ";
  const optionalConnector = ", which ";
  const requiredIndex = bullet.text.lastIndexOf(requiredConnector);
  const optionalIndex = bullet.text.lastIndexOf(optionalConnector);
  const required = requiredIndex >= 0 && optionalIndex === requiredIndex + " (required)".length;
  const connectorIndex = required ? requiredIndex : optionalIndex;
  if (connectorIndex < 0) return null;

  const connector = required ? requiredConnector : optionalConnector;
  const name = parsePropertyName(bullet.text.slice(0, connectorIndex), bullet.line);
  const constraint = `which ${bullet.text.slice(connectorIndex + connector.length)}`;
  let schema: JsonNode;
  if (constraint === "which accepts every value.") {
    schema = { type: "boolean", value: true };
  } else if (constraint === "which accepts no value.") {
    schema = { type: "boolean", value: false };
  } else if (constraint === "which has no constraints.") {
    schema = objectNode([]);
  } else if (constraint.startsWith("which must be ") && constraint.endsWith(".")) {
    schema = schemaFromConversationalTypes(
      constraint.slice("which must be ".length, -1),
      bullet.line,
    );
  } else {
    throw new PlainTypeSyntaxError("Unknown conversational property constraint", bullet.line);
  }

  if (bullet.children.length > 0) {
    if (schema.type !== "object") {
      throw new PlainTypeSyntaxError("Only an object-form conversational property may have descriptions", bullet.line);
    }
    const annotations = schemaFromBullets(bullet.children);
    if (
      annotations.type !== "object" ||
      annotations.entries.some(({ key, value }) => key !== "description" || value.type !== "string")
    ) {
      throw new PlainTypeSyntaxError("Conversational property children must be '# ' descriptions", bullet.line);
    }
    schema = objectNode([...annotations.entries, ...schema.entries]);
  }
  return { name, required, schema };
}

function schemaFromConversationalTypes(source: string, line: number): JsonObject {
  const parts = splitConversationalList(source);
  const types: string[] = [];
  let minLength: JsonNode | null = null;

  for (const part of parts) {
    const parsed = parseConversationalType(part, line);
    types.push(parsed.type);
    if (parsed.minLength !== null) {
      if (minLength !== null) {
        throw new PlainTypeSyntaxError("Only one string type may carry a length constraint", line);
      }
      minLength = parsed.minLength;
    }
  }

  const typeValue: JsonNode = types.length === 1
    ? { type: "string", value: types[0] ?? "" }
    : arrayNode(types.map((value) => ({ type: "string", value })));
  const typeCodec = VALUE_CODECS_2020_12.find(({ keyword }) => keyword === "type");
  if (typeCodec === undefined || !typeCodec.accepts(typeValue)) {
    throw new PlainTypeSyntaxError("Conversational types must be unique JSON Schema types", line);
  }
  return objectNode([
    { key: "type", value: typeValue },
    ...(minLength === null ? [] : [{ key: "minLength", value: minLength }]),
  ]);
}

function splitConversationalList(source: string): string[] {
  const finalSeparator = ", or ";
  const finalIndex = source.lastIndexOf(finalSeparator);
  if (finalIndex < 0) return [source];
  return [
    ...source.slice(0, finalIndex).split(", "),
    source.slice(finalIndex + finalSeparator.length),
  ];
}

function parseConversationalType(part: string, line: number): { type: string; minLength: JsonNode | null } {
  const simple = new Map([
    ["an array", "array"],
    ["a boolean", "boolean"],
    ["an integer", "integer"],
    ["null", "null"],
    ["a number", "number"],
    ["an object", "object"],
    ["a string", "string"],
  ]);
  const simpleType = simple.get(part);
  if (simpleType !== undefined) return { type: simpleType, minLength: null };

  const stringMatch = /^a string containing at least (.+) (character|characters)$/.exec(part);
  if (stringMatch !== null) {
    const value = parseEmbeddedJson(stringMatch[1] ?? "", line);
    const codec = VALUE_CODECS_2020_12.find(({ keyword }) => keyword === "minLength");
    if (codec === undefined || !codec.accepts(value)) {
      throw new PlainTypeSyntaxError("A string length must be a non-negative JSON integer", line);
    }
    const expectedUnit = value.type === "number" && isMathematicalOne(value.raw) ? "character" : "characters";
    if (stringMatch[2] !== expectedUnit) {
      throw new PlainTypeSyntaxError(`Expected ${JSON.stringify(expectedUnit)} for this string length`, line);
    }
    return { type: "string", minLength: value };
  }
  throw new PlainTypeSyntaxError(`Unknown conversational type ${JSON.stringify(part)}`, line);
}

function allowedTypeEntriesFromBullet(bullet: Bullet): JsonObjectEntry[] {
  if (bullet.children.length === 0) {
    throw new PlainTypeSyntaxError("allowed types needs at least one nested type", bullet.line);
  }
  const types: string[] = [];
  let minLength: JsonNode | null = null;
  for (const child of bullet.children) {
    requireNoChildren(child);
    let type = child.text;
    const stringMatch = /^string \(must contain at least (.+) (character|characters)\)$/.exec(type);
    if (stringMatch !== null) {
      type = "string";
      if (minLength !== null) {
        throw new PlainTypeSyntaxError("Only one string type may carry a length constraint", child.line);
      }
      minLength = parseEmbeddedJson(stringMatch[1] ?? "", child.line);
      const codec = VALUE_CODECS_2020_12.find(({ keyword }) => keyword === "minLength");
      if (codec === undefined || !codec.accepts(minLength)) {
        throw new PlainTypeSyntaxError("A string length must be a non-negative JSON integer", child.line);
      }
      const expectedUnit = minLength.type === "number" && isMathematicalOne(minLength.raw)
        ? "character"
        : "characters";
      if (stringMatch[2] !== expectedUnit) {
        throw new PlainTypeSyntaxError(`Expected ${JSON.stringify(expectedUnit)} for this string length`, child.line);
      }
    }
    types.push(type);
  }

  const typeValue: JsonNode = types.length === 1
    ? { type: "string", value: types[0] ?? "" }
    : arrayNode(types.map((value) => ({ type: "string", value })));
  const codec = VALUE_CODECS_2020_12.find(({ keyword }) => keyword === "type");
  if (codec === undefined || !codec.accepts(typeValue)) {
    throw new PlainTypeSyntaxError("allowed types must list unique JSON Schema type names", bullet.line);
  }
  return [
    { key: "type", value: typeValue },
    ...(minLength === null ? [] : [{ key: "minLength", value: minLength }]),
  ];
}

function parsePropertyName(source: string, line: number): string {
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(source)) return source;
  const parsed = parseEmbeddedJson(source, line);
  if (parsed.type !== "string") {
    throw new PlainTypeSyntaxError("A property name must be a bare safe name or JSON string", line);
  }
  return parsed.value;
}

function schemaMapFromBullet(bullet: Bullet, codec: SchemaMapCodec): JsonObject {
  const entries = bullet.children.map((child): JsonObjectEntry => {
    const prefix = `${codec.itemLabel} `;
    if (!child.text.startsWith(prefix) || !child.text.endsWith(":")) {
      throw new PlainTypeSyntaxError(
        `Expected '${codec.itemLabel} <JSON string>:'`,
        child.line,
      );
    }
    const rawName = child.text.slice(prefix.length, -1);
    const name = parseEmbeddedJson(rawName, child.line);
    if (name.type !== "string") {
      throw new PlainTypeSyntaxError(`${codec.itemLabel} names must be JSON strings`, child.line);
    }
    if (child.children.length === 0) {
      throw new PlainTypeSyntaxError(`${codec.itemLabel} ${jsonString(name.value)} needs a nested schema`, child.line);
    }
    return { key: name.value, value: schemaFromBullets(child.children) };
  });
  return objectNode(entries);
}

function schemaArrayFromBullet(bullet: Bullet, codec: SchemaArrayCodec): JsonNode {
  const items = bullet.children.map((child, index): JsonNode => {
    const expected = `${codec.itemLabel} ${index + 1}:`;
    if (child.text !== expected) {
      throw new PlainTypeSyntaxError(`Expected ${JSON.stringify(expected)}`, child.line);
    }
    if (child.children.length === 0) {
      throw new PlainTypeSyntaxError(`${expected.slice(0, -1)} needs a nested schema`, child.line);
    }
    return schemaFromBullets(child.children);
  });
  return arrayNode(items);
}

function terminalJsonValue(text: string, lead: string): string | null {
  const prefix = `${lead} `;
  if (!text.startsWith(prefix) || !text.endsWith(".")) return null;
  return text.slice(prefix.length, -1);
}

function parseEmbeddedJson(source: string, line: number): JsonNode {
  try {
    return parseJson(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PlainTypeSyntaxError(`Invalid embedded JSON: ${message}`, line);
  }
}

function requireNoChildren(bullet: Bullet): void {
  if (bullet.children.length !== 0) {
    throw new PlainTypeSyntaxError("This clause cannot contain nested clauses", bullet.children[0]?.line ?? bullet.line);
  }
}

function indent(depth: number): string {
  return "  ".repeat(depth);
}
