import { createHash } from "node:crypto";
import path from "node:path";
import { loadConfig } from "./config.ts";
import { computeDigests } from "./digest.ts";
import { setOutputs } from "./github.ts";
import { parseMcpServersDocument } from "./mcp/config.ts";
import { listToolsLive } from "./mcp/list-tools.ts";
import { parseJsonBytes, normalizeToolsPayload } from "./parse.ts";
import {
  readFileLimited,
  resolveInputPath,
  resolveOutputPath,
} from "./paths.ts";
import { buildReport, emitAnnotations, writeReport } from "./report.ts";
import { runRules } from "./rules.ts";
import {
  InternalError,
  UsageError,
  type Digest,
  type InputMode,
  type NormalizedCatalog,
  type ResultStatus,
} from "./types.ts";

function digestOf(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function decideResult(
  errorCount: number,
  warningCount: number,
  failOnWarnings: boolean,
): ResultStatus {
  if (errorCount > 0) return "fail";
  if (failOnWarnings && warningCount > 0) return "fail";
  return "pass";
}

export async function main(): Promise<number> {
  const config = loadConfig();

  if (config.mcpSchemaVersion !== "2025-06-18") {
    throw new UsageError(
      `unsupported mcp-schema-version: ${config.mcpSchemaVersion} (only 2025-06-18)`,
    );
  }

  let catalog: NormalizedCatalog;
  let inputMode: InputMode;
  let inputPath: string;
  let inputSha256: string;
  let byteLength: number;
  let mcpHost: string | undefined;

  if (config.toolsListFile) {
    inputMode = "file";
    inputPath = config.toolsListFile;
    const resolved = resolveInputPath(config.toolsListFile);
    const bytes = readFileLimited(resolved, config.maxBytes);
    inputSha256 = digestOf(bytes);
    byteLength = bytes.length;
    catalog = normalizeToolsPayload(parseJsonBytes(bytes));
  } else {
    inputMode = "live";
    inputPath = config.mcpConfigFile;
    const resolved = resolveInputPath(config.mcpConfigFile);
    const bytes = readFileLimited(resolved, config.maxBytes);
    inputSha256 = digestOf(bytes);
    byteLength = bytes.length;
    const raw = parseJsonBytes(bytes);
    const server = parseMcpServersDocument(raw, config.mcpServer);
    // stdio command/args are relative to the config file directory by default
    const live = await listToolsLive(server, config, path.dirname(resolved));
    mcpHost = live.mcpHost;
    catalog = normalizeToolsPayload({
      tools: live.tools,
      ...(live.nextCursor ? { nextCursor: live.nextCursor } : {}),
    });
    console.log(
      `mode=live server=${server.name} transport=${server.transport} tools=${live.tools.length}`,
    );
  }

  const findings = runRules(catalog, {
    profile: config.profile,
    maxTools: config.maxTools,
    failOnIncompleteList: config.failOnIncompleteList,
  });

  let digests: Digest[] = [];
  try {
    digests = computeDigests(catalog);
  } catch (error) {
    throw new InternalError(
      `digest computation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;
  const result = decideResult(
    errorCount,
    warningCount,
    config.failOnWarnings,
  );

  const reportPath = resolveOutputPath(config.reportFile);
  const report = buildReport({
    config,
    inputMode,
    inputPath,
    inputSha256,
    byteLength,
    catalog,
    digests,
    findings,
    result,
  });
  if (mcpHost) {
    report.input.mcpHost = mcpHost;
    report.input.provenanceHint = "live-mcp";
  } else if (inputMode === "live") {
    report.input.provenanceHint = "live-mcp";
  }
  writeReport(reportPath, report);

  if (config.githubAnnotations) {
    emitAnnotations(findings);
  }

  const toolsArrayDigest =
    digests.find((d) => d.kind === "tools-array-v1")?.value ?? "";
  const pfCatalogDigest =
    digests.find((d) => d.kind === "pf-tool-catalog-v1")?.value ?? "";

  setOutputs({
    result,
    "error-count": String(errorCount),
    "warning-count": String(warningCount),
    "tool-count": String(catalog.tools.length),
    "report-file": reportPath,
    "tools-array-digest": toolsArrayDigest,
    "pf-tool-catalog-digest": pfCatalogDigest,
    "input-mode": inputMode,
  });

  console.log(
    `mode=${inputMode} result=${result} errors=${errorCount} warnings=${warningCount} tools=${catalog.tools.length}`,
  );

  return result === "pass" ? 0 : 1;
}

function failUsage(error: UsageError): never {
  console.error(`error: ${error.message}`);
  setOutputs({
    result: "error",
    "error-count": "0",
    "warning-count": "0",
    "tool-count": "0",
    "report-file": "",
    "tools-array-digest": "",
    "pf-tool-catalog-digest": "",
    "input-mode": "",
  });
  process.exit(2);
}

async function runCli(): Promise<void> {
  try {
    const code = await main();
    process.exit(code);
  } catch (error: unknown) {
    if (error instanceof UsageError) {
      failUsage(error);
    }
    if (error instanceof InternalError) {
      console.error(`internal error: ${error.message}`);
      process.exit(3);
    }
    console.error(
      `internal error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(3);
  }
}

// Bundled Action entry always runs; unit tests import other modules only.
void runCli();
