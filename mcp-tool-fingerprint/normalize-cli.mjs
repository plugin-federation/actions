#!/usr/bin/env node
/**
 * CLI: normalize a tools/list JSON file in place or to --output.
 *   node normalize-cli.mjs --input tools.json --output tools.clean.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { normalizeToolsListPayload } from "./normalize-tool-schema.mjs";

function arg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return "";
  return process.argv[idx + 1] ?? "";
}

const inputPath = arg("--input") || process.env.INPUT_TOOLS_LIST_FILE;
const outputPath =
  arg("--output") || process.env.INPUT_OUTPUT_FILE || inputPath;

if (!inputPath) {
  console.error("--input (or INPUT_TOOLS_LIST_FILE) is required");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(inputPath, "utf8"));
const normalized = normalizeToolsListPayload(raw);
writeFileSync(outputPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
const n = normalized.tools?.length ?? 0;
console.log(`Normalized schemas for ${n} tools → ${outputPath}`);
