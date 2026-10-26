import type { JsonNode, JsonObject } from "./json.js";

export const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

export interface ValueCodec {
  readonly keyword: string;
  /** Fixed controlled-English text immediately before the JSON value. */
  readonly lead: string;
  readonly accepts: (value: JsonNode) => boolean;
}

export interface SchemaCodec {
  readonly keyword: string;
  /** A complete clause ending in a colon. */
  readonly clause: string;
}

export interface SchemaMapCodec extends SchemaCodec {
  readonly itemLabel: string;
}

export interface SchemaArrayCodec extends SchemaCodec {
  readonly itemLabel: string;
}

const anyValue = (_value: JsonNode): boolean => true;
const stringValue = (value: JsonNode): boolean => value.type === "string";
const booleanValue = (value: JsonNode): boolean => value.type === "boolean";
const numberValue = (value: JsonNode): boolean => value.type === "number";
const arrayValue = (value: JsonNode): boolean => value.type === "array";
const uniqueStringArray = (value: JsonNode): boolean => {
  if (value.type !== "array" || !value.items.every((item) => item.type === "string")) return false;
  return new Set(value.items.map((item) => item.type === "string" ? item.value : "")).size === value.items.length;
};
const SIMPLE_TYPES = new Set(["array", "boolean", "integer", "null", "number", "object", "string"]);
const simpleType = (value: JsonNode): boolean => value.type === "string" && SIMPLE_TYPES.has(value.value);
const simpleTypeOrUniqueArray = (value: JsonNode): boolean =>
  simpleType(value) || (
    value.type === "array" &&
    value.items.length > 0 &&
    value.items.every(simpleType) &&
    new Set(value.items.map((item) => item.type === "string" ? item.value : "")).size === value.items.length
  );
const objectOfBooleans = (value: JsonNode): boolean =>
  value.type === "object" && value.entries.every((entry) => entry.value.type === "boolean");
const objectOfUniqueStringArrays = (value: JsonNode): boolean =>
  value.type === "object" && value.entries.every((entry) => uniqueStringArray(entry.value));
const legacyDependencies = (value: JsonNode): boolean =>
  value.type === "object" && value.entries.every(
    (entry) => entry.value.type === "object" || entry.value.type === "boolean" || uniqueStringArray(entry.value),
  );
const anchorString = (value: JsonNode): boolean =>
  value.type === "string" && /^[A-Za-z_][-A-Za-z0-9._]*$/.test(value.value);
const positiveNumber = (value: JsonNode): boolean =>
  value.type === "number" && isPositiveJsonNumber(value.raw);
const nonNegativeInteger = (value: JsonNode): boolean =>
  value.type === "number" && isNonNegativeJsonInteger(value.raw);

function valueCodec(keyword: string, lead: string, accepts: (value: JsonNode) => boolean): ValueCodec {
  return { keyword, lead, accepts };
}

/**
 * Draft 2020-12 keywords whose values are not themselves schemas.
 *
 * Phrases intentionally avoid implications that JSON Schema does not make:
 * properties are not called required, defaults are annotations rather than
 * assigned values, and format is described as an annotation.
 */
export const VALUE_CODECS_2020_12: readonly ValueCodec[] = [
  valueCodec("$schema", "It declares JSON Schema dialect", stringValue),
  valueCodec("$vocabulary", "Its vocabulary declaration is", objectOfBooleans),
  valueCodec("$id", "Its identifier is", stringValue),
  valueCodec("$anchor", "Its anchor is", anchorString),
  valueCodec("$dynamicAnchor", "Its dynamic anchor is", anchorString),
  valueCodec("$ref", "Its reference is", stringValue),
  valueCodec("$dynamicRef", "Its dynamic reference is", stringValue),
  valueCodec("label", "Its sensitivity label is", stringValue),
  valueCodec("$comment", "Its implementation comment is", stringValue),

  valueCodec("type", "Its allowed type or types are", simpleTypeOrUniqueArray),
  valueCodec("enum", "Its allowed values are", arrayValue),
  valueCodec("const", "Its only allowed value is", anyValue),
  valueCodec("multipleOf", "A numeric instance must be a multiple of", positiveNumber),
  valueCodec("maximum", "A numeric instance must be at most", numberValue),
  valueCodec("exclusiveMaximum", "A numeric instance must be less than", numberValue),
  valueCodec("minimum", "A numeric instance must be at least", numberValue),
  valueCodec("exclusiveMinimum", "A numeric instance must be greater than", numberValue),
  valueCodec("maxLength", "A string instance may contain at most this many characters:", nonNegativeInteger),
  valueCodec("minLength", "A string instance must contain at least this many characters:", nonNegativeInteger),
  valueCodec("pattern", "A string instance must match this regular expression:", stringValue),
  valueCodec("maxItems", "An array instance may contain at most this many items:", nonNegativeInteger),
  valueCodec("minItems", "An array instance must contain at least this many items:", nonNegativeInteger),
  valueCodec("uniqueItems", "Its unique-items requirement is", booleanValue),
  valueCodec("maxContains", "Its contains schema may match at most this many items:", nonNegativeInteger),
  valueCodec("minContains", "Its contains schema must match at least this many items:", nonNegativeInteger),
  valueCodec("maxProperties", "An object instance may contain at most this many properties:", nonNegativeInteger),
  valueCodec("minProperties", "An object instance must contain at least this many properties:", nonNegativeInteger),
  valueCodec("required", "Required properties:", uniqueStringArray),
  valueCodec("dependentRequired", "Its property-dependent required names are", objectOfUniqueStringArrays),

  valueCodec("title", "Its title is", stringValue),
  valueCodec("description", "Its description is", stringValue),
  valueCodec("default", "Its default annotation is", anyValue),
  valueCodec("deprecated", "Its deprecated annotation is", booleanValue),
  valueCodec("readOnly", "Its read-only annotation is", booleanValue),
  valueCodec("writeOnly", "Its write-only annotation is", booleanValue),
  valueCodec("examples", "Its example annotations are", arrayValue),
  valueCodec("format", "Its format annotation is", stringValue),
  valueCodec("contentEncoding", "Its content-encoding annotation is", stringValue),
  valueCodec("contentMediaType", "Its content-media-type annotation is", stringValue),

  // Reserved legacy keywords recognized by the 2020-12 meta-schema. They are
  // transported without silently migrating their meaning.
  valueCodec("$recursiveAnchor", "Its legacy recursive anchor is", anchorString),
  valueCodec("$recursiveRef", "Its legacy recursive reference is", stringValue),
  valueCodec("dependencies", "Its legacy dependencies value is", legacyDependencies),
] as const;

