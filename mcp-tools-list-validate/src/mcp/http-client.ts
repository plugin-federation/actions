import { UsageError, type McpServerEntry } from "../types.ts";
import type { ListToolsLiveOptions } from "./stdio-client.ts";

/**
 * Minimal Streamable HTTP MCP client: initialize + tools/list (pagination).
 * Parses application/json or text/event-stream (SSE) responses.
 */
export async function listToolsHttp(
  server: McpServerEntry,
  options: ListToolsLiveOptions & {
    allowInsecureHttp: boolean;
    allowedHosts: string[];
  },
): Promise<{ tools: unknown[]; nextCursor?: string; host?: string }> {
  if (!server.url) {
    throw new UsageError("http server missing url");
  }

  let parsed: URL;
  try {
    parsed = new URL(server.url);
  } catch {
    throw new UsageError(`mcp http (${server.name}): invalid url`);
  }

  if (parsed.protocol === "http:") {
    if (!options.allowInsecureHttp) {
      throw new UsageError(
        `mcp http (${server.name}): http:// URLs require allow-insecure-http: true`,
      );
    }
  } else if (parsed.protocol !== "https:") {
    throw new UsageError(
      `mcp http (${server.name}): only http(s) URLs are supported`,
    );
  }

  if (
    options.allowedHosts.length > 0 &&
    !options.allowedHosts.includes(parsed.hostname)
  ) {
    throw new UsageError(
      `mcp http (${server.name}): host ${parsed.hostname} not in allowed-hosts`,
    );
  }

  const started = Date.now();
  const deadline = started + options.deadlineMs;
  let sessionId: string | undefined;
  let id = 1;

  async function rpc(
    method: string,
    params?: unknown,
    notification = false,
  ): Promise<unknown> {
    if (Date.now() > deadline) {
      throw new UsageError(
        `mcp http (${server.name}): overall deadline exceeded`,
      );
    }
    const remaining = Math.max(1, Math.min(options.timeoutMs, deadline - Date.now()));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);

    const body = notification
      ? JSON.stringify({ jsonrpc: "2.0", method, params })
      : JSON.stringify({ jsonrpc: "2.0", id: id++, method, params });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "mcp-protocol-version": options.protocolVersion,
      ...server.headers,
    };
    if (sessionId) {
      headers["mcp-session-id"] = sessionId;
    }

    try {
      const response = await fetch(server.url!, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
        redirect: "error",
      });

      const sid = response.headers.get("mcp-session-id");
      if (sid) sessionId = sid;

      if (!response.ok) {
        throw new UsageError(
          `mcp http (${server.name}): HTTP ${response.status} for ${method}`,
        );
      }

      if (notification) {
        return undefined;
      }

      const contentType = response.headers.get("content-type") ?? "";
      const text = await response.text();
      const message = parseRpcResponse(text, contentType, server.name);
      if (message.error) {
        throw new UsageError(
          `mcp http (${server.name}): ${method} error: ${message.error.message}`,
        );
      }
      return message.result;
    } catch (error) {
      if (error instanceof UsageError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new UsageError(
          `mcp http (${server.name}): timeout waiting for ${method}`,
        );
      }
      throw new UsageError(
        `mcp http (${server.name}): ${method} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  await rpc("initialize", {
    protocolVersion: options.protocolVersion,
    capabilities: {},
    clientInfo: {
      name: "mcp-tools-list-validate",
      version: "0.1.0",
    },
  });

  await rpc("notifications/initialized", {}, true);

  const tools: unknown[] = [];
  let cursor: string | undefined;
  let residualCursor: string | undefined;
  let pages = 0;

  for (;;) {
    pages += 1;
    if (pages > options.maxPages) {
      residualCursor = cursor;
      break;
    }
    const result = (await rpc(
      "tools/list",
      cursor ? { cursor } : {},
    )) as { tools?: unknown[]; nextCursor?: string };

    if (!result || !Array.isArray(result.tools)) {
      throw new UsageError(
        `mcp http (${server.name}): tools/list result missing tools array`,
      );
    }
    tools.push(...result.tools);
    if (!result.nextCursor) {
      residualCursor = undefined;
      break;
    }
    cursor = result.nextCursor;
  }

  return { tools, nextCursor: residualCursor, host: parsed.hostname };
}

function parseRpcResponse(
  text: string,
  contentType: string,
  serverName: string,
): {
  result?: unknown;
  error?: { message: string };
} {
  if (contentType.includes("text/event-stream")) {
    // Parse SSE: look for data: lines with JSON-RPC responses
    const dataLines: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }
    const payloads = dataLines.filter(Boolean);
    for (let i = payloads.length - 1; i >= 0; i--) {
      try {
        const msg = JSON.parse(payloads[i]!) as {
          result?: unknown;
          error?: { message: string };
          id?: unknown;
        };
        if (msg.id !== undefined || msg.result !== undefined || msg.error) {
          return msg;
        }
      } catch {
        /* try previous */
      }
    }
    throw new UsageError(
      `mcp http (${serverName}): could not parse SSE tools/list response`,
    );
  }

  try {
    return JSON.parse(text) as { result?: unknown; error?: { message: string } };
  } catch {
    throw new UsageError(
      `mcp http (${serverName}): invalid JSON response body`,
    );
  }
}
