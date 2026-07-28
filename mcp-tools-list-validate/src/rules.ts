import { ruleIdToCode } from "./ids.ts";
import type {
  Finding,
  NormalizedCatalog,
  Profile,
  Severity,
} from "./types.ts";
import { validateToolSchemas } from "./schema.ts";

const MCP_TOOL_KEYS = new Set([
  "name",
  "title",
  "description",
  "inputSchema",
  "outputSchema",
  "annotations",
  "_meta",
]);

const ANN_KEYS = new Set([
  "title",
  "readOnlyHint",
  "destructiveHint",
  "idempotentHint",
  "openWorldHint",
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * MCP tool name format (SEP-986 Final; tool-name guidance).
 * - Length: 1–64 inclusive
 * - Charset: A–Z a–z 0–9 _ - . /
 * - Case-sensitive; no spaces/commas/other specials (including `:`)
 *
 * Note: 2025-06-18 machine schema only types `name` as string; this is the
 * normative format guidance. Later prose (2025-11-25) uses max 128 and drops
 * `/`; we keep SEP-986’s 64 + `/` as the tighter, Final SEP rule set.
 */
export const MCP_TOOL_NAME_MAX = 64;
export const MCP_TOOL_NAME_RE = /^[A-Za-z0-9_./-]{1,64}$/;

const SECRET_HINT =
  /\b(password|secret|api[_-]?key|private[_-]?key|authorization|bearer\s+[a-z0-9._~+/=-]+)\b/i;

function sev(
  profile: Profile,
  mcp: Severity | "skip",
  pf: Severity | "skip",
): Severity | "skip" {
  return profile === "mcp" ? mcp : pf;
}

function finding(
  ruleId: string,
  severity: Severity,
  message: string,
  extra: Partial<Finding> = {},
): Finding {
  return {
    ruleId,
    code: ruleIdToCode(ruleId),
    severity,
    message,
    helpUrl: `https://github.com/plugin-federation/actions/blob/main/mcp-tools-list-validate/docs/rules.md#${ruleId.toLowerCase()}`,
    ...extra,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalarCount(s: string): number {
  return [...s].length;
}

export interface RuleContext {
  profile: Profile;
  maxTools: number;
  failOnIncompleteList: boolean;
}

export function runRules(
  catalog: NormalizedCatalog,
  ctx: RuleContext,
): Finding[] {
  const findings: Finding[] = [];
  const { profile, maxTools } = ctx;

  // PAGE-001
  if (catalog.nextCursor) {
    const severity: Severity = ctx.failOnIncompleteList ? "error" : "warning";
    findings.push(
      finding(
        "PFMTL-PAGE-001",
        severity,
        `Incomplete tools list: nextCursor is present (${catalog.nextCursor.slice(0, 32)}…)`,
        { jsonPath: "$.nextCursor" },
      ),
    );
  }

  // CAT-001
  {
    const s = sev(profile, "warning", "error");
    if (s !== "skip" && catalog.tools.length > maxTools) {
      findings.push(
        finding(
          "PFMTL-CAT-001",
          s,
          `Catalog has ${catalog.tools.length} tools; max is ${maxTools}`,
          { jsonPath: "$.tools" },
        ),
      );
    }
  }

  // Envelope ENV-* (plugin-federation only when envelope)
  if (catalog.envelope && profile === "plugin-federation") {
    if (
      catalog.sourceId === undefined ||
      typeof catalog.sourceId !== "string" ||
      !UUID_RE.test(catalog.sourceId)
    ) {
      findings.push(
        finding(
          "PFMTL-ENV-001",
          "error",
          "sourceId must be a UUID when PF catalog envelope is present",
          { jsonPath: "$.sourceId" },
        ),
      );
    }
    const sv = catalog.sourceVersion;
    if (
      typeof sv !== "string" ||
      sv.length === 0 ||
      scalarCount(sv) > 255
    ) {
      findings.push(
        finding(
          "PFMTL-ENV-002",
          "error",
          "sourceVersion must contain between 1 and 255 characters",
          { jsonPath: "$.sourceVersion" },
        ),
      );
    }
  }

  const names = new Map<string, number>();

  catalog.tools.forEach((tool, index) => {
    const basePath = `$.tools[${index}]`;

    if (!isObject(tool)) {
      findings.push(
        finding("PFMTL-TOOL-001", "error", "Tool entry must be an object", {
          toolIndex: index,
          jsonPath: basePath,
        }),
      );
      return;
    }

    // META-001 unknown keys
    for (const key of Object.keys(tool)) {
      if (!MCP_TOOL_KEYS.has(key)) {
        findings.push(
          finding(
            "PFMTL-META-001",
            "warning",
            `Unknown tool key "${key}" (not in MCP 2025-06-18 Tool)`,
            { toolIndex: index, jsonPath: `${basePath}.${key}` },
          ),
        );
      }
    }

    // TOOL-002 name present + string
    let nameOk = false;
    let nameValue: string | undefined;
    if (!("name" in tool)) {
      findings.push(
        finding("PFMTL-TOOL-002", "error", "Tool name is required", {
          toolIndex: index,
          jsonPath: `${basePath}.name`,
        }),
      );
    } else if (typeof tool.name !== "string") {
      findings.push(
        finding("PFMTL-TOOL-002", "error", "Tool name must be a string", {
          toolIndex: index,
          jsonPath: `${basePath}.name`,
        }),
      );
    } else {
      nameOk = true;
      nameValue = tool.name;

      // TOOL-014 empty string (MCP name min length 1)
      if (nameValue === "") {
        findings.push(
          finding(
            "PFMTL-TOOL-014",
            "error",
            "Tool name must not be empty (MCP tool names are 1–64 characters)",
            {
              toolName: nameValue,
              toolIndex: index,
              jsonPath: `${basePath}.name`,
            },
          ),
        );
      } else {
        // TOOL-004 length first (clearer messages), then TOOL-003 charset
        const nameLen = scalarCount(nameValue);
        if (nameLen > MCP_TOOL_NAME_MAX) {
          findings.push(
            finding(
              "PFMTL-TOOL-004",
              "error",
              `Tool name exceeds ${MCP_TOOL_NAME_MAX} characters (${nameLen}); MCP tool names MUST be 1–${MCP_TOOL_NAME_MAX}`,
              {
                toolName: nameValue,
                toolIndex: index,
                jsonPath: `${basePath}.name`,
              },
            ),
          );
        } else if (!MCP_TOOL_NAME_RE.test(nameValue)) {
          findings.push(
            finding(
              "PFMTL-TOOL-003",
              "error",
              `Tool name "${nameValue}" is not a valid MCP tool name (allowed: A–Z a–z 0–9 _ - . /; length 1–${MCP_TOOL_NAME_MAX}; SEP-986)`,
              {
                toolName: nameValue,
                toolIndex: index,
                jsonPath: `${basePath}.name`,
              },
            ),
          );
        }

        // CAT-002 duplicates
        if (names.has(nameValue)) {
          findings.push(
            finding(
              "PFMTL-CAT-002",
              "error",
              `Duplicate tool name "${nameValue}"`,
              {
                toolName: nameValue,
                toolIndex: index,
                jsonPath: `${basePath}.name`,
              },
            ),
          );
        } else {
          names.set(nameValue, index);
        }
      }
    }

    // description
    if ("description" in tool) {
      if (typeof tool.description !== "string") {
        findings.push(
          finding(
            "PFMTL-TOOL-006",
            "error",
            "description must be a string when present",
            {
              toolName: nameValue,
              toolIndex: index,
              jsonPath: `${basePath}.description`,
            },
          ),
        );
      } else {
        const s = sev(profile, "warning", "error");
        if (s !== "skip" && scalarCount(tool.description) > 4000) {
          findings.push(
            finding(
              "PFMTL-TOOL-005",
              s,
              `description exceeds 4000 characters (${scalarCount(tool.description)})`,
              {
                toolName: nameValue,
                toolIndex: index,
                jsonPath: `${basePath}.description`,
              },
            ),
          );
        }
        if (SECRET_HINT.test(tool.description)) {
          findings.push(
            finding(
              "PFMTL-SEC-001",
              "warning",
              "description may contain secret-like language (best-effort heuristic)",
              {
                toolName: nameValue,
                toolIndex: index,
                jsonPath: `${basePath}.description`,
              },
            ),
          );
        }
      }
    }

    // title
    if ("title" in tool && typeof tool.title !== "string") {
      findings.push(
        finding("PFMTL-TOOL-012", "error", "title must be a string when present", {
          toolName: nameValue,
          toolIndex: index,
          jsonPath: `${basePath}.title`,
        }),
      );
    }

    // inputSchema
    if (!("inputSchema" in tool)) {
      findings.push(
        finding("PFMTL-TOOL-007", "error", "inputSchema is required", {
          toolName: nameValue,
          toolIndex: index,
          jsonPath: `${basePath}.inputSchema`,
        }),
      );
    } else if (!isObject(tool.inputSchema)) {
      findings.push(
        finding("PFMTL-TOOL-007", "error", "inputSchema must be an object", {
          toolName: nameValue,
          toolIndex: index,
          jsonPath: `${basePath}.inputSchema`,
        }),
      );
    } else {
      const schema = tool.inputSchema;
      if (schema.type !== "object") {
        findings.push(
          finding(
            "PFMTL-TOOL-008",
            "error",
            'inputSchema.type must be the string "object"',
            {
              toolName: nameValue,
              toolIndex: index,
              jsonPath: `${basePath}.inputSchema.type`,
            },
          ),
        );
      }
      if ("properties" in schema && !isObject(schema.properties)) {
        findings.push(
          finding(
            "PFMTL-TOOL-009",
            "error",
            "inputSchema.properties must be an object when present",
            {
              toolName: nameValue,
              toolIndex: index,
              jsonPath: `${basePath}.inputSchema.properties`,
            },
          ),
        );
      }
      if (
        "properties" in schema &&
        isObject(schema.properties) &&
        Object.keys(schema.properties).length === 0
      ) {
        findings.push(
          finding(
            "PFMTL-SCHEMA-003",
            "warning",
            "inputSchema.properties is empty",
            {
              toolName: nameValue,
              toolIndex: index,
              jsonPath: `${basePath}.inputSchema.properties`,
            },
          ),
        );
      }
      if ("required" in schema) {
        const req = schema.required;
        if (
          !Array.isArray(req) ||
          !req.every((x) => typeof x === "string")
        ) {
          findings.push(
            finding(
              "PFMTL-TOOL-010",
              "error",
              "inputSchema.required must be an array of strings when present",
              {
                toolName: nameValue,
                toolIndex: index,
                jsonPath: `${basePath}.inputSchema.required`,
              },
            ),
          );
        }
      }
    }

    // outputSchema if present
    if ("outputSchema" in tool) {
      if (!isObject(tool.outputSchema)) {
        findings.push(
          finding(
            "PFMTL-TOOL-011",
            "error",
            "outputSchema must be an object when present",
            {
              toolName: nameValue,
              toolIndex: index,
              jsonPath: `${basePath}.outputSchema`,
            },
          ),
        );
      } else if (tool.outputSchema.type !== "object") {
        findings.push(
          finding(
            "PFMTL-TOOL-011",
            "error",
            'outputSchema.type must be the string "object" when present',
            {
              toolName: nameValue,
              toolIndex: index,
              jsonPath: `${basePath}.outputSchema.type`,
            },
          ),
        );
      }
    }

    // annotations
    if ("annotations" in tool) {
      if (!isObject(tool.annotations)) {
        findings.push(
          finding(
            "PFMTL-TOOL-013",
            "error",
            "annotations must be an object when present",
            {
              toolName: nameValue,
              toolIndex: index,
              jsonPath: `${basePath}.annotations`,
            },
          ),
        );
      } else {
        const ann = tool.annotations;
        for (const [k, v] of Object.entries(ann)) {
          if (!ANN_KEYS.has(k)) {
            findings.push(
              finding(
                "PFMTL-ANN-002",
                "warning",
                `Unknown annotation key "${k}"`,
                {
                  toolName: nameValue,
                  toolIndex: index,
                  jsonPath: `${basePath}.annotations.${k}`,
                },
              ),
            );
          }
          if (k === "title" && typeof v !== "string") {
            findings.push(
              finding(
                "PFMTL-ANN-001",
                "error",
                "annotations.title must be a string",
                {
                  toolName: nameValue,
                  toolIndex: index,
                  jsonPath: `${basePath}.annotations.title`,
                },
              ),
            );
          }
          if (
            ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"].includes(
              k,
            ) &&
            typeof v !== "boolean"
          ) {
            findings.push(
              finding(
                "PFMTL-ANN-001",
                "error",
                `annotations.${k} must be a boolean`,
                {
                  toolName: nameValue,
                  toolIndex: index,
                  jsonPath: `${basePath}.annotations.${k}`,
                },
              ),
            );
          }
        }
      }
    }

    void nameOk;
  });

  // SCHEMA-001 / SCHEMA-002 via Ajv
  findings.push(...validateToolSchemas(catalog.tools, profile));

  return findings;
}
