/**
 * Strip framework-generated MCP tool schema *noise* before fingerprinting,
 * catalog record, and LLM-as-judge evaluation — without breaking MCP shape.
 *
 * FastMCP / Pydantic commonly emit:
 *   inputSchema:  { type: "object", properties: {...}, title: "list_citiesArguments" }
 *   outputSchema: { type: "object", properties: { result: <T> }, title: "list_citiesOutput", required: ["result"] }
 *
 * MCP Streamable HTTP 2025-06-18 (and PFMTL-TOOL-011) require that when
 * `outputSchema` is present, `outputSchema.type` is `"object"`. Therefore we
 * **must not** unwrap the FastMCP `{ result: T }` envelope into a bare array/
 * primitive schema — that fails tools-list-validate and drops `$defs` needed by
 * `$ref`s. We only strip synthetic `title` fields and trivial property titles.
 */

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * True when title is an auto-generated FastMCP/Pydantic wrapper name for this tool.
 */
export function isGeneratedSchemaTitle(title, toolName) {
  if (typeof title !== "string" || !toolName) return false;
  if (title === `${toolName}Arguments`) return true;
  if (title === `${toolName}Output`) return true;
  if (title === `${toolName}DictOutput`) return true;
  const escaped = toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}(Arguments|Output|DictOutput)$`).test(title);
}

/**
 * Normalize a single JSON Schema used as tool inputSchema or outputSchema.
 * Preserves MCP-valid object shapes (including FastMCP result envelopes).
 */
export function normalizeToolJsonSchema(schema, toolName) {
  if (schema === undefined || schema === null) return schema;
  if (!isPlainObject(schema)) return schema;

  const current = deepClone(schema);

  if (isGeneratedSchemaTitle(current.title, toolName)) {
    delete current.title;
  }
  if (current.title === "Result") {
    delete current.title;
  }

  // Drop property-level noise titles only when they are the bare capitalized
  // field name (Pydantic default), e.g. city → "City", temp_c → "Temp C".
  if (isPlainObject(current.properties)) {
    for (const [key, prop] of Object.entries(current.properties)) {
      if (!isPlainObject(prop)) continue;
      if (typeof prop.title === "string") {
        const autoTitle =
          key.length > 0 ? key.charAt(0).toUpperCase() + key.slice(1) : key;
        const snakeTitle = key
          .split("_")
          .filter(Boolean)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" ");
        if (
          prop.title === autoTitle ||
          prop.title === snakeTitle ||
          prop.title === "Result"
        ) {
          delete prop.title;
        }
      }
      // Recurse into nested object schemas (not unwrapping).
      if (isPlainObject(prop.properties) || prop.type === "object") {
        current.properties[key] = normalizeToolJsonSchema(prop, toolName);
      } else if (isPlainObject(prop.items)) {
        prop.items = normalizeToolJsonSchema(prop.items, toolName);
      }
    }
  }

  if (isPlainObject(current.items)) {
    current.items = normalizeToolJsonSchema(current.items, toolName);
  }

  // Clean $defs titles without removing definitions (needed for $ref).
  if (isPlainObject(current.$defs)) {
    for (const [defName, defSchema] of Object.entries(current.$defs)) {
      current.$defs[defName] = normalizeToolJsonSchema(defSchema, toolName);
    }
  }
  if (isPlainObject(current.definitions)) {
    for (const [defName, defSchema] of Object.entries(current.definitions)) {
      current.definitions[defName] = normalizeToolJsonSchema(defSchema, toolName);
    }
  }

  return current;
}

/**
 * Normalize MCP tool object fields used for catalog/fingerprint/judge.
 * Returns a shallow-copied tool with cleaned inputSchema / outputSchema.
 */
export function normalizeMcpTool(tool) {
  if (!tool || typeof tool !== "object") return tool;
  const name = typeof tool.name === "string" ? tool.name : "";
  const next = { ...tool };

  const input = tool.inputSchema ?? tool.input_schema;
  if (input !== undefined) {
    next.inputSchema = normalizeToolJsonSchema(input, name) ?? {};
    delete next.input_schema;
  }

  const output = tool.outputSchema ?? tool.output_schema;
  if (output !== undefined && output !== null) {
    const cleaned = normalizeToolJsonSchema(output, name);
    if (cleaned === undefined || cleaned === null) {
      delete next.outputSchema;
      delete next.output_schema;
    } else {
      // Guard: never emit a non-object outputSchema root (MCP / PFMTL-TOOL-011).
      if (isPlainObject(cleaned) && cleaned.type && cleaned.type !== "object") {
        // Re-wrap primitive/array return types into a FastMCP-compatible object
        // envelope so tools-list-validate still accepts the catalog.
        next.outputSchema = {
          type: "object",
          properties: { result: cleaned },
          required: ["result"],
        };
      } else {
        next.outputSchema = cleaned;
      }
      delete next.output_schema;
    }
  }

  return next;
}

export function normalizeToolsListPayload(raw) {
  const tools = Array.isArray(raw?.tools)
    ? raw.tools
    : Array.isArray(raw)
      ? raw
      : null;
  if (!tools) {
    throw new Error("tools-list must be { tools: [...] } or an array");
  }
  const normalizedTools = tools.map((tool) => normalizeMcpTool(tool));
  if (Array.isArray(raw?.tools)) {
    return { ...raw, tools: normalizedTools };
  }
  return { tools: normalizedTools };
}
