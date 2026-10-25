/** JSON Schema validation of instances, with Ajv's draft 2020-12 support. */

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export interface ValidationIssue {
  /** JSON Pointer of the value the issue is about (the parent for a missing property). */
  readonly path: string;
  readonly message: string;
}

export type Validator =
  | { readonly ok: true; readonly validate: (value: unknown) => ValidationIssue[] }
  | { readonly ok: false; readonly error: string };

export function compileValidator(schemaJson: string): Validator {
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const check = ajv.compile(JSON.parse(schemaJson));
    return {
      ok: true,
      validate: (value) => {
        if (check(value)) return [];
        return (check.errors ?? []).map((error) => {
          const params: Record<string, unknown> = error.params;
          const extra = typeof params["additionalProperty"] === "string" ? params["additionalProperty"] : null;
          const missing = typeof params["missingProperty"] === "string" ? params["missingProperty"] : null;
          const path = extra === null ? error.instancePath : `${error.instancePath}/${escapePointer(extra)}`;
          const subject = missing ?? extra;
          return { path, message: subject === null ? (error.message ?? "is invalid") : `${error.message ?? "is invalid"}: ${subject}` };
        });
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function escapePointer(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}
