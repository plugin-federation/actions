#!/usr/bin/env node
/**
 * Embed MCP tools (name + description only) via an OpenAI-compatible
 * /embeddings API. Memoize with Nexus tool-analyses using a synthetic judge:
 *
 *   judgeId      = tool-embedding (or INPUT_JUDGE_ID)
 *   judgeVersion = embedding model id
 *   toolFingerprint = sha256 over { name, description } only
 *
 * Schema / annotation changes do not re-trigger embeddings.
 *
 * Env:
 *   INPUT_TOOLS_LIST_FILE (required)
 *   INPUT_OUTPUT_FILE
 *   INPUT_EMBEDDING_MODEL (required unless EMBEDDING_MODEL set)
 *   INPUT_PROVIDER (openai | xai | azure_openai | other)
 *   INPUT_FORCE_RERUN
 *   INPUT_NEXUS_URL, INPUT_TENANT_ID, INPUT_SOURCE_ID, INPUT_ACCESS_TOKEN
 *   INPUT_CATALOG_DIGEST
 *   INPUT_JUDGE_ID (default tool-embedding)
 *   INPUT_BATCH_SIZE (default 32)
 *   PROVIDER_API_KEY / OPENAI_API_KEY / XAI_API_KEY / AZURE_API_KEY
 *   PROVIDER_API_BASE / OPENAI_API_BASE / XAI_API_BASE / AZURE_API_BASE
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const RESERVED_JUDGE_ID = "tool-embedding";

function env(name, fallback = "") {
  return process.env[name] ?? fallback;
}

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

/** Fingerprint material for embeddings: name + description only. */
function embeddingMaterial(tool) {
  return {
    name: typeof tool?.name === "string" ? tool.name : "",
    description: typeof tool?.description === "string" ? tool.description : "",
  };
}

function embeddingFingerprint(tool) {
  const canonical = canonicalize(embeddingMaterial(tool));
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `sha256:${digest}`;
}

function buildEmbeddingInput(tool) {
  const name = typeof tool?.name === "string" ? tool.name.trim() : "";
  const description =
    typeof tool?.description === "string" ? tool.description.trim() : "";
  if (description) {
    return `Tool name: ${name}\nDescription: ${description}`;
  }
  return `Tool name: ${name}`;
}

function resolveCredentials(providerHint) {
  const provider = (providerHint || env("INPUT_PROVIDER") || env("EMBEDDING_PROVIDER") || "openai").toLowerCase();
  if (provider === "xai") {
    return {
      provider: "xai",
      apiKey: env("XAI_API_KEY") || env("PROVIDER_API_KEY"),
      baseUrl: env("XAI_API_BASE") || env("PROVIDER_API_BASE") || "https://api.x.ai/v1",
    };
  }
  if (provider === "azure_openai") {
    return {
      provider: "azure_openai",
      apiKey: env("AZURE_API_KEY") || env("PROVIDER_API_KEY"),
      baseUrl: env("AZURE_API_BASE") || env("PROVIDER_API_BASE"),
    };
  }
  if (provider === "openai") {
    return {
      provider: "openai",
      apiKey: env("OPENAI_API_KEY") || env("PROVIDER_API_KEY"),
      baseUrl: env("OPENAI_API_BASE") || env("PROVIDER_API_BASE") || "https://api.openai.com/v1",
    };
  }
  return {
    provider: "other",
    apiKey: env("PROVIDER_API_KEY") || env("OPENAI_API_KEY"),
    baseUrl: env("PROVIDER_API_BASE") || env("OPENAI_API_BASE") || "https://api.openai.com/v1",
  };
}

