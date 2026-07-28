import { UsageError } from "../types.ts";

const ENV_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Expand `${VAR}` and `$VAR` placeholders from process.env.
 * Missing variables throw UsageError (exit 2) — secrets must be provided via
 * the Action/job environment, not committed in the config file.
 */
export function expandEnvString(
  value: string,
  env: NodeJS.ProcessEnv = process.env,
  context = "config",
): string {
  return value.replace(ENV_PATTERN, (match, braced?: string, bare?: string) => {
    const name = braced ?? bare;
    if (!name) return match;
    const resolved = env[name];
    if (resolved === undefined) {
      throw new UsageError(
        `${context}: environment variable ${name} is not set (referenced as ${match})`,
      );
    }
    return resolved;
  });
}

export function expandEnvRecord(
  record: Record<string, string> | undefined,
  env: NodeJS.ProcessEnv = process.env,
  context = "config",
): Record<string, string> {
  if (!record) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = expandEnvString(value, env, `${context}.${key}`);
  }
  return out;
}

export function expandEnvStringArray(
  values: string[] | undefined,
  env: NodeJS.ProcessEnv = process.env,
  context = "config",
): string[] {
  if (!values) return [];
  return values.map((v, i) => expandEnvString(v, env, `${context}[${i}]`));
}
