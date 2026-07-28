import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { listToolsStdio } from "../src/mcp/stdio-client.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("listToolsStdio", () => {
  it("lists tools from mock stdio server", async () => {
    const result = await listToolsStdio(
      {
        name: "mock",
        transport: "stdio",
        command: process.execPath,
        args: [path.join(root, "fixtures/mock-stdio-server.mjs")],
        env: {},
      },
      {
        timeoutMs: 10_000,
        deadlineMs: 15_000,
        maxPages: 5,
        maxTools: 100,
        protocolVersion: "2025-06-18",
      },
    );
    assert.equal(result.tools.length, 2);
    const names = result.tools.map(
      (t) => (t as { name: string }).name,
    );
    assert.deepEqual(names, ["list_cities", "get_weather"]);
  });
});
