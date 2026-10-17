import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPlainType,
  fromJsonSchema,
  parseJson,
  toJsonSchema,
} from "../src/index.js";

const HEADER_V1 = "***plaintype 1***";
const HEADER_V2 = "***plaintype 2***";

function assertV2RoundTrip(json: string): string {
  const plain = fromJsonSchema(json, { style: "conversational" });
  assert.deepEqual(parseJson(toJsonSchema(plain)), parseJson(json));
  assert.equal(formatPlainType(plain), plain);
  return plain;
}

const animalIdentifierJson = String.raw`{
  "title": "AnimalIdentifier",
  "description": "An identifier attached to an animal.",
  "oneOf": [
    {
      "title": "Microchip",
      "type": "object",
      "description": "Identification using an implanted microchip.",
      "properties": {
        "kind": {
          "description": "The identifier kind",
          "const": "microchip"
        },
        "number": {
          "description": "The microchip number",
          "type": "string",
          "pattern": "^[0-9]{15}$"
        },
        "implantedOn": {
          "description": "The implantation date",
          "type": "string",
          "format": "date"
        }
      },
      "required": ["kind", "number"],
      "additionalProperties": false
    },
    {
      "title": "CollarTag",
      "type": "object",
      "description": "Identification using a collar tag.",
      "properties": {
        "kind": {
          "description": "The identifier kind",
          "const": "collar-tag"
        },
        "text": {
          "description": "The text printed on the tag",
          "type": "string",
          "minLength": 1,
          "maxLength": 40
        },
        "phone": {
          "description": "A contact phone number",
          "type": ["string", "null"]
        }
      },
      "required": ["kind", "text"],
      "additionalProperties": true
    },
    {
      "title": "WildlifeBand",
      "type": "object",
      "description": "Identification using a research band.",
      "properties": {
        "kind": {
          "description": "The identifier kind",
          "const": "wildlife-band"
        },
        "bandId": {
          "description": "The band identifier",
          "type": "string",
          "minLength": 1
        },
        "organization": {
          "description": "The responsible organization",
          "type": "string",
          "minLength": 1
        }
      },
      "required": ["kind", "bandId", "organization"],
      "additionalProperties": false
    }
  ]
}`;

const animalIdentifierPlain = `${HEADER_V2}

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
  - WildlifeBand: Identification using a research band.
    - kind: The identifier kind - "wildlife-band".
    - bandId: The band identifier - a string containing at least one character.
    - organization: The responsible organization - a string containing at least one character.
`;

test("v2 renders the approved AnimalIdentifier conversation exactly and round-trips it", () => {
  assert.equal(assertV2RoundTrip(animalIdentifierJson), animalIdentifierPlain);
  assert.deepEqual(parseJson(toJsonSchema(animalIdentifierPlain)), parseJson(animalIdentifierJson));
});

test("an authored v2 object uses required and closed as its defaults", () => {
  const authored = `${HEADER_V2}

- Animal: A record describing an animal.
  - name: The animal's name - a string containing at least one character.
  - nickname (optional): A familiar name - a string, or null.
`;
  const expected = String.raw`{
    "title": "Animal",
    "type": "object",
    "description": "A record describing an animal.",
    "properties": {
      "name": {
        "description": "The animal's name",
        "type": "string",
        "minLength": 1
      },
      "nickname": {
        "description": "A familiar name",
        "type": ["string", "null"]
      }
    },
    "required": ["name"],
    "additionalProperties": false
  }`;

  assert.deepEqual(parseJson(toJsonSchema(authored)), parseJson(expected));
  assert.equal(formatPlainType(authored), authored);
});

test("v2 objects default implicitly and named schemas compile to local references", () => {
  const plain = `${HEADER_V2}

- AnimalFamily: A family tree for an animal
  - animal: The animal represented here - an Animal.
  - parents (optional): Its known parents - an array of Animal.
  - offspring (optional): Its known offspring - an array of AnimalFamily.

  - Definitions:
    - Animal: A reusable animal record
      - id: Its identifier - a UUID string.
      - name: The animal's name - a string containing at least one character.
`;
  const json = String.raw`{
    "title": "AnimalFamily",
    "type": "object",
    "description": "A family tree for an animal",
    "properties": {
      "animal": {
        "description": "The animal represented here",
        "$ref": "#/$defs/Animal"
      },
      "parents": {
        "description": "Its known parents",
        "type": "array",
        "items": {"$ref": "#/$defs/Animal"}
      },
      "offspring": {
        "description": "Its known offspring",
        "type": "array",
        "items": {"$ref": "#"}
      }
    },
    "required": ["animal"],
    "$defs": {
      "Animal": {
        "type": "object",
        "description": "A reusable animal record",
        "properties": {
          "id": {
            "description": "Its identifier",
            "type": "string",
            "format": "uuid"
          },
          "name": {
            "description": "The animal's name",
            "type": "string",
            "minLength": 1
          }
        },
        "required": ["id", "name"],
        "additionalProperties": false
      }
    },
    "additionalProperties": false
  }`;

  assert.deepEqual(parseJson(toJsonSchema(plain)), parseJson(json));
  assert.equal(fromJsonSchema(json, { style: "conversational" }), plain);
  assert.equal(formatPlainType(plain), plain);
});

