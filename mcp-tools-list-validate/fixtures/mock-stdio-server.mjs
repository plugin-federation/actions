#!/usr/bin/env node
/**
 * Minimal MCP stdio mock for Mode B tests.
 * Content-Length framed JSON-RPC; initialize + tools/list.
 */
import { createInterface } from "node:readline";

const tools = [
  {
    name: "list_cities",
    description: "List cities",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_weather",
    description: "Get weather",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
];

let buffer = Buffer.alloc(0);

function write(msg) {
  const body = JSON.stringify(msg);
  process.stdout.write(
    `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`,
  );
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;
    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) break;
    const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
    buffer = buffer.subarray(bodyStart + length);
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      continue;
    }
    handle(msg);
  }
});

function handle(msg) {
  if (msg.method === "notifications/initialized") return;
  if (msg.method === "initialize") {
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "mock-stdio", version: "0.0.1" },
      },
    });
    return;
  }
  if (msg.method === "tools/list") {
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: { tools },
    });
    return;
  }
  if (msg.id !== undefined) {
    write({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32601, message: `Method not found: ${msg.method}` },
    });
  }
}

// Keep process alive
createInterface({ input: process.stdin }).on("close", () => process.exit(0));
