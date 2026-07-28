import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeToolsPayload } from "../src/parse.ts";
import { runRules } from "../src/rules.ts";

describe("runRules", () => {
  it("passes minimal valid tool under plugin-federation", () => {
    const catalog = normalizeToolsPayload({
      tools: [
        {
          name: "get_weather",
          description: "ok",
          inputSchema: {
            type: "object",
            properties: { city: { type: "string" } },
          },
        },
      ],
    });
    const findings = runRules(catalog, {
      profile: "plugin-federation",
      maxTools: 5000,
      failOnIncompleteList: false,
    });
    assert.equal(
      findings.filter((f) => f.severity === "error").length,
      0,
      JSON.stringify(findings, null, 2),
    );
  });

  it("errors on space in name under plugin-federation", () => {
    const catalog = normalizeToolsPayload({
      tools: [
        {
          name: "bad name",
          inputSchema: { type: "object" },
        },
      ],
    });
    const findings = runRules(catalog, {
      profile: "plugin-federation",
      maxTools: 5000,
      failOnIncompleteList: false,
    });
    assert.ok(findings.some((f) => f.ruleId === "PFMTL-TOOL-003"));
  });

  it("errors on empty name under mcp profile (min length 1)", () => {
    const catalog = normalizeToolsPayload({
      tools: [{ name: "", inputSchema: { type: "object" } }],
    });
    const findings = runRules(catalog, {
      profile: "mcp",
      maxTools: 5000,
      failOnIncompleteList: false,
    });
    const empty = findings.find((f) => f.ruleId === "PFMTL-TOOL-014");
    assert.ok(empty);
    assert.equal(empty.severity, "error");
  });

  it("allows slash namespacing (SEP-986) and rejects colon", () => {
    const ok = normalizeToolsPayload({
      tools: [{ name: "source/get_weather", inputSchema: { type: "object" } }],
    });
    assert.equal(
      runRules(ok, {
        profile: "plugin-federation",
        maxTools: 5000,
        failOnIncompleteList: false,
      }).filter((f) => f.severity === "error").length,
      0,
    );

    const bad = normalizeToolsPayload({
      tools: [{ name: "create.item:v1", inputSchema: { type: "object" } }],
    });
    assert.ok(
      runRules(bad, {
        profile: "plugin-federation",
        maxTools: 5000,
        failOnIncompleteList: false,
      }).some((f) => f.ruleId === "PFMTL-TOOL-003"),
    );
  });

  it("rejects names longer than 64 characters", () => {
    const name = "a".repeat(65);
    const catalog = normalizeToolsPayload({
      tools: [{ name, inputSchema: { type: "object" } }],
    });
    const findings = runRules(catalog, {
      profile: "mcp",
      maxTools: 5000,
      failOnIncompleteList: false,
    });
    assert.ok(findings.some((f) => f.ruleId === "PFMTL-TOOL-004"));
  });

  it("rejects invalid envelope sourceId", () => {
    const catalog = normalizeToolsPayload({
      sourceId: "not-a-uuid",
      sourceVersion: "1",
      tools: [{ name: "ok_tool", inputSchema: { type: "object" } }],
    });
    const findings = runRules(catalog, {
      profile: "plugin-federation",
      maxTools: 5000,
      failOnIncompleteList: false,
    });
    assert.ok(findings.some((f) => f.ruleId === "PFMTL-ENV-001"));
  });

  it("detects duplicate names", () => {
    const catalog = normalizeToolsPayload({
      tools: [
        { name: "same", inputSchema: { type: "object" } },
        { name: "same", inputSchema: { type: "object" } },
      ],
    });
    const findings = runRules(catalog, {
      profile: "plugin-federation",
      maxTools: 5000,
      failOnIncompleteList: false,
    });
    assert.ok(findings.some((f) => f.ruleId === "PFMTL-CAT-002"));
  });
});
