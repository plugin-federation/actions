import { spawn } from "node:child_process";
import { UsageError, type McpServerEntry } from "../types.ts";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  method?: string;
}

export interface ListToolsLiveOptions {
  timeoutMs: number;
  deadlineMs: number;
  maxPages: number;
  maxTools: number;
  protocolVersion: string;
}

/**
 * Minimal MCP Streamable stdio client: initialize + tools/list (with pagination).
 * Uses Content-Length framing per MCP stdio transport.
 */
export async function listToolsStdio(
  server: McpServerEntry,
  options: ListToolsLiveOptions,
): Promise<{ tools: unknown[]; nextCursor?: string }> {
  if (!server.command) {
    throw new UsageError("stdio server missing command");
  }

  const started = Date.now();
  const deadline = started + options.deadlineMs;

  const child = spawn(server.command, server.args ?? [], {
    cwd: server.cwd,
    env: { ...process.env, ...server.env },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
    if (stderr.length > 64_000) {
      stderr = stderr.slice(-64_000);
    }
  });

  let buffer = Buffer.alloc(0);
  const messages: JsonRpcResponse[] = [];
  let resolveWait: ((msg: JsonRpcResponse) => void) | null = null;
  let rejectWait: ((err: Error) => void) | null = null;
  let waitId: number | null = null;

  function fail(message: string): never {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    const tail = stderr.trim() ? ` stderr: ${stderr.trim().slice(0, 500)}` : "";
    throw new UsageError(`mcp stdio (${server.name}): ${message}${tail}`);
  }

  child.on("error", (err) => {
    if (rejectWait) {
      rejectWait(
        new UsageError(
          `mcp stdio (${server.name}): failed to spawn: ${err.message}`,
        ),
      );
    }
  });

  child.stdout?.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    // Parse Content-Length frames
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const header = buffer.subarray(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        // Try newline-delimited JSON fallback (some servers)
        const nl = buffer.indexOf("\n");
        if (nl === -1) break;
        const line = buffer.subarray(0, nl).toString("utf8").trim();
        buffer = buffer.subarray(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcResponse;
          onMessage(msg);
        } catch {
          fail(`invalid JSON line from server`);
        }
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + length) break;
      const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      buffer = buffer.subarray(bodyStart + length);
      try {
        const msg = JSON.parse(body) as JsonRpcResponse;
        onMessage(msg);
      } catch {
        fail("invalid JSON-RPC body from server");
      }
    }
  });

  function onMessage(msg: JsonRpcResponse): void {
    if (msg.id !== undefined && msg.id !== null && resolveWait) {
      if (waitId === null || msg.id === waitId) {
        const resolve = resolveWait;
        resolveWait = null;
        rejectWait = null;
        waitId = null;
        resolve(msg);
        return;
      }
    }
    messages.push(msg);
  }

  function writeMessage(msg: JsonRpcRequest | { jsonrpc: "2.0"; method: string; params?: unknown }): void {
    const body = JSON.stringify(msg);
    const frame = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
    if (!child.stdin?.writable) {
      fail("stdin not writable");
    }
    child.stdin.write(frame);
  }

  function remainingMs(): number {
    return Math.max(1, Math.min(options.timeoutMs, deadline - Date.now()));
  }

  function request(method: string, params?: unknown): Promise<unknown> {
    if (Date.now() > deadline) {
      return Promise.reject(
        new UsageError(`mcp stdio (${server.name}): overall deadline exceeded`),
      );
    }
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const payload: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolveWait = null;
        rejectWait = null;
        waitId = null;
        reject(
          new UsageError(
            `mcp stdio (${server.name}): timeout waiting for ${method}`,
          ),
        );
      }, remainingMs());

      waitId = id;
      resolveWait = (msg) => {
        clearTimeout(timer);
        if (msg.error) {
          reject(
            new UsageError(
              `mcp stdio (${server.name}): ${method} error: ${msg.error.message}`,
            ),
          );
          return;
        }
        resolve(msg.result);
      };
      rejectWait = (err) => {
        clearTimeout(timer);
        reject(err);
      };
      writeMessage(payload);
    });
  }

  try {
    await request("initialize", {
      protocolVersion: options.protocolVersion,
      capabilities: {},
      clientInfo: {
        name: "mcp-tools-list-validate",
        version: "0.1.0",
      },
    });

    // notifications/initialized (no response expected)
    writeMessage({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    const tools: unknown[] = [];
    let cursor: string | undefined;
    let pages = 0;
    let residualCursor: string | undefined;

    for (;;) {
      pages += 1;
      if (pages > options.maxPages) {
        residualCursor = cursor;
        break;
      }
      const result = (await request(
        "tools/list",
        cursor ? { cursor } : {},
      )) as { tools?: unknown[]; nextCursor?: string };

      if (!result || !Array.isArray(result.tools)) {
        fail("tools/list result missing tools array");
      }
      tools.push(...result.tools);
      if (tools.length > options.maxTools) {
        // keep all for validation (CAT-001 will fire); stop paging
        residualCursor = result.nextCursor;
        break;
      }
      if (!result.nextCursor) {
        residualCursor = undefined;
        break;
      }
      cursor = result.nextCursor;
    }

    return { tools, nextCursor: residualCursor };
  } finally {
    try {
      child.stdin?.end();
    } catch {
      /* ignore */
    }
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
}
