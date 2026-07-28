import fs from "node:fs";
import path from "node:path";
import { UsageError } from "./types.ts";

/**
 * Resolve a user-supplied path. When GITHUB_WORKSPACE is set, require the path
 * to resolve inside the workspace (no `..` escape).
 */
export function resolveInputPath(userPath: string): string {
  if (!userPath) {
    throw new UsageError("path is empty");
  }

  const workspace = process.env.GITHUB_WORKSPACE?.trim();
  const absolute = path.isAbsolute(userPath)
    ? path.normalize(userPath)
    : path.resolve(workspace || process.cwd(), userPath);

  if (workspace) {
    const root = path.resolve(workspace);
    let realRoot = root;
    let realTarget = absolute;
    try {
      realRoot = fs.realpathSync.native(root);
    } catch {
      /* workspace may not exist yet in tests */
    }
    try {
      if (fs.existsSync(absolute)) {
        realTarget = fs.realpathSync.native(absolute);
      }
    } catch {
      /* keep absolute */
    }

    const rel = path.relative(realRoot, realTarget);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new UsageError(`path escapes GITHUB_WORKSPACE: ${userPath}`);
    }
  }

  return absolute;
}

export function resolveOutputPath(userPath: string): string {
  if (!userPath) {
    throw new UsageError("output path is empty");
  }
  const workspace = process.env.GITHUB_WORKSPACE?.trim();
  if (path.isAbsolute(userPath)) {
    return path.normalize(userPath);
  }
  return path.resolve(workspace || process.cwd(), userPath);
}

export function readFileLimited(filePath: string, maxBytes: number): Buffer {
  let st: fs.Stats;
  try {
    st = fs.statSync(filePath);
  } catch {
    throw new UsageError(`file not found or unreadable: ${filePath}`);
  }
  if (!st.isFile()) {
    throw new UsageError(`not a regular file: ${filePath}`);
  }
  if (st.size > maxBytes) {
    throw new UsageError(
      `file exceeds max-bytes (${st.size} > ${maxBytes}): ${filePath}`,
    );
  }
  try {
    return fs.readFileSync(filePath);
  } catch {
    throw new UsageError(`failed to read file: ${filePath}`);
  }
}
