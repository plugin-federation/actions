/**
 * Live MCP tools/list integration tests.
 *
 * Public (no auth) — always run when network is available:
 *   - DeepWiki (Devin)
 *   - Cloudflare Docs
 *   - Context7
 *
 * Authenticated (skipped unless token present):
 *   - GitHub remote MCP (https://api.githubcopilot.com/mcp/)
 *     Requires GITHUB_TOKEN or GH_TOKEN (PAT / Actions token with suitable access)
 *
 * Skip all with: SKIP_LIVE_MCP=1
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listToolsHttp } from "../src/mcp/http-client.ts";
import { runRules } from "../src/rules.ts";
import { normalizeToolsPayload } from "../src/parse.ts";

const skipAll = process.env.SKIP_LIVE_MCP === "1";

const PUBLIC_SERVERS = [
  {
    name: "deepwiki",
    url: "https://mcp.deepwiki.com/mcp",
    expectAtLeast: 1,
    expectNames: ["ask_question"],
  },
  {
    name: "cloudflare-docs",
    url: "https://docs.mcp.cloudflare.com/mcp",
    expectAtLeast: 1,
    expectNames: ["search_cloudflare_documentation"],
  },
  {
    name: "context7",
    url: "https://mcp.context7.com/mcp",
    expectAtLeast: 1,
    expectNames: ["resolve-library-id"],
  },
] as const;

const listOpts = {
  timeoutMs: 25_000,
  deadlineMs: 90_000,
  maxPages: 10,
  maxTools: 500,
  protocolVersion: "2025-06-18",
  allowInsecureHttp: false,
  allowedHosts: [] as string[],
};

async function listAndValidate(
  name: string,
  url: string,
  headers: Record<string, string> = {},
): Promise<{ tools: unknown[]; errorCount: number; warningCount: number }> {
  const listed = await listToolsHttp(
    { name, transport: "http", url, headers },
    listOpts,
  );
  const catalog = normalizeToolsPayload({ tools: listed.tools });
  const findings = runRules(catalog, {
    profile: "mcp",
    maxTools: 5000,
    failOnIncompleteList: false,
  });
  return {
    tools: listed.tools,
    errorCount: findings.filter((f) => f.severity === "error").length,
    warningCount: findings.filter((f) => f.severity === "warning").length,
  };
}

describe("live MCP tools/list (public)", { skip: skipAll }, () => {
  for (const server of PUBLIC_SERVERS) {
    it(`${server.name}: tools/list + mcp-profile validation`, async () => {
      const result = await listAndValidate(server.name, server.url);
      assert.ok(
        result.tools.length >= server.expectAtLeast,
        `${server.name}: expected >= ${server.expectAtLeast} tools, got ${result.tools.length}`,
      );
      const names = new Set(
        result.tools.map((t) => (t as { name?: string }).name).filter(Boolean),
      );
      for (const expected of server.expectNames) {
        assert.ok(
          names.has(expected),
          `${server.name}: missing expected tool ${expected}; have ${[...names].slice(0, 12).join(", ")}`,
        );
      }
      // Structural MCP profile should not error on real public catalogs
      assert.equal(
        result.errorCount,
        0,
        `${server.name}: unexpected validation errors (${result.errorCount})`,
      );
      console.log(
        `  ${server.name}: ${result.tools.length} tools, ${result.warningCount} warnings`,
      );
    });
  }
});

describe("live MCP tools/list (GitHub, authenticated)", () => {
  const token =
    process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || "";
  const skipGithub = skipAll || !token;

  it(
    "github: tools/list against api.githubcopilot.com/mcp/",
    { skip: skipGithub },
    async () => {
      const result = await listAndValidate(
        "github",
        "https://api.githubcopilot.com/mcp/",
        { Authorization: `Bearer ${token}` },
      );
      assert.ok(
        result.tools.length >= 5,
        `github: expected several tools, got ${result.tools.length}`,
      );
      const names = result.tools.map((t) => (t as { name?: string }).name);
      // Common tools from GitHub MCP (names may evolve; keep a soft check)
      const hasIssueOrRepo = names.some(
        (n) =>
          typeof n === "string" &&
          (n.includes("issue") ||
            n.includes("pull_request") ||
            n.includes("repository") ||
            n.includes("file")),
      );
      assert.ok(hasIssueOrRepo, `github: unexpected tool set: ${names.slice(0, 8)}`);
      assert.equal(
        result.errorCount,
        0,
        `github: unexpected validation errors (${result.errorCount})`,
      );
      console.log(
        `  github: ${result.tools.length} tools, ${result.warningCount} warnings`,
      );
    },
  );

});