async function callEmbeddings({ baseUrl, apiKey, model, inputs }) {
  const url = `${baseUrl.replace(/\/$/, "")}/embeddings`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: inputs,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Embedding HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const body = JSON.parse(text);
  const data = Array.isArray(body?.data) ? body.data : [];
  // OpenAI returns data sorted by index; re-index defensively.
  const byIndex = new Map();
  for (const row of data) {
    if (typeof row?.index === "number" && Array.isArray(row.embedding)) {
      byIndex.set(row.index, row.embedding);
    }
  }
  if (byIndex.size === data.length && byIndex.size === inputs.length) {
    return inputs.map((_, i) => byIndex.get(i));
  }
  // Fall back to array order when index is missing.
  const vectors = data.map((row) => row?.embedding);
  if (vectors.length !== inputs.length || vectors.some((v) => !Array.isArray(v) || v.length === 0)) {
    throw new Error(
      `Embedding response expected ${inputs.length} vectors, got ${vectors.length}`,
    );
  }
  return vectors;
}

async function nexusLookup({ nexusUrl, tenantId, sourceId, accessToken, judgeId, judgeVersion, tools, forceRerun }) {
  const url = `${nexusUrl}/api/v1/tenants/${tenantId}/tool-sources/${sourceId}/tool-analyses/lookup`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      judgeId,
      judgeVersion,
      forceRerun,
      tools: tools.map((t) => ({
        name: t.name,
        toolFingerprint: t.toolFingerprint,
      })),
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Nexus lookup HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text);
}

async function nexusRecord({ nexusUrl, tenantId, sourceId, accessToken, body, requestId }) {
  const url = `${nexusUrl}/api/v1/tenants/${tenantId}/tool-sources/${sourceId}/tool-analyses`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json",
      "idempotency-key": `embed-${env("GITHUB_SHA") || "local"}-${env("GITHUB_RUN_ID") || "0"}`,
      "x-request-id": requestId || `gha-embed-${env("GITHUB_RUN_ID") || "0"}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Nexus record analyses HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : {};
}

/**
 * Rehydrate cached embeddings from Nexus list API (lookup does not return report).
 */
async function nexusListAnalyses({ nexusUrl, tenantId, sourceId, accessToken, limit = 500 }) {
  const url = `${nexusUrl}/api/v1/tenants/${tenantId}/tool-sources/${sourceId}/tool-analyses?limit=${limit}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Nexus list analyses HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const body = JSON.parse(text);
  return Array.isArray(body?.items) ? body.items : [];
}

function pickEmbeddingFromReport(report) {
  if (!report || typeof report !== "object") return null;
  for (const key of ["toolEmbedding", "embedding", "embeddingVector", "vector"]) {
    const value = report[key];
    if (Array.isArray(value) && value.length > 0 && value.every((n) => typeof n === "number")) {
      return value;
    }
  }
  return null;
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) {
    out.push(array.slice(i, i + size));
  }
  return out;
}

// --- main ---

const toolsListFile = env("INPUT_TOOLS_LIST_FILE");
const outputFile = env("INPUT_OUTPUT_FILE") || "tool-embeddings.json";
const model = env("INPUT_EMBEDDING_MODEL") || env("EMBEDDING_MODEL");
const judgeId = env("INPUT_JUDGE_ID") || RESERVED_JUDGE_ID;
const forceRerun = ["true", "1", "yes"].includes(
  (env("INPUT_FORCE_RERUN") || "false").toLowerCase(),
);
const batchSize = Math.max(1, Number(env("INPUT_BATCH_SIZE") || "32") || 32);
const catalogDigest = env("INPUT_CATALOG_DIGEST") || "";

const nexusUrl = (env("INPUT_NEXUS_URL") || env("NEXUS_URL") || "").replace(/\/$/, "");
const tenantId = env("INPUT_TENANT_ID") || "";
const sourceId = env("INPUT_SOURCE_ID") || "";
const accessToken = env("INPUT_ACCESS_TOKEN") || "";
const useNexus = Boolean(nexusUrl && tenantId && sourceId && accessToken);

