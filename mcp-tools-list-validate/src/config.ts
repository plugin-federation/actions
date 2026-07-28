import { UsageError, type ActionConfig, type Profile } from "./types.ts";

/**
 * Read a GitHub Actions input.
 *
 * The runner exposes inputs as environment variables named `INPUT_<name>` with
 * the input name uppercased. Spaces become underscores; hyphens may be kept
 * (`INPUT_TOOLS-LIST-FILE`) or converted (`INPUT_TOOLS_LIST_FILE`) depending on
 * runner version. Accept both so local and GHA invocations work.
 */
function input(name: string): string {
  const upper = name.toUpperCase();
  const underscored = name.replace(/[ -]/g, "_").toUpperCase();
  const candidates = [
    `INPUT_${underscored}`,
    `INPUT_${upper}`,
    `INPUT_${name.replace(/ /g, "_").toUpperCase()}`,
  ];
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(process.env, key)) {
      return (process.env[key] ?? "").trim();
    }
  }
  // Fall back to first candidate even if unset
  return (process.env[candidates[0]] ?? "").trim();
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
  const toolsListFile = input("tools-list-file");
  const mcpConfigFile = input("mcp-config-file");

  if (toolsListFile && mcpConfigFile) {
    throw new UsageError(
      "usage: specify exactly one of tools-list-file or mcp-config-file (both were set)",
    );
  }
  if (!toolsListFile && !mcpConfigFile) {
    throw new UsageError(
      "usage: specify exactly one of tools-list-file or mcp-config-file (neither was set)",
    );
  }

  const maxToolsRaw = input("max-tools");
  const allowedHostsRaw = input("allowed-hosts");

  return {
    toolsListFile,
    mcpConfigFile,
    profile: parseProfile(input("profile")),
    failOnWarnings: parseBool(input("fail-on-warnings"), false),
    failOnIncompleteList: parseBool(input("fail-on-incomplete-list"), false),
    reportFile: input("report-file") || "mcp-tools-list-report.json",
    sarifFile: input("sarif-file"),
    githubAnnotations: parseBool(input("github-annotations"), true),
    maxBytes: parseIntEnv(input("max-bytes"), 20 * 1024 * 1024, "max-bytes"),
    maxTools: maxToolsRaw === "" ? 5000 : parseIntEnv(maxToolsRaw, 5000, "max-tools"),
    maxPages: parseIntEnv(input("max-pages"), 50, "max-pages"),
    timeoutMs: parseIntEnv(input("timeout-ms"), 30_000, "timeout-ms"),
    deadlineMs: parseIntEnv(input("deadline-ms"), 120_000, "deadline-ms"),
    allowInsecureHttp: parseBool(input("allow-insecure-http"), false),
    allowedHosts: allowedHostsRaw
      ? allowedHostsRaw.split(",").map((h) => h.trim()).filter(Boolean)
      : [],
    mcpSchemaVersion: input("mcp-schema-version") || "2025-06-18",
  };
}
