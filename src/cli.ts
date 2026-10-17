#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { stdin, stdout } from "node:process";
import {
  formatSchemaPlain,
  fromJsonSchema,
  parseSchemaPlain,
  toJsonSchema,
  type FromJsonOptions,
  type RenderStyle,
} from "./index.js";

const USAGE = `SchemaPlain — lossless controlled English for JSON Schema

Usage:
  schemaplain from-json [input.json] [-o output.schema] [--style structured|conversational] [--dialect URI|none]
  schemaplain to-json [input.schema] [-o output.json] [--compact]
  schemaplain format [input.schema] [-o output.schema] [--style structured|conversational] [--dialect URI|none]
  schemaplain check [input.schema]

Use '-' or omit the input path to read standard input. Output defaults to
standard output. A schema without a $schema declaration is described as Draft
2020-12 unless --dialect changes that context. The context is never inserted
into the emitted JSON Schema. Structured output uses the version-1 grammar;
conversational output uses the version-2 grammar.`;

type Command = "from-json" | "to-json" | "format" | "check";

interface CliOptions {
  readonly command: Command;
  readonly input: string;
  readonly output?: string;
  readonly compact: boolean;
  readonly dialect: string | null | undefined;
  readonly style: RenderStyle | undefined;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const source = await readInput(options.input);
  const renderOptions: FromJsonOptions = {
    ...(options.dialect === undefined ? {} : { defaultDialect: options.dialect }),
    ...(options.style === undefined ? {} : { style: options.style }),
  };
  let result: string;

  switch (options.command) {
    case "from-json":
      result = fromJsonSchema(source, renderOptions);
      break;
    case "to-json":
      result = toJsonSchema(source, { space: options.compact ? 0 : 2 });
      break;
    case "format":
      result = formatSchemaPlain(source, renderOptions);
      break;
    case "check":
      parseSchemaPlain(source);
      result = "SchemaPlain is valid.\n";
      break;
  }

  if (options.output === undefined) {
    stdout.write(result);
  } else {
    await writeFile(options.output, result, "utf8");
  }
}

function parseArguments(arguments_: readonly string[]): CliOptions {
  if (arguments_.length === 0 || arguments_.includes("--help") || arguments_.includes("-h")) {
    stdout.write(`${USAGE}\n`);
    process.exit(0);
  }

  const [commandValue, ...rest] = arguments_;
  if (!isCommand(commandValue)) fail(`Unknown command ${JSON.stringify(commandValue)}`);

  let input: string | undefined;
  let output: string | undefined;
  let compact = false;
  let dialect: string | null | undefined;
  let style: RenderStyle | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "-o" || argument === "--output") {
      output = rest[index + 1];
      if (output === undefined || output.startsWith("-")) {
        fail(`${argument} needs a path; use --output=<path> for a path beginning with '-'`);
      }
      index += 1;
    } else if (argument?.startsWith("--output=")) {
      output = argument.slice("--output=".length);
      if (output === "") fail("--output needs a path");
    } else if (argument === "--compact") {
      compact = true;
    } else if (argument === "--dialect") {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("-")) fail("--dialect needs a URI or 'none'");
      dialect = value === "none" ? null : value;
      index += 1;
    } else if (argument?.startsWith("--dialect=")) {
      const value = argument.slice("--dialect=".length);
      if (value === "") fail("--dialect needs a URI or 'none'");
      dialect = value === "none" ? null : value;
    } else if (argument === "--style") {
      const value = rest[index + 1];
      if (value !== "structured" && value !== "conversational") {
        fail("--style needs 'structured' or 'conversational'");
      }
      style = value;
      index += 1;
    } else if (argument?.startsWith("--style=")) {
      const value = argument.slice("--style=".length);
      if (value !== "structured" && value !== "conversational") {
        fail("--style needs 'structured' or 'conversational'");
      }
      style = value;
    } else if (argument === "-") {
      if (input !== undefined) fail("Only one input may be provided");
      input = argument;
    } else if (argument?.startsWith("-")) {
      fail(`Unknown option ${JSON.stringify(argument)}`);
    } else {
      if (input !== undefined) fail("Only one input may be provided");
      input = argument;
    }
  }

  if (compact && commandValue !== "to-json") fail("--compact is only valid with to-json");
  if (dialect !== undefined && commandValue !== "from-json" && commandValue !== "format") {
    fail("--dialect is only valid with from-json or format");
  }
  if (style !== undefined && commandValue !== "from-json" && commandValue !== "format") {
    fail("--style is only valid with from-json or format");
  }
  if (commandValue === "check" && output !== undefined) fail("check does not write an output file");

  return {
    command: commandValue,
    input: input ?? "-",
    ...(output === undefined ? {} : { output }),
    compact,
    dialect,
    style,
  };
}

function isCommand(value: string | undefined): value is Command {
  return value === "from-json" || value === "to-json" || value === "format" || value === "check";
}

async function readInput(path: string): Promise<string> {
  return path === "-" ? readStandardInput() : readFile(path, "utf8");
}

async function readStandardInput(): Promise<string> {
  stdin.setEncoding("utf8");
  let source = "";
  for await (const chunk of stdin) source += chunk;
  return source;
}

function fail(message: string): never {
  throw new Error(`${message}\n\n${USAGE}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`schemaplain: ${message}\n`);
  process.exitCode = 1;
});
