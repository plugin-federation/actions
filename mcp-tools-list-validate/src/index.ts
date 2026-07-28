import { createHash } from "node:crypto";
import { loadConfig } from "./config.ts";
import { computeDigests } from "./digest.ts";
import { setOutputs } from "./github.ts";
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

  if (config.mcpConfigFile) {
    throw new UsageError(
      "Mode B (mcp-config-file / live MCP) is not implemented in this release yet; use tools-list-file (Mode A)",
    );
  }

  if (config.mcpSchemaVersion !== "2025-06-18") {
    throw new UsageError(
      `unsupported mcp-schema-version: ${config.mcpSchemaVersion} (only 2025-06-18)`,
    );
  }

  const inputPath = resolveInputPath(config.toolsListFile);
  const bytes = readFileLimited(inputPath, config.maxBytes);
  const raw = parseJsonBytes(bytes);
  const catalog = normalizeToolsPayload(raw);

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
    inputMode: "file",
    inputPath: config.toolsListFile,
    inputSha256: digestOf(bytes),
    byteLength: bytes.length,
    catalog,
    digests,
    findings,
    result,
  });
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
    "input-mode": "file",
  });

  console.log(
    `mode=file result=${result} errors=${errorCount} warnings=${warningCount} tools=${catalog.tools.length}`,
  );

  return result === "pass" ? 0 : 1;
}

function runCli(): void {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      if (error instanceof UsageError) {
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
        process.exitCode = 2;
        return;
      }
      if (error instanceof InternalError) {
        console.error(`internal error: ${error.message}`);
        process.exitCode = 3;
        return;
      }
      console.error(
        `internal error: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 3;
    });
}

// Bundled CLI entry always runs; unit tests import modules other than this file.
runCli();
