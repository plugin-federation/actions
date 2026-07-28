import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeToolsPayload } from "../src/parse.ts";

describe("normalizeToolsPayload", () => {
  it("accepts bare tools array", () => {
    const n = normalizeToolsPayload([{ name: "a", inputSchema: { type: "object" } }]);
    assert.equal(n.shape, "toolsArray");
    assert.equal(n.tools.length, 1);
  });

  it("accepts listToolsResult", () => {
    const n = normalizeToolsPayload({
      tools: [{ name: "a", inputSchema: { type: "object" } }],
      nextCursor: "abc",
    });
    assert.equal(n.shape, "listToolsResult");
    assert.equal(n.nextCursor, "abc");
  });

  it("accepts JSON-RPC result", () => {
    const n = normalizeToolsPayload({
      jsonrpc: "2.0",
      id: 1,
      result: { tools: [{ name: "a", inputSchema: { type: "object" } }] },
    });
    assert.equal(n.shape, "jsonRpcResult");
  });

  it("detects PF envelope", () => {
    const n = normalizeToolsPayload({
      sourceId: "11111111-1111-4111-8111-111111111111",
      sourceVersion: "1",
      tools: [],
    });
    assert.equal(n.envelope, true);
    assert.equal(n.shape, "pfToolCatalog");
  });
});
