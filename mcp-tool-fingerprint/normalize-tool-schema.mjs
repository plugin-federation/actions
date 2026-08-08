/**
 * Strip framework-generated MCP tool schema noise before fingerprinting,
 * catalog record, and LLM-as-judge evaluation.
 *
 * FastMCP / Pydantic commonly emit:
 *   inputSchema:  { type: "object", properties: {...}, title: "list_citiesArguments" }
 *   outputSchema: { type: "object", properties: { result: <actual> }, title: "list_citiesOutput", required: ["result"] }
 *
 * Those titles and the single-property `result` envelope are not part of the
 * MCP tool contract agents see at call time; keeping them pollutes digests and judges.
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
  // e.g. get_weatherDictOutput, list_citiesArguments
  const escaped = toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}(Arguments|Output|DictOutput)$`).test(title);
}

/**
 * FastMCP wraps non-object returns as { properties: { result: T }, required: ["result"] }.
 */
export function isResultEnvelope(schema) {
  if (!isPlainObject(schema) || schema.type !== "object") return false;
  if (!isPlainObject(schema.properties)) return false;
  const keys = Object.keys(schema.properties);
  if (keys.length !== 1 || keys[0] !== "result") return false;
  const required = schema.required;
  if (required !== undefined) {
    if (!Array.isArray(required) || required.length !== 1 || required[0] !== "result") {
      return false;
    }
  }
  // Only unwrap when the envelope title looks generated or title is absent.
  if (schema.title && typeof schema.title === "string") {
    if (
      !schema.title.endsWith("Output") &&
      !schema.title.endsWith("DictOutput") &&
      !schema.title.endsWith("Arguments")
    ) {
      // Keep intentional { result: ... } product schemas with a custom title.
      return false;
    }
  }
  return isPlainObject(schema.properties.result) || Array.isArray(schema.properties.result)
    ? true
    : schema.properties.result !== undefined;
}

/**
 * Normalize a single JSON Schema used as tool inputSchema or outputSchema.
 */
export function normalizeToolJsonSchema(schema, toolName) {
  if (schema === undefined || schema === null) return schema;
  if (!isPlainObject(schema)) return schema;

  let current = deepClone(schema);

  // Unwrap nested FastMCP result envelopes (usually one level).
  for (let i = 0; i < 3; i += 1) {
    if (!isResultEnvelope(current)) break;
    current = deepClone(current.properties.result);
    if (!isPlainObject(current)) break;
  }

  if (isPlainObject(current) && isGeneratedSchemaTitle(current.title, toolName)) {
    delete current.title;
  }
  // Generic Pydantic field title after unwrapping `result`
  if (isPlainObject(current) && current.title === "Result") {
    delete current.title;
  }

  // Drop property-level noise titles only when they are the bare capitalized
  // field name (Pydantic default), e.g. city → "City", temp_c → "Temp C".
  if (isPlainObject(current) && isPlainObject(current.properties)) {
    for (const [key, prop] of Object.entries(current.properties)) {
      if (!isPlainObject(prop) || typeof prop.title !== "string") continue;
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
      // Recurse one level for nested object properties (uncommon).
      if (isPlainObject(prop.properties)) {
        const nested = normalizeToolJsonSchema(prop, toolName);
        current.properties[key] = nested;
      }
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
      next.outputSchema = cleaned;
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
