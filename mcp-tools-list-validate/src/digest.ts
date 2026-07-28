import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import type { Digest, NormalizedCatalog } from "./types.ts";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256Jcs(value: unknown): string {
  const canonical = canonicalize(value);
  if (canonical === undefined) {
    throw new Error("canonicalize returned undefined");
  }
  const hex = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `sha256:${hex}`;
}

function toolSortKey(tool: unknown): string {
  if (isObject(tool) && typeof tool.name === "string") return tool.name;
  return "";
}

function projectCompositionTool(tool: unknown): Record<string, unknown> | null {
  if (!isObject(tool) || typeof tool.name !== "string") return null;
  const projected: Record<string, unknown> = {
    name: tool.name,
    description: typeof tool.description === "string" ? tool.description : "",
    inputSchema: isObject(tool.inputSchema) ? tool.inputSchema : {},
  };
  if (isObject(tool.annotations)) {
    projected.annotations = tool.annotations;
  }
  return projected;
}

export function computeDigests(catalog: NormalizedCatalog): Digest[] {
  const digests: Digest[] = [];

  const sortedTools = [...catalog.tools].sort((a, b) =>
    toolSortKey(a).localeCompare(toolSortKey(b)),
  );
  digests.push({
    kind: "tools-array-v1",
    value: sha256Jcs({ tools: sortedTools }),
  });

  if (
    catalog.envelope &&
    typeof catalog.sourceId === "string" &&
    typeof catalog.sourceVersion === "string"
  ) {
    const projected: Record<string, unknown>[] = [];
    let ok = true;
    for (const tool of catalog.tools) {
      const p = projectCompositionTool(tool);
      if (!p) {
        ok = false;
        break;
      }
      projected.push(p);
    }
    if (ok) {
      projected.sort((a, b) =>
        String(a.name).localeCompare(String(b.name)),
      );
      digests.push({
        kind: "pf-tool-catalog-v1",
        value: sha256Jcs({
          sourceId: catalog.sourceId,
          sourceVersion: catalog.sourceVersion,
          tools: projected,
        }),
      });
    }
  }

  return digests;
}
