import Ajv2020 from "ajv/dist/2020.js";
import AjvDraft07 from "ajv";
import addFormats from "ajv-formats";
import { ruleIdToCode } from "./ids.ts";
import type { Finding, Profile, Severity } from "./types.ts";

const MAX_NODES = 5000;
const MAX_ERRORS = 20;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countNodes(value: unknown, acc = { n: 0 }): number {
  acc.n += 1;
  if (acc.n > MAX_NODES) return acc.n;
  if (Array.isArray(value)) {
    for (const item of value) countNodes(item, acc);
  } else if (isObject(value)) {
    for (const v of Object.values(value)) countNodes(v, acc);
  }
  return acc.n;
}

function hasExternalRef(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasExternalRef);
  if (!isObject(value)) return false;
  if (typeof value.$ref === "string") {
    // Only pure in-document JSON Pointer refs are allowed offline.
    if (!value.$ref.startsWith("#")) return true;
  }
  return Object.values(value).some(hasExternalRef);
}

function schemaSeverity(profile: Profile): Severity {
  return profile === "plugin-federation" ? "error" : "warning";
}

function makeFinding(
  ruleId: string,
  severity: Severity,
  message: string,
  toolName: string | undefined,
  toolIndex: number,
  jsonPath: string,
): Finding {
  return {
    ruleId,
    code: ruleIdToCode(ruleId),
    severity,
    message,
    toolName,
    toolIndex,
    jsonPath,
    helpUrl: `https://github.com/plugin-federation/actions/blob/main/mcp-tools-list-validate/docs/rules.md#${ruleId.toLowerCase()}`,
  };
}

function tryCompile(schema: object): { ok: true } | { ok: false; message: string } {
  const drafts = [
    () => {
      const ajv = new Ajv2020({
        strict: false,
        allErrors: true,
        validateSchema: true,
        $data: false,
      });
      addFormats(ajv);
      ajv.compile(schema);
    },
    () => {
      const ajv = new AjvDraft07({
        strict: false,
        allErrors: true,
        validateSchema: true,
        $data: false,
      });
      addFormats(ajv);
      ajv.compile(schema);
    },
  ];

  const errors: string[] = [];
  for (const run of drafts) {
    try {
      run();
      return { ok: true };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return {
    ok: false,
    message: errors.slice(0, MAX_ERRORS).join("; ") || "schema compile failed",
  };
}

export function validateToolSchemas(
  tools: unknown[],
  profile: Profile,
): Finding[] {
  const findings: Finding[] = [];
  const severity = schemaSeverity(profile);

  tools.forEach((tool, index) => {
    if (!isObject(tool)) return;
    const toolName = typeof tool.name === "string" ? tool.name : undefined;

    if (isObject(tool.inputSchema)) {
      const path = `$.tools[${index}].inputSchema`;
      if (countNodes(tool.inputSchema) > MAX_NODES) {
        findings.push(
          makeFinding(
            "PFMTL-SCHEMA-001",
            severity,
            `schema validation budget exceeded (>${MAX_NODES} nodes)`,
            toolName,
            index,
            path,
          ),
        );
      } else if (hasExternalRef(tool.inputSchema)) {
        findings.push(
          makeFinding(
            "PFMTL-SCHEMA-001",
            severity,
            "inputSchema has external or file $ref; inline all $refs for offline validation",
            toolName,
            index,
            path,
          ),
        );
      } else {
        const started = Date.now();
        const result = tryCompile(tool.inputSchema);
        if (Date.now() - started > 100) {
          findings.push(
            makeFinding(
              "PFMTL-SCHEMA-001",
              severity,
              "schema validation budget exceeded (compile >100ms)",
              toolName,
              index,
              path,
            ),
          );
        } else if (!result.ok) {
          findings.push(
            makeFinding(
              "PFMTL-SCHEMA-001",
              severity,
              `inputSchema failed Ajv meta-validation: ${result.message}`,
              toolName,
              index,
              path,
            ),
          );
        }
      }
    }

    if (isObject(tool.outputSchema)) {
      const path = `$.tools[${index}].outputSchema`;
      if (countNodes(tool.outputSchema) > MAX_NODES) {
        findings.push(
          makeFinding(
            "PFMTL-SCHEMA-002",
            severity,
            `schema validation budget exceeded (>${MAX_NODES} nodes)`,
            toolName,
            index,
            path,
          ),
        );
      } else if (hasExternalRef(tool.outputSchema)) {
        findings.push(
          makeFinding(
            "PFMTL-SCHEMA-002",
            severity,
            "outputSchema has external or file $ref; inline all $refs for offline validation",
            toolName,
            index,
            path,
          ),
        );
      } else {
        const result = tryCompile(tool.outputSchema);
        if (!result.ok) {
          findings.push(
            makeFinding(
              "PFMTL-SCHEMA-002",
              severity,
              `outputSchema failed Ajv meta-validation: ${result.message}`,
              toolName,
              index,
              path,
            ),
          );
        }
      }
    }
  });

  return findings;
}

export const AJV_VERSION = "8.17.x";
