import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { resolveInputPath } from "../src/paths.ts";
import { UsageError } from "../src/types.ts";

describe("resolveInputPath", () => {
  it("rejects escape when GITHUB_WORKSPACE is set", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pfmtl-"));
    const prev = process.env.GITHUB_WORKSPACE;
    process.env.GITHUB_WORKSPACE = tmp;
    try {
      assert.throws(
        () => resolveInputPath("../outside.json"),
        (err: unknown) => err instanceof UsageError,
      );
    } finally {
      if (prev === undefined) delete process.env.GITHUB_WORKSPACE;
      else process.env.GITHUB_WORKSPACE = prev;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("resolves relative paths inside workspace", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pfmtl-"));
    const file = path.join(tmp, "tools.json");
    fs.writeFileSync(file, "{}");
    const prev = process.env.GITHUB_WORKSPACE;
    process.env.GITHUB_WORKSPACE = tmp;
    try {
      const resolved = resolveInputPath("tools.json");
      assert.equal(resolved, path.resolve(tmp, "tools.json"));
    } finally {
      if (prev === undefined) delete process.env.GITHUB_WORKSPACE;
      else process.env.GITHUB_WORKSPACE = prev;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
