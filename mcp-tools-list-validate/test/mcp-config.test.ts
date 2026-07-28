import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMcpServersDocument } from "../src/mcp/config.ts";
import { expandEnvString } from "../src/mcp/env.ts";
import { UsageError } from "../src/types.ts";

describe("expandEnvString", () => {
  it("expands braced and bare variables", () => {
    const env = { TOKEN: "secret", NAME: "acme" };
    assert.equal(
      expandEnvString("Bearer ${TOKEN}", env),
      "Bearer secret",
    );
    assert.equal(expandEnvString("hi $NAME", env), "hi acme");
  });

  it("throws when variable missing", () => {
    assert.throws(
      () => expandEnvString("${MISSING}", {}),
      (err: unknown) => err instanceof UsageError,
    );
  });
});

describe("parseMcpServersDocument", () => {
  it("parses stdio mcpServers entry", () => {
    const entry = parseMcpServersDocument(
      {
        mcpServers: {
          weather: {
            command: "python",
            args: ["src/server.py"],
            env: { API_KEY: "literal" },
          },
        },
      },
      "",
    );
    assert.equal(entry.transport, "stdio");
    assert.equal(entry.name, "weather");
    assert.equal(entry.command, "python");
    assert.deepEqual(entry.args, ["src/server.py"]);
    assert.equal(entry.env?.API_KEY, "literal");
  });

  it("requires mcp-server when multiple servers present", () => {
    assert.throws(
      () =>
        parseMcpServersDocument(
          {
            mcpServers: {
              a: { command: "a" },
              b: { command: "b" },
            },
          },
          "",
        ),
      (err: unknown) =>
        err instanceof UsageError && /multiple servers/.test(err.message),
    );
  });

  it("selects named server and expands env from process", () => {
    process.env.PFMTL_TEST_TOKEN = "tok-123";
    try {
      const entry = parseMcpServersDocument(
        {
          mcpServers: {
            remote: {
              url: "https://mcp.example.com/mcp",
              headers: { Authorization: "Bearer ${PFMTL_TEST_TOKEN}" },
            },
          },
        },
        "remote",
      );
      assert.equal(entry.transport, "http");
      assert.equal(entry.headers?.Authorization, "Bearer tok-123");
    } finally {
      delete process.env.PFMTL_TEST_TOKEN;
    }
  });
});
