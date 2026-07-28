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

  it("warns empty name under mcp profile", () => {
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
    assert.equal(empty.severity, "warning");
  });

  it("rejects gateway qualified names under plugin-federation", () => {
    const catalog = normalizeToolsPayload({
      tools: [
        {
          name: "source/get_weather",
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