test("v2 rejects unresolved named schemas and canonicalizes legacy object qualifiers", () => {
  const unresolved = `${HEADER_V2}

- Zoo: A zoo
  - resident: Its resident - an Animal.
`;
  assert.throws(() => toJsonSchema(unresolved), /Unknown schema name "Animal"/);

  const collision = `${HEADER_V2}

- Animal: An animal
  - Definitions:
    - Animal: Another animal
`;
  assert.throws(() => toJsonSchema(collision), /same name as the root schema/);

  const unsupportedDefinitionUnion = `${HEADER_V2}

- Zoo: A zoo
  - Definitions:
    - Animal: An animal. Exactly one of:
      - Cat: A cat
`;
  assert.throws(() => toJsonSchema(unsupportedDefinitionUnion), /reusable definition must be an object/);

  const legacy = `${HEADER_V2}

- Animal (object): An animal.
  - owner (optional, object): Its owner.
`;
  assert.equal(
    formatPlainType(legacy),
    `${HEADER_V2}\n\n- Animal: An animal.\n  - owner (optional): Its owner.\n`,
  );
});

test("v2 preserves explicit reference URIs and mutually recursive definitions", () => {
  const external = String.raw`{
    "title":"Envelope",
    "type":"object",
    "description":"An envelope.",
    "properties":{
      "payload":{"description":"Its payload","$ref":"https://example.test/payload"}
    },
    "required":["payload"],
    "additionalProperties":false
  }`;
  const externalPlain = assertV2RoundTrip(external);
  assert.match(externalPlain, /a reference to "https:\/\/example\.test\/payload"/);

  const recursive = String.raw`{
    "title":"Registry",
    "type":"object",
    "description":"A registry.",
    "properties":{
      "first":{"description":"Its first entry","$ref":"#/$defs/A"}
    },
    "required":["first"],
    "$defs":{
      "A":{
        "type":"object",
        "description":"An A record.",
        "properties":{"next":{"description":"Its next B","$ref":"#/$defs/B"}},
        "required":["next"],
        "additionalProperties":false
      },
      "B":{
        "type":"object",
        "description":"A B record.",
        "properties":{"next":{"description":"Its next A","$ref":"#/$defs/A"}},
        "required":["next"],
        "additionalProperties":false
      }
    },
    "additionalProperties":false
  }`;
  const recursivePlain = assertV2RoundTrip(recursive);
  assert.match(recursivePlain, /- first: Its first entry - an A\./);
  assert.match(recursivePlain, /- next: Its next B - a B\./);
  assert.match(recursivePlain, /- next: Its next A - an A\./);

  const reservedDefinitionDescription = String.raw`{
    "title":"Container",
    "type":"object",
    "description":"A container.",
    "properties":{"animal":{"description":"Its animal","$ref":"#/$defs/Animal"}},
    "required":["animal"],
    "$defs":{
      "Animal":{
        "type":"object",
        "description":"A record. Exactly one of:",
        "properties":{},
        "required":[],
        "additionalProperties":false
      }
    },
    "additionalProperties":false
  }`;
  const reservedPlain = assertV2RoundTrip(reservedDefinitionDescription);
  assert.match(reservedPlain, /Exact JSON Schema:/);
});

test("v2 required-by-default preserves optional markers and declaration order", () => {
  const source = String.raw`{
    "title":"Animal",
    "type":"object",
    "description":"An animal.",
    "properties":{
      "name":{"description":"Its name","type":"string"},
      "age":{"description":"Its age","type":"integer","minimum":0},
      "nickname":{"description":"Its nickname","type":["string","null"]}
    },
    "required":["name","age"],
    "additionalProperties":false
  }`;
  const plain = assertV2RoundTrip(source);

  assert.match(plain, /- name: Its name - a string\./);
  assert.match(plain, /- age: Its age - a non-negative integer\./);
  assert.match(plain, /- nickname \(optional\): Its nickname - a string, or null\./);
  assert.ok(plain.indexOf("- name:") < plain.indexOf("- age:"));
  assert.ok(plain.indexOf("- age:") < plain.indexOf("- nickname (optional):"));
});

