import { UsageError, type NormalizedCatalog } from "./types.ts";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize Mode A JSON into a tools array + optional envelope/cursor metadata.
 */
export function normalizeToolsPayload(raw: unknown): NormalizedCatalog {
  if (Array.isArray(raw)) {
    return {
      tools: raw,
      shape: "toolsArray",
      envelope: false,
    };
  }

  if (!isObject(raw)) {
    throw new UsageError("tools list root must be an object or array");
  }

  // JSON-RPC success: { result: { tools: [...] } }
  if (isObject(raw.result) && Array.isArray(raw.result.tools)) {
    const result = raw.result;
    return {
      tools: result.tools as unknown[],
      nextCursor:
        typeof result.nextCursor === "string" ? result.nextCursor : undefined,
      shape: "jsonRpcResult",
      envelope: false,
    };
  }

  // ListToolsResult or PF envelope
  if (Array.isArray(raw.tools)) {
    const hasSourceId = typeof raw.sourceId === "string";
    const hasSourceVersion = typeof raw.sourceVersion === "string";
    const envelope = hasSourceId || hasSourceVersion;
    return {
      tools: raw.tools as unknown[],
      nextCursor:
        typeof raw.nextCursor === "string" ? raw.nextCursor : undefined,
      sourceId: hasSourceId ? (raw.sourceId as string) : undefined,
      sourceVersion: hasSourceVersion
        ? (raw.sourceVersion as string)
        : undefined,
      shape: envelope ? "pfToolCatalog" : "listToolsResult",
      envelope,
    };
  }

  throw new UsageError(
    "unsupported tools list shape: expected { tools: [...] }, JSON-RPC result, bare array, or PF catalog envelope",
  );
}

export function parseJsonBytes(bytes: Buffer): unknown {
  let text: string;
  try {
    text = bytes.toString("utf8");
  } catch {
    throw new UsageError("file is not valid UTF-8");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new UsageError(`invalid JSON: ${msg}`);
  }
}
