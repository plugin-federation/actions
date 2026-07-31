#!/usr/bin/env node
/**
 * Run LLM-as-judge for pending tools using judge definitions from Nexus
 * and provider credentials from the environment (CI secrets).
 *
 * Env:
 *   INPUT_JUDGES_FILE, INPUT_LOOKUP_FILE, INPUT_FINGERPRINTS_FILE,
 *   INPUT_OUTPUT_FILE, INPUT_CATALOG_DIGEST
 *   PROVIDER_API_KEY or XAI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY / AZURE_API_KEY
 *   PROVIDER_API_BASE (optional)
 */
import { readFileSync, writeFileSync } from "node:fs";

function env(name, fallback = "") {
  return process.env[name] ?? fallback;
}

function substitute(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    vars[key] !== undefined ? String(vars[key]) : `{{${key}}}`,
  );
}

async function callOpenAiCompatible({ baseUrl, apiKey, model, system, user }) {
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const body = JSON.parse(text);
  return body.choices?.[0]?.message?.content ?? "";
}

async function callAnthropic({ apiKey, model, system, user, baseUrl }) {
  const url = `${(baseUrl || "https://api.anthropic.com").replace(/\/$/, "")}/v1/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      temperature: 0,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Anthropic HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const body = JSON.parse(text);
  const block = body.content?.find((c) => c.type === "text");
  return block?.text ?? "";
}

function parseOutcome(content) {
  const lower = content.toLowerCase();
  let outcome = "error";
  if (/\bpass\b/.test(lower) && !/\bfail\b/.test(lower)) {
    outcome = "pass";
  } else if (/\bfail\b/.test(lower)) {
    outcome = "fail";
  } else if (/\bpass\b/.test(lower)) {
    outcome = "pass";
  }
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.outcome === "pass" || parsed.outcome === "fail" || parsed.outcome === "error") {
        outcome = parsed.outcome;
      }
      if (typeof parsed.summary === "string") {
        return { outcome, summary: parsed.summary.slice(0, 8000) };
      }
    }
  } catch {
    // fall through
  }
  return { outcome, summary: content.slice(0, 8000) };
}

function resolveCredentials(preferredProvider) {
  const provider = (preferredProvider || env("JUDGE_PROVIDER") || "xai").toLowerCase();
  if (provider === "xai") {
    return {
      provider: "xai",
      apiKey: env("XAI_API_KEY") || env("PROVIDER_API_KEY"),
      baseUrl: env("XAI_API_BASE") || env("PROVIDER_API_BASE") || "https://api.x.ai/v1",
      style: "openai",
    };
  }
  if (provider === "openai") {
    return {
      provider: "openai",
      apiKey: env("OPENAI_API_KEY") || env("PROVIDER_API_KEY"),
      baseUrl: env("OPENAI_API_BASE") || env("PROVIDER_API_BASE") || "https://api.openai.com/v1",
      style: "openai",
    };
  }
  if (provider === "azure_openai") {
    return {
      provider: "azure_openai",
      apiKey: env("AZURE_API_KEY") || env("PROVIDER_API_KEY"),
      baseUrl: env("AZURE_API_BASE") || env("PROVIDER_API_BASE"),
      style: "openai",
    };
  }
  if (provider === "anthropic") {
    return {
      provider: "anthropic",
      apiKey: env("ANTHROPIC_API_KEY") || env("PROVIDER_API_KEY"),
      baseUrl: env("ANTHROPIC_API_BASE") || env("PROVIDER_API_BASE") || "",
      style: "anthropic",
    };
  }
  return {
    provider: "other",
    apiKey: env("PROVIDER_API_KEY"),
    baseUrl: env("PROVIDER_API_BASE") || "https://api.openai.com/v1",
    style: "openai",
  };
}

const judgesFile = env("INPUT_JUDGES_FILE");
const lookupFile = env("INPUT_LOOKUP_FILE");
const fingerprintsFile = env("INPUT_FINGERPRINTS_FILE");
const outputFile = env("INPUT_OUTPUT_FILE") || "tool-analysis-results.json";
const catalogDigest = env("INPUT_CATALOG_DIGEST") || "";
const judgeIdFilter = env("INPUT_JUDGE_ID") || "";

const judgesDoc = JSON.parse(readFileSync(judgesFile, "utf8"));
const judges = judgesDoc.items || judgesDoc;
const lookup = JSON.parse(readFileSync(lookupFile, "utf8"));
const fingerprints = JSON.parse(readFileSync(fingerprintsFile, "utf8"));
const detailed = new Map(
  (fingerprints.detailed || []).map((d) => [d.name, d.tool]),
);

const judgeId = judgeIdFilter || lookup.judgeId;
const judge = (Array.isArray(judges) ? judges : []).find((j) => j.judgeId === judgeId);
if (!judge) {
  console.error(`Judge not found in judges file: ${judgeId}`);
  process.exit(1);
}

const pending = lookup.pending || [];
const creds = resolveCredentials(judge.preferredProvider);
if (!creds.apiKey) {
  console.error(
    `No API key for provider ${creds.provider}. Set XAI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY / AZURE_API_KEY / PROVIDER_API_KEY.`,
  );
  process.exit(1);
}

const model =
  env("JUDGE_MODEL") || judge.preferredModel || env("PROVIDER_MODEL") || "grok-3-mini";
const systemPrompt = judge.systemPrompt;
const userTemplate =
  judge.userPromptTemplate ||
  "Evaluate this MCP tool. Reply with JSON: {\"outcome\":\"pass\"|\"fail\",\"summary\":\"...\"}\n\n{{tool_json}}";

const items = [];
for (const p of pending) {
  const tool = detailed.get(p.name);
  if (!tool) {
    items.push({
      name: p.name,
      toolFingerprint: p.toolFingerprint,
      outcome: "error",
      summary: "Tool body missing from fingerprints detailed list",
      provider: creds.provider,
      model,
    });
    continue;
  }
  const toolJson = JSON.stringify(tool, null, 2);
  const user = substitute(userTemplate, {
    tool_json: toolJson,
    tool_name: p.name,
    source_id: env("INPUT_SOURCE_ID") || "",
  });
  try {
    let content;
    if (creds.style === "anthropic") {
      content = await callAnthropic({
        apiKey: creds.apiKey,
        model,
        system: systemPrompt,
        user,
        baseUrl: creds.baseUrl,
      });
    } else {
      if (!creds.baseUrl) {
        throw new Error("PROVIDER_API_BASE / AZURE_API_BASE required for this provider");
      }
      content = await callOpenAiCompatible({
        baseUrl: creds.baseUrl,
        apiKey: creds.apiKey,
        model,
        system: systemPrompt,
        user,
      });
    }
    const parsed = parseOutcome(content);
    items.push({
      name: p.name,
      toolFingerprint: p.toolFingerprint,
      outcome: parsed.outcome,
      summary: parsed.summary,
      provider: creds.provider,
      model,
      source: {
        kind: "github_actions",
        runId: env("GITHUB_RUN_ID") || undefined,
        runUrl: env("GITHUB_SERVER_URL") && env("GITHUB_REPOSITORY") && env("GITHUB_RUN_ID")
          ? `${env("GITHUB_SERVER_URL")}/${env("GITHUB_REPOSITORY")}/actions/runs/${env("GITHUB_RUN_ID")}`
          : undefined,
        sha: env("GITHUB_SHA") || undefined,
        repositoryId: env("GITHUB_REPOSITORY_ID") || undefined,
      },
    });
    console.log(`judged ${p.name}: ${parsed.outcome}`);
  } catch (error) {
    items.push({
      name: p.name,
      toolFingerprint: p.toolFingerprint,
      outcome: "error",
      summary: error instanceof Error ? error.message : String(error),
      provider: creds.provider,
      model,
    });
    console.error(`judge error ${p.name}:`, error);
  }
}

const body = {
  judgeId: judge.judgeId,
  judgeVersion: judge.version,
  items,
};
if (catalogDigest) {
  body.catalogDigest = catalogDigest;
}

writeFileSync(outputFile, `${JSON.stringify(body, null, 2)}\n`, "utf8");
console.log(`Wrote ${items.length} analysis items → ${outputFile}`);
