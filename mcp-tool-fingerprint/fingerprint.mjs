#!/usr/bin/env node
/**
 * Compute tool fingerprints matching Nexus material identity:
 * name, description, inputSchema, outputSchema (if present), annotations (if present).
 * Canonicalization: sorted object keys (RFC 8785–compatible for typical JSON Schema).
 *
 * Schemas are normalized first (strip FastMCP *Arguments/*Output titles and
 * single-property result envelopes) so framework noise does not change digests
 * or judge input.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { normalizeMcpTool } from "./normalize-tool-schema.mjs";

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

// Optional self-check: node fingerprint.mjs --self-test
if (process.argv.includes("--self-test")) {
  const { normalizeToolJsonSchema, normalizeMcpTool } = await import(
    "./normalize-tool-schema.mjs"
  );
  const cleaned = normalizeToolJsonSchema(
    {
      properties: {},
      title: "list_citiesArguments",
      type: "object",
    },
    "list_cities",
  );
  if (cleaned.title) {
    console.error("self-test failed: title should be stripped");
    process.exit(1);
  }
  if (cleaned.type !== "object") {
    console.error("self-test failed: input must stay object");
    process.exit(1);
  }
  // MCP requires outputSchema.type === "object" — keep FastMCP result envelope.
  const out = normalizeToolJsonSchema(
    {
      properties: {
        result: { items: { type: "string" }, type: "array", title: "Result" },
      },
      required: ["result"],
      title: "list_citiesOutput",
      type: "object",
    },
    "list_cities",
  );
  if (out.type !== "object" || !out.properties?.result) {
    console.error("self-test failed: must keep object envelope", out);
    process.exit(1);
  }
  if (out.title) {
    console.error("self-test failed: generated output title should be stripped");
    process.exit(1);
  }
  // If a bare array is passed, re-wrap for MCP compliance.
  const tool = normalizeMcpTool({
    name: "list_cities",
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "array", items: { type: "string" } },
  });
  if (tool.outputSchema.type !== "object" || !tool.outputSchema.properties?.result) {
    console.error("self-test failed: bare array must re-wrap", tool.outputSchema);
    process.exit(1);
  }
  console.log("self-test ok");
  process.exit(0);
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
  const normalized = normalizeMcpTool(tool);
  return {
    name: normalized.name,
    toolFingerprint: toolFingerprint(normalized),
    tool: normalized,
  };
});

const payload = {
  tools: items.map(({ name, toolFingerprint }) => ({ name, toolFingerprint })),
  detailed: items,
};
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Fingerprinted ${items.length} tools → ${outputPath}`);