export const SCHEMA_CODECS_2020_12: readonly SchemaCodec[] = [
  { keyword: "not", clause: "The schema it must not satisfy is:" },
  { keyword: "if", clause: "Its condition schema is:" },
  { keyword: "then", clause: "Its then-branch schema is:" },
  { keyword: "else", clause: "Its else-branch schema is:" },
  { keyword: "items", clause: "Its item schema is:" },
  { keyword: "contains", clause: "Its contains schema is:" },
  { keyword: "additionalProperties", clause: "Its additional-property schema is:" },
  { keyword: "propertyNames", clause: "Its property-name schema is:" },
  { keyword: "unevaluatedItems", clause: "Its unevaluated-item schema is:" },
  { keyword: "unevaluatedProperties", clause: "Its unevaluated-property schema is:" },
  { keyword: "contentSchema", clause: "Its content schema annotation is:" },
] as const;

export const SCHEMA_MAP_CODECS_2020_12: readonly SchemaMapCodec[] = [
  { keyword: "$defs", clause: "Its reusable definition schemas are:", itemLabel: "Definition" },
  { keyword: "properties", clause: "Its property schemas are:", itemLabel: "Property" },
  { keyword: "patternProperties", clause: "Its pattern-property schemas are:", itemLabel: "Pattern" },
  { keyword: "dependentSchemas", clause: "Its property-dependent schemas are:", itemLabel: "Dependency" },
  { keyword: "definitions", clause: "Its legacy definition schemas are:", itemLabel: "Definition" },
] as const;

export const SCHEMA_ARRAY_CODECS_2020_12: readonly SchemaArrayCodec[] = [
  { keyword: "allOf", clause: "Every one of these schemas must be satisfied:", itemLabel: "Schema" },
  { keyword: "anyOf", clause: "At least one of these schemas must be satisfied:", itemLabel: "Schema" },
  { keyword: "oneOf", clause: "Exactly one of these schemas must be satisfied:", itemLabel: "Schema" },
  { keyword: "prefixItems", clause: "Its positional item schemas are:", itemLabel: "Position" },
] as const;

/** Draft 6/7 and earlier represented tuple validation as an array-valued items. */
export const LEGACY_ITEMS_ARRAY_CODEC: SchemaArrayCodec = {
  keyword: "items",
  clause: "Its legacy positional item schemas are:",
  itemLabel: "Position",
};

/** Draft 2019-09 and earlier schema-bearing keywords, used only by legacy profiles later. */
export const LEGACY_SCHEMA_CODECS: readonly SchemaCodec[] = [
  { keyword: "additionalItems", clause: "Its legacy additional-item schema is:" },
] as const;

export function schemaMapContainsOnlySchemas(value: JsonObject): boolean {
  return value.entries.every(({ value: child }) => child.type === "object" || child.type === "boolean");
}

function jsonNumberParts(raw: string): { negative: boolean; digits: string; scale: bigint } {
  const match = /^(-)?(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(raw);
  if (match === null) throw new TypeError(`Invalid JSON number token ${JSON.stringify(raw)}`);
  const fraction = match[3] ?? "";
  const exponent = BigInt(match[4] ?? "0");
  return {
    negative: match[1] === "-",
    digits: `${match[2]}${fraction}`,
    scale: BigInt(fraction.length) - exponent,
  };
}

function isPositiveJsonNumber(raw: string): boolean {
  const { negative, digits } = jsonNumberParts(raw);
  return !negative && /[1-9]/.test(digits);
}

function isNonNegativeJsonInteger(raw: string): boolean {
  const { negative, digits, scale } = jsonNumberParts(raw);
  const isZero = !/[1-9]/.test(digits);
  if (negative && !isZero) return false;
  if (isZero || scale <= 0n) return true;
  if (scale > BigInt(digits.length)) return false;
  return /^0+$/.test(digits.slice(-Number(scale)));
}
