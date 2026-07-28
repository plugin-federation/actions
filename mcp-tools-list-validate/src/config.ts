import { UsageError, type ActionConfig, type Profile } from "./types.ts";

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function parseBool(raw: string, defaultValue: boolean): boolean {
  if (raw === "") return defaultValue;
  const v = raw.toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(v)) return true;
  if (["false", "0", "no", "n", "off"].includes(v)) return false;
  throw new UsageError(`invalid boolean for environment value: ${raw}`);
}

function parseIntEnv(raw: string, defaultValue: number, name: string): number {
  if (raw === "") return defaultValue;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new UsageError(`invalid integer for ${name}: ${raw}`);
  }
  return n;
}

function parseProfile(raw: string): Profile {
  const v = raw === "" ? "plugin-federation" : raw;
  if (v !== "mcp" && v !== "plugin-federation") {
    throw new UsageError(`profile must be mcp or plugin-federation, got: ${v}`);
  }
  return v;
}

export function loadConfig(): ActionConfig {
  const toolsListFile = env("INPUT_TOOLS_LIST_FILE");
  const mcpConfigFile = env("INPUT_MCP_CONFIG_FILE");

  if (toolsListFile && mcpConfigFile) {
    throw new UsageError(
      "usage: specify exactly one of tools-list-file or mcp-config-file",
    );
  }
  if (!toolsListFile && !mcpConfigFile) {
    throw new UsageError(
      "usage: specify exactly one of tools-list-file or mcp-config-file",
    );
  }

  const maxToolsRaw = env("INPUT_MAX_TOOLS");
  const allowedHostsRaw = env("INPUT_ALLOWED_HOSTS");

  return {
    toolsListFile,
    mcpConfigFile,
    profile: parseProfile(env("INPUT_PROFILE")),
    failOnWarnings: parseBool(env("INPUT_FAIL_ON_WARNINGS"), false),
    failOnIncompleteList: parseBool(env("INPUT_FAIL_ON_INCOMPLETE_LIST"), false),
    reportFile: env("INPUT_REPORT_FILE") || "mcp-tools-list-report.json",
    sarifFile: env("INPUT_SARIF_FILE"),
    githubAnnotations: parseBool(env("INPUT_GITHUB_ANNOTATIONS"), true),
    maxBytes: parseIntEnv(env("INPUT_MAX_BYTES"), 20 * 1024 * 1024, "max-bytes"),
    maxTools: maxToolsRaw === "" ? 5000 : parseIntEnv(maxToolsRaw, 5000, "max-tools"),
    maxPages: parseIntEnv(env("INPUT_MAX_PAGES"), 50, "max-pages"),
    timeoutMs: parseIntEnv(env("INPUT_TIMEOUT_MS"), 30_000, "timeout-ms"),
    deadlineMs: parseIntEnv(env("INPUT_DEADLINE_MS"), 120_000, "deadline-ms"),
    allowInsecureHttp: parseBool(env("INPUT_ALLOW_INSECURE_HTTP"), false),
    allowedHosts: allowedHostsRaw
      ? allowedHostsRaw.split(",").map((h) => h.trim()).filter(Boolean)
      : [],
    mcpSchemaVersion: env("INPUT_MCP_SCHEMA_VERSION") || "2025-06-18",
  };
}
