import { UsageError, type McpServerEntry } from "../types.ts";
import {
  expandEnvRecord,
  expandEnvString,
  expandEnvStringArray,
} from "./env.ts";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringMap(value: unknown, context: string): Record<string, string> {
  if (value === undefined) return {};
  if (!isObject(value)) {
    throw new UsageError(`${context} must be an object of string values`);
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== "string") {
      throw new UsageError(`${context}.${k} must be a string`);
    }
    out[k] = v;
  }
  return out;
}

function asStringArray(value: unknown, context: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((x) => typeof x === "string")) {
    throw new UsageError(`${context} must be an array of strings`);
  }
  return value as string[];
}

/**
 * Parse industry-standard mcpServers JSON (Claude Desktop / Cursor / VS Code).
 *
 * Accepts:
 * - `{ "mcpServers": { "name": { ... } } }`
 * - bare `{ "name": { ... } }` when every value looks like a server entry
 * - single-server object with `command` or `url` at the root
 */
export function parseMcpServersDocument(
  raw: unknown,
  selectedServer: string,
): McpServerEntry {
  let servers: Record<string, unknown>;

  if (!isObject(raw)) {
    throw new UsageError("mcp config root must be a JSON object");
  }

  if (isObject(raw.mcpServers)) {
    servers = raw.mcpServers;
  } else if (
    typeof raw.command === "string" ||
    typeof raw.url === "string"
  ) {
    // Single server at root
    servers = { default: raw };
  } else {
    // Treat root as mcpServers map
    servers = raw;
  }

  const names = Object.keys(servers);
  if (names.length === 0) {
    throw new UsageError("mcp config has no servers");
  }

  let name = selectedServer;
  if (!name) {
    if (names.length !== 1) {
      throw new UsageError(
        `mcp config has multiple servers (${names.join(", ")}); set mcp-server input to select one`,
      );
    }
    name = names[0]!;
  } else if (!(name in servers)) {
    throw new UsageError(
      `mcp-server "${name}" not found; available: ${names.join(", ")}`,
    );
  }

  const entry = servers[name];
  if (!isObject(entry)) {
    throw new UsageError(`mcpServers.${name} must be an object`);
  }

  const hasCommand = typeof entry.command === "string";
  const hasUrl = typeof entry.url === "string";
  if (hasCommand === hasUrl) {
    throw new UsageError(
      `mcpServers.${name} must define exactly one of "command" (stdio) or "url" (http)`,
    );
  }

  if (hasCommand) {
    const command = expandEnvString(
      entry.command as string,
      process.env,
      `mcpServers.${name}.command`,
    );
    const args = expandEnvStringArray(
      asStringArray(entry.args, `mcpServers.${name}.args`),
      process.env,
      `mcpServers.${name}.args`,
    );
    const env = expandEnvRecord(
      asStringMap(entry.env, `mcpServers.${name}.env`),
      process.env,
      `mcpServers.${name}.env`,
    );
    let cwd: string | undefined;
    if (entry.cwd !== undefined) {
      if (typeof entry.cwd !== "string") {
        throw new UsageError(`mcpServers.${name}.cwd must be a string`);
      }
      cwd = expandEnvString(entry.cwd, process.env, `mcpServers.${name}.cwd`);
    }
    return {
      name,
      transport: "stdio",
      command,
      args,
      env,
      cwd,
    };
  }

  // HTTP / streamable HTTP
  const url = expandEnvString(
    entry.url as string,
    process.env,
    `mcpServers.${name}.url`,
  );
  let headersRaw: unknown = entry.headers;
  if (
    headersRaw === undefined &&
    isObject(entry.requestInit) &&
    entry.requestInit.headers !== undefined
  ) {
    headersRaw = entry.requestInit.headers;
  }
  const headers = expandEnvRecord(
    asStringMap(headersRaw, `mcpServers.${name}.headers`),
    process.env,
    `mcpServers.${name}.headers`,
  );

  return {
    name,
    transport: "http",
    url,
    headers,
  };
}
