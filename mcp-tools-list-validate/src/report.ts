import fs from "node:fs";
import path from "node:path";
import type {
  ActionConfig,
  Digest,
  Finding,
  InputMode,
  NormalizedCatalog,
  ResultStatus,
  ValidationReport,
} from "./types.ts";
import { AJV_VERSION } from "./schema.ts";
import { ENGINE_VERSION } from "./version.ts";

export function buildReport(args: {
  config: ActionConfig;
  inputMode: InputMode;
  inputPath: string;
  inputSha256: string;
  byteLength: number;
  catalog: NormalizedCatalog;
  digests: Digest[];
  findings: Finding[];
  result: ResultStatus;
}): ValidationReport {
  const errorCount = args.findings.filter((f) => f.severity === "error").length;
  const warningCount = args.findings.filter((f) => f.severity === "warning").length;

  return {
    schemaVersion: "1.0.0",
    engine: {
      name: "mcp-tools-list-validate",
      version: ENGINE_VERSION,
      mcpSchemaVersion: args.config.mcpSchemaVersion,
      ajvVersion: AJV_VERSION,
      profile: args.config.profile,
      inputMode: args.inputMode,
    },
    input: {
      path: args.inputPath,
      sha256: args.inputSha256,
      byteLength: args.byteLength,
      normalizedShape: args.catalog.shape,
      toolCount: args.catalog.tools.length,
      provenanceHint: args.catalog.envelope
        ? "pf-tool-catalog"
        : "backend-or-fixture",
    },
    summary: {
      result: args.result,
      errorCount,
      warningCount,
    },
    digests: args.digests,
    findings: args.findings,
  };
}

export function writeReport(reportPath: string, report: ValidationReport): void {
  const dir = path.dirname(reportPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export function emitAnnotations(findings: Finding[]): void {
  for (const f of findings) {
    const level = f.severity === "error" ? "error" : "warning";
    const title = f.ruleId;
    const message = f.message.replaceAll("\n", " ");
    // Workflow command — file/line optional for JSON catalogs
    console.log(`::${level} title=${title}::${message}`);
  }
}
