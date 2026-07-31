#!/usr/bin/env node
/**
 * Compute tool fingerprints matching Nexus material identity:
 * name, description, inputSchema, outputSchema (if present), annotations (if present).
 * Canonicalization: sorted object keys (RFC 8785–compatible for typical JSON Schema).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
}

function fingerprintMaterial(tool) {
  const material = {
    name: tool.name,
    description: typeof tool.description === "string" ? tool.description : "",
    inputSchema: tool.inputSchema ?? tool.input_schema ?? {},
  };
  const outputSchema = tool.outputSchema ?? tool.output_schema;
  if (outputSchema !== undefined && outputSchema !== null) {
    material.outputSchema = outputSchema;
  }
  if (tool.annotations !== undefined && tool.annotations !== null) {
    material.annotations = tool.annotations;
  }
  return material;
}

function toolFingerprint(tool) {
  const canonical = canonicalize(fingerprintMaterial(tool));
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `sha256:${digest}`;
}

const inputPath = process.env.INPUT_TOOLS_LIST_FILE;
const outputPath = process.env.INPUT_OUTPUT_FILE || "tool-fingerprints.json";
if (!inputPath) {
  console.error("INPUT_TOOLS_LIST_FILE is required");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(inputPath, "utf8"));
const tools = Array.isArray(raw.tools) ? raw.tools : Array.isArray(raw) ? raw : null;
if (!tools) {
  console.error("tools-list must be { tools: [...] } or an array");
  process.exit(1);
}

const items = tools.map((tool) => {
  if (!tool || typeof tool.name !== "string") {
    throw new Error("each tool requires a name");
  }
  return {
    name: tool.name,
    toolFingerprint: toolFingerprint(tool),
    tool,
  };
});

const payload = {
  tools: items.map(({ name, toolFingerprint }) => ({ name, toolFingerprint })),
  detailed: items,
};
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Fingerprinted ${items.length} tools → ${outputPath}`);