test("nested v2 objects are independently closed unless explicitly opened", () => {
  const source = String.raw`{
    "title":"Animal",
    "type":"object",
    "description":"An animal.",
    "properties":{
      "habitat":{
        "type":"object",
        "description":"Where it lives.",
        "properties":{
          "biome":{"description":"The biome","type":"string"}
        },
        "required":["biome"],
        "additionalProperties":true
      },
      "owner":{
        "type":"object",
        "description":"Who cares for it.",
        "properties":{
          "name":{"description":"The owner's name","type":"string"}
        },
        "required":["name"],
        "additionalProperties":false
      }
    },
    "required":["habitat"],
    "additionalProperties":false
  }`;
  const plain = assertV2RoundTrip(source);

  assert.match(plain, /- habitat: Where it lives\./);
  assert.match(plain, /    - Additional properties allowed/);
  assert.match(plain, /- owner \(optional\): Who cares for it\./);
  assert.equal((plain.match(/Additional properties allowed/g) ?? []).length, 1);
});

test("v2 distinguishes closed, open, and unspecified additional properties", () => {
  const prefix = String.raw`{
    "title":"Box",
    "type":"object",
    "description":"A box.",
    "properties":{},
    "required":[]`;
  const fixtures = [
    {
      name: "closed",
      json: `${prefix},"additionalProperties":false}`,
      line: null,
    },
    {
      name: "open",
      json: `${prefix},"additionalProperties":true}`,
      line: "  - Additional properties allowed",
    },
    {
      name: "unspecified",
      json: `${prefix}}`,
      line: "  - Additional properties unspecified",
    },
  ] as const;

  for (const fixture of fixtures) {
    const plain = assertV2RoundTrip(fixture.json);
    if (fixture.line === null) {
      assert.doesNotMatch(plain, /Additional properties/);
    } else {
      assert.ok(plain.includes(fixture.line), fixture.name);
    }
  }

  const authoredClosed = `${HEADER_V2}\n\n- Box: A box.\n`;
  const authoredOpen = `${HEADER_V2}\n\n- Box: A box.\n  - Additional properties allowed\n`;
  const authoredUnspecified = `${HEADER_V2}\n\n- Box: A box.\n  - Additional properties unspecified\n`;
  assert.match(toJsonSchema(authoredClosed, { space: 0 }), /"additionalProperties":false/);
  assert.match(toJsonSchema(authoredOpen, { space: 0 }), /"additionalProperties":true/);
  assert.doesNotMatch(toJsonSchema(authoredUnspecified, { space: 0 }), /additionalProperties/);
});

test("inline enums and delimiter text are tokenized without corrupting descriptions or values", () => {
  const source = String.raw`{
    "title":"Tag",
    "type":"object",
    "description":"A tag.",
    "properties":{
      "kind":{
        "description":"Primary - external kind",
        "enum":["dog", "cat - indoor", "bird, or bat"]
      },
      "literal":{
        "description":"A literal containing a separator",
        "const":"left - right"
      }
    },
    "required":["kind","literal"],
    "additionalProperties":false
  }`;
  const plain = assertV2RoundTrip(source);

  assert.match(
    plain,
    /- kind: Primary - external kind - one of "dog", "cat - indoor", or "bird, or bat"\./,
  );
  assert.match(
    plain,
    /- literal: A literal containing a separator - "left - right"\./,
  );
});

test("v2 preserves friendly raw numeric spellings and falls back for unsupported ordering", () => {
  const friendly = String.raw`{
    "title":"Lengths",
    "type":"object",
    "description":"Raw lengths.",
    "properties":{
      "decimal":{"description":"Decimal spelling","type":"string","minLength":1.0},
      "exponent":{"description":"Exponent spelling","type":"string","minLength":1e0},
      "range":{"description":"An integer range","type":"integer","minimum":-0,"maximum":1e+400}
    },
    "required":["decimal","exponent","range"],
    "additionalProperties":false
  }`;
  const plain = assertV2RoundTrip(friendly);
  assert.match(plain, /at least 1\.0 character/);
  assert.match(plain, /at least 1e0 character/);
  assert.match(plain, /an integer between -0 and 1e\+400/);

  const unsupported = String.raw`{"title":"OutOfOrder","type":"object","description":"A fallback.","properties":{"name":{"description":"A name","minLength":1.00,"type":"string"}},"required":["name"],"additionalProperties":false}`;
  const fallback = assertV2RoundTrip(unsupported);
  assert.match(fallback, /^\*\*\*plaintype 2\*\*\*\n\n- Exact JSON Schema: /);
  assert.ok(fallback.includes('"minLength":1.00,"type":"string"'));
});