if (!toolsListFile) {
  console.error("INPUT_TOOLS_LIST_FILE is required");
  process.exit(1);
}
if (!model) {
  console.error("INPUT_EMBEDDING_MODEL (or EMBEDDING_MODEL) is required");
  process.exit(1);
}

const creds = resolveCredentials();
if (!creds.apiKey) {
  console.error(
    `No API key for provider ${creds.provider}. Set OPENAI_API_KEY / XAI_API_KEY / AZURE_API_KEY / PROVIDER_API_KEY.`,
  );
  process.exit(1);
}
if (!creds.baseUrl) {
  console.error("Embedding provider base URL is required (PROVIDER_API_BASE / AZURE_API_BASE / …)");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(toolsListFile, "utf8"));
const tools = Array.isArray(raw.tools) ? raw.tools : Array.isArray(raw) ? raw : null;
if (!tools) {
  console.error("tools-list must be { tools: [...] } or an array");
  process.exit(1);
}

const prepared = tools.map((tool) => {
  if (!tool || typeof tool.name !== "string" || !tool.name) {
    throw new Error("each tool requires a name");
  }
  return {
    name: tool.name,
    tool,
    toolFingerprint: embeddingFingerprint(tool),
    inputText: buildEmbeddingInput(tool),
  };
});

const judgeVersion = model;

console.log(
  `mcp-tool-embed: model=${model} provider=${creds.provider} tools=${prepared.length}` +
    ` fingerprint=name+description judge=${judgeId}@${judgeVersion}` +
    (useNexus ? " cache=nexus" : " cache=none"),
);

if (prepared.length === 0) {
  const empty = {
    embeddingModel: model,
    provider: creds.provider,
    judgeId,
    judgeVersion,
    embeddingInput: "name+description",
    pendingCount: 0,
    cachedCount: 0,
    newCount: 0,
    errorCount: 0,
    items: [],
  };
  if (catalogDigest) empty.catalogDigest = catalogDigest;
  writeFileSync(outputFile, `${JSON.stringify(empty, null, 2)}\n`, "utf8");
  console.log(`No tools to embed → ${outputFile}`);
  process.exit(0);
}

/** @type {Map<string, { vector: number[], source: string }>} */
const vectorsByName = new Map();
let pending = prepared;
/** @type {typeof prepared} */
let analyzed = [];

if (useNexus) {
  const lookup = await nexusLookup({
    nexusUrl,
    tenantId,
    sourceId,
    accessToken,
    judgeId,
    judgeVersion,
    tools: prepared,
    forceRerun,
  });
  const pendingNames = new Set((lookup.pending || []).map((p) => p.name));
  const analyzedNames = new Set((lookup.analyzed || []).map((a) => a.name));
  pending = prepared.filter((p) => pendingNames.has(p.name));
  analyzed = prepared.filter((p) => analyzedNames.has(p.name));
  console.log(`Nexus lookup: pending=${pending.length} analyzed=${analyzed.length}`);

  // Rehydrate cached vectors from completed embedding analyses.
  if (analyzed.length > 0) {
    try {
      const items = await nexusListAnalyses({
        nexusUrl,
        tenantId,
        sourceId,
        accessToken,
      });
      const wanted = new Map(
        analyzed.map((a) => [`${a.name}\0${a.toolFingerprint}`, a.name]),
      );
      for (const item of items) {
        if (item.judgeId !== judgeId) continue;
        if (item.judgeVersion && item.judgeVersion !== judgeVersion) continue;
        if (item.status && item.status !== "completed") continue;
        if (item.outcome === "error") continue;
        const key = `${item.toolName}\0${item.toolFingerprint}`;
        if (!wanted.has(key)) continue;
        const vector = pickEmbeddingFromReport(item.report);
        if (vector) {
          vectorsByName.set(item.toolName, { vector, source: "cache" });
        }
      }
      const missingCache = analyzed.filter((a) => !vectorsByName.has(a.name));
      if (missingCache.length > 0) {
        console.warn(
          `Could not rehydrate ${missingCache.length} cached embedding(s); will re-embed: ` +
            missingCache.map((m) => m.name).join(", "),
        );
        pending = pending.concat(missingCache);
      }
    } catch (error) {
      console.warn(
        "Failed to rehydrate cached embeddings; re-embedding analyzed set:",
        error instanceof Error ? error.message : String(error),
      );
      pending = prepared;
    }
  }
} else {
  console.log("Nexus cache disabled (tenant/source/token not fully set) — embedding all tools");
}

