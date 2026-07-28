import type { ActionConfig, McpServerEntry } from "../types.ts";
import { listToolsHttp } from "./http-client.ts";
import { listToolsStdio } from "./stdio-client.ts";

export interface LiveListResult {
  tools: unknown[];
  nextCursor?: string;
  /** Redacted host for reports (http only) */
  mcpHost?: string;
  serverName: string;
  transport: "stdio" | "http";
}

export async function listToolsLive(
  server: McpServerEntry,
  config: ActionConfig,
): Promise<LiveListResult> {
  const options = {
    timeoutMs: config.timeoutMs,
    deadlineMs: config.deadlineMs,
    maxPages: config.maxPages,
    maxTools: config.maxTools,
    protocolVersion: config.mcpSchemaVersion,
  };

  if (server.transport === "stdio") {
    const result = await listToolsStdio(server, options);
    return {
      tools: result.tools,
      nextCursor: result.nextCursor,
      serverName: server.name,
      transport: "stdio",
    };
  }

  const result = await listToolsHttp(server, {
    ...options,
    allowInsecureHttp: config.allowInsecureHttp,
    allowedHosts: config.allowedHosts,
  });
  return {
    tools: result.tools,
    nextCursor: result.nextCursor,
    mcpHost: result.host,
    serverName: server.name,
    transport: "http",
  };
}
