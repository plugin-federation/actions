#!/usr/bin/env node
/**
 * Run LLM-as-judge for pending tools using judge definitions from Nexus
 * and provider credentials from the environment (CI secrets).
 *
 * Env:
 *   INPUT_JUDGES_FILE, INPUT_LOOKUP_FILE, INPUT_FINGERPRINTS_FILE,
 *   INPUT_OUTPUT_FILE, INPUT_CATALOG_DIGEST, INPUT_SOURCE_ID
 *   INPUT_PASS_THRESHOLD (optional override of judge.passThreshold)
 *   INPUT_WARN_THRESHOLD (optional override of judge.warnThreshold)
 *   PROVIDER_API_KEY or XAI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY / AZURE_API_KEY
 *   PROVIDER_API_BASE (optional)
 *
 * Model responses should include overallScore (0–100). Outcome is derived:
 *   pass  when score >= passThreshold
 *   warn  when warnThreshold is set and warnThreshold <= score < passThreshold
 *   fail  otherwise (or error if no score / run failed)
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

function clampScore(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function parseScoreField(value) {
  if (typeof value === "number") return clampScore(value);
  if (typeof value === "string") {
    const match = value.match(/(-?\d+(?:\.\d+)?)\s*(?:\/\s*100)?/);
    if (match) return clampScore(Number(match[1]));
  }
  return null;
}

function resolvePassThreshold(judge) {
  const override = env("INPUT_PASS_THRESHOLD") || env("JUDGE_PASS_THRESHOLD");
  if (override !== "") {
    const n = Number(override);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
  }
  const fromJudge = judge.passThreshold ?? judge.pass_threshold;
  if (typeof fromJudge === "number" && Number.isFinite(fromJudge)) {
    return clampScore(fromJudge) ?? 70;
  }
  // Legacy rubric.passThreshold as 0–1 fraction or 0–100 absolute
  const rubric = judge.rubric || {};
  const legacy = rubric.passThreshold ?? rubric.pass_threshold;
  if (typeof legacy === "number" && Number.isFinite(legacy)) {
    if (legacy > 0 && legacy <= 1) return Math.round(legacy * 100);
    return clampScore(legacy) ?? 70;
  }
  return 70;
}

function resolveWarnThreshold(judge, passThreshold) {
  const override = env("INPUT_WARN_THRESHOLD") || env("JUDGE_WARN_THRESHOLD");
  if (override !== "") {
    if (override.toLowerCase() === "none" || override.toLowerCase() === "null") {
      return null;
    }
    const n = Number(override);
    if (Number.isFinite(n) && n >= 0 && n <= 100) {
      return Math.min(n, passThreshold);
    }
  }
  const fromJudge = judge.warnThreshold ?? judge.warn_threshold;
  if (typeof fromJudge === "number" && Number.isFinite(fromJudge)) {
    const clamped = clampScore(fromJudge);
    if (clamped === null) return null;
    return Math.min(clamped, passThreshold);
  }
  return null;
}

function outcomeFromScore(score, passThreshold, warnThreshold) {
  if (score >= passThreshold) return "pass";
  if (warnThreshold !== null && score >= warnThreshold) return "warn";
  return "fail";
}

/**
 * Parse LLM content into score, outcome, summary, and full report.
 */
function parseJudgeResponse(content, passThreshold, warnThreshold) {
  let report = null;
  let score = null;
  let summary = null;
  let outcome = null;

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      report = JSON.parse(jsonMatch[0]);
      score =
        parseScoreField(report.overallScore) ??
        parseScoreField(report.overall_score) ??
        parseScoreField(report.score) ??
        parseScoreField(report["Overall Score"]);
      if (typeof report.summary === "string") {
        summary = report.summary.slice(0, 8000);
      } else if (typeof report.Summary === "string") {
        summary = report.Summary.slice(0, 8000);
      }
      if (
        report.outcome === "pass" ||
        report.outcome === "fail" ||
        report.outcome === "warn" ||
        report.outcome === "error"
      ) {
        outcome = report.outcome;
      }
    }
  } catch {
    // fall through to text heuristics
  }

  if (score === null) {
    // e.g. "Overall Score: 78/100" or "overallScore: 78"
    const textScore = content.match(
      /(?:overall\s*score|score)\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*(?:\/\s*100)?/i,
    );
    if (textScore) score = clampScore(Number(textScore[1]));
  }

  // Score is authoritative when present (overrides model-supplied outcome).
  if (score !== null) {
    outcome = outcomeFromScore(score, passThreshold, warnThreshold);
  } else if (!outcome) {
    // Legacy text responses without a score
    const lower = content.toLowerCase();
    if (/\bfail\b/.test(lower)) {
      outcome = "fail";
    } else if (/\bwarn\b/.test(lower)) {
      outcome = "warn";
    } else if (/\bpass\b/.test(lower)) {
      outcome = "pass";
    } else {
      outcome = "error";
    }
  }

  if (!summary) {
    summary = content.slice(0, 8000);
  }

  return {
    outcome,
    score: score === null ? undefined : score,
    summary,
    report:
      report && typeof report === "object"
        ? {
            ...report,
            overallScore: score ?? report.overallScore,
            passThreshold,
            warnThreshold,
          }
        : score !== null
          ? {
              overallScore: score,
              passThreshold,
              warnThreshold,
              raw: content.slice(0, 4000),
            }
          : undefined,
  };
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
      max_tokens: 4096,
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

const passThreshold = resolvePassThreshold(judge);
const warnThreshold = resolveWarnThreshold(judge, passThreshold);
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
  "### Tool configuration\n{{tool_json}}";

console.log(
  `Judge ${judge.judgeId}@${judge.version}: passThreshold=${passThreshold}` +
    (warnThreshold !== null ? `, warnThreshold=${warnThreshold}` : "") +
    `, pending=${pending.length}`,
);

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
    const parsed = parseJudgeResponse(content, passThreshold, warnThreshold);
    const item = {
      name: p.name,
      toolFingerprint: p.toolFingerprint,
      outcome: parsed.outcome,
      summary: parsed.summary,
      provider: creds.provider,
      model,
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
    };
    if (parsed.score !== undefined) item.score = parsed.score;
    if (parsed.report) item.report = parsed.report;
    items.push(item);
    const scoreLabel =
      parsed.score !== undefined ? ` score=${parsed.score}` : "";
    console.log(
      `judged ${p.name}: ${parsed.outcome}${scoreLabel}` +
        ` (pass≥${passThreshold}` +
        (warnThreshold !== null ? `, warn≥${warnThreshold}` : "") +
        `)`,
    );
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
