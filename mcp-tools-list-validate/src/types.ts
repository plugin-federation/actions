export type Profile = "mcp" | "plugin-federation";
export type Severity = "error" | "warning";
export type InputMode = "file" | "live";
export type ResultStatus = "pass" | "fail" | "error";

export type DigestKind = "tools-array-v1" | "pf-tool-catalog-v1";

export interface Digest {
  kind: DigestKind;
  value: string;
}

export interface Finding {
  ruleId: string;
  code: string;
  severity: Severity;
  message: string;
  toolName?: string;
  toolIndex?: number;
  jsonPath?: string;
  helpUrl?: string;
}

export interface EngineInfo {
  name: string;
  version: string;
  mcpSchemaVersion: string;
  ajvVersion: string;
  profile: Profile;
  inputMode: InputMode;
}

export interface ReportInput {
  path: string;
  sha256: string;
  byteLength: number;
  normalizedShape: string;
  toolCount: number;
  provenanceHint: string;
  mcpHost?: string;
}

export interface ValidationReport {
  schemaVersion: string;
  engine: EngineInfo;
  input: ReportInput;
  summary: {
    result: ResultStatus;
    errorCount: number;
    warningCount: number;
  };
  digests: Digest[];
  findings: Finding[];
}

export interface NormalizedCatalog {
  tools: unknown[];
  nextCursor?: string;
  sourceId?: string;
  sourceVersion?: string;
  shape: string;
  envelope: boolean;
}

export interface ActionConfig {
  toolsListFile: string;
  mcpConfigFile: string;
  /** When mcpServers has multiple entries, select by key. Empty = require exactly one. */
  mcpServer: string;
  profile: Profile;
  failOnWarnings: boolean;
  failOnIncompleteList: boolean;
  reportFile: string;
  sarifFile: string;
  githubAnnotations: boolean;
  maxBytes: number;
  maxTools: number;
  maxPages: number;
  timeoutMs: number;
  deadlineMs: number;
  allowInsecureHttp: boolean;
  allowedHosts: string[];
  mcpSchemaVersion: string;
}

/** Industry-standard mcpServers entry (Claude Desktop / Cursor / VS Code). */
export interface McpServerEntry {
  /** Display key from mcpServers object */
  name: string;
  transport: "stdio" | "http";
  /** stdio */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** http / streamable HTTP */
  url?: string;
  headers?: Record<string, string>;
}

export class UsageError extends Error {
  readonly exitCode = 2 as const;
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export class InternalError extends Error {
  readonly exitCode = 3 as const;
  constructor(message: string) {
    super(message);
    this.name = "InternalError";
  }
}