const newItems = [];
const errors = [];

for (const batch of chunk(pending, batchSize)) {
  if (batch.length === 0) continue;
  try {
    const vectors = await callEmbeddings({
      baseUrl: creds.baseUrl,
      apiKey: creds.apiKey,
      model,
      inputs: batch.map((b) => b.inputText),
    });
    for (let i = 0; i < batch.length; i += 1) {
      const entry = batch[i];
      const vector = vectors[i];
      vectorsByName.set(entry.name, { vector, source: "new" });
      newItems.push({
        name: entry.name,
        toolFingerprint: entry.toolFingerprint,
        outcome: "pass",
        summary: `Embedded with ${model} (name+description)`,
        provider: creds.provider,
        model,
        report: {
          toolEmbedding: vector,
          embeddingModel: model,
          embeddingInput: "name+description",
          dimensions: vector.length,
        },
        source: {
          kind: "github_actions",
          runId: env("GITHUB_RUN_ID") || undefined,
          runUrl:
            env("GITHUB_SERVER_URL") && env("GITHUB_REPOSITORY") && env("GITHUB_RUN_ID")
              ? `${env("GITHUB_SERVER_URL")}/${env("GITHUB_REPOSITORY")}/actions/runs/${env("GITHUB_RUN_ID")}`
              : undefined,
          sha: env("GITHUB_SHA") || undefined,
          repositoryId: env("GITHUB_REPOSITORY_ID") || undefined,
        },
      });
      console.log(`embedded ${entry.name}: dims=${vector.length}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`batch embed failed: ${message}`);
    for (const entry of batch) {
      errors.push(entry.name);
      newItems.push({
        name: entry.name,
        toolFingerprint: entry.toolFingerprint,
        outcome: "error",
        summary: message.slice(0, 8000),
        provider: creds.provider,
        model,
      });
    }
  }
}

if (useNexus && newItems.length > 0) {
  const body = {
    judgeId,
    judgeVersion,
    items: newItems,
  };
  if (catalogDigest) {
    body.catalogDigest = catalogDigest;
  }
  await nexusRecord({
    nexusUrl,
    tenantId,
    sourceId,
    accessToken,
    body,
  });
  console.log(`Recorded ${newItems.length} embedding analysis item(s) in Nexus`);
}

const outputItems = prepared.map((p) => {
  const hit = vectorsByName.get(p.name);
  return {
    name: p.name,
    toolFingerprint: p.toolFingerprint,
    dimensions: hit?.vector?.length ?? null,
    toolEmbedding: hit?.vector ?? null,
    source: hit?.source ?? (errors.includes(p.name) ? "error" : "missing"),
  };
});

const payload = {
  embeddingModel: model,
  provider: creds.provider,
  judgeId,
  judgeVersion,
  embeddingInput: "name+description",
  pendingCount: pending.length,
  cachedCount: outputItems.filter((i) => i.source === "cache").length,
  newCount: newItems.filter((i) => i.outcome === "pass").length,
  errorCount: errors.length,
  items: outputItems,
};
if (catalogDigest) {
  payload.catalogDigest = catalogDigest;
}

writeFileSync(outputFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(
  `Wrote embeddings → ${outputFile} (new=${payload.newCount} cache≈${outputItems.filter((i) => i.source === "cache").length} error=${payload.errorCount})`,
);

if (errors.length > 0) {
  process.exit(1);
}