test("v2 uses exact whole-schema fallback for shapes compact syntax cannot preserve", () => {
  const fixtures = [
    String.raw`{"title":"Duplicate enum","type":"object","description":"Fallback.","properties":{"kind":{"description":"Kind","enum":["dog","dog"]}},"required":["kind"],"additionalProperties":false}`,
    String.raw`{"title":"Mixed enum","type":"object","description":"Fallback.","properties":{"kind":{"description":"Kind","enum":["dog",1,null]}},"required":["kind"],"additionalProperties":false}`,
    String.raw`{"title":"Unsafe description","type":"object","description":"Fallback.","properties":{"name":{"description":"line one\nline two","type":"string"}},"required":["name"],"additionalProperties":false}`,
    String.raw`{"title":"Unbalanced quote","type":"object","description":"Fallback.","properties":{"name":{"description":"A nickname called \"Buddy","type":"string"}},"required":["name"],"additionalProperties":false}`,
    String.raw`{"title":"Negative length","type":"object","description":"Fallback.","properties":{"name":{"description":"A name","type":"string","minLength":-1}},"required":["name"],"additionalProperties":false}`,
    String.raw`{"title":"Fractional range","type":"object","description":"Fallback.","properties":{"name":{"description":"A name","type":"string","minLength":1,"maxLength":2.5}},"required":["name"],"additionalProperties":false}`,
    String.raw`{"title":"Reserved suffix","type":"object","description":"A thing. Exactly one of:","properties":{"name":{"description":"A name","type":"string"}},"required":["name"],"additionalProperties":false}`,
    String.raw`{"type":"object","title":"Wrong order","description":"Fallback.","properties":{},"required":[],"additionalProperties":false}`,
    String.raw`{"title":"Duplicate member","title":"Still exact","x-number":-0,"x-number":1.00e+400}`,
  ];

  for (const source of fixtures) {
    const plain = assertV2RoundTrip(source);
    assert.match(plain, /^\*\*\*plaintype 2\*\*\*\n\n- Exact JSON Schema: /);
  }
});

test("v1 parsing and formatting retain v1 optional-by-default semantics", () => {
  const optional = `${HEADER_V1}

- Properties:
  - name:
    - Its allowed type or types are "string".
`;
  const required = `${HEADER_V1}

- Properties:
  - name (required):
    - Its allowed type or types are "string".
`;

  assert.deepEqual(
    parseJson(toJsonSchema(optional)),
    parseJson('{"properties":{"name":{"type":"string"}}}'),
  );
  assert.deepEqual(
    parseJson(toJsonSchema(required)),
    parseJson('{"properties":{"name":{"type":"string"}},"required":["name"]}'),
  );
  const formattedOptional = formatPlainType(optional);
  const formattedRequired = formatPlainType(required);
  assert.ok(formattedOptional.startsWith(`${HEADER_V1}\n`));
  assert.ok(formattedRequired.startsWith(`${HEADER_V1}\n`));
  assert.deepEqual(parseJson(toJsonSchema(formattedOptional)), parseJson(toJsonSchema(optional)));
  assert.deepEqual(parseJson(toJsonSchema(formattedRequired)), parseJson(toJsonSchema(required)));
  assert.equal(formatPlainType(formattedOptional), formattedOptional);
  assert.equal(formatPlainType(formattedRequired), formattedRequired);
  assert.ok(fromJsonSchema('{"type":"string"}').startsWith(`${HEADER_V1}\n`));
});

test("the v2 header, unlike v1, makes an unmarked compact property required", () => {
  const source = `${HEADER_V2}

- Animal: An animal.
  - name: Its name - a string.
`;
  const emitted = parseJson(toJsonSchema(source));
  assert.equal(emitted.type, "object");
  assert.deepEqual(
    emitted.entries.map(({ key }) => key),
    ["title", "type", "description", "properties", "required", "additionalProperties"],
  );
  assert.deepEqual(
    emitted.entries.find(({ key }) => key === "required")?.value,
    parseJson('["name"]'),
  );
});
