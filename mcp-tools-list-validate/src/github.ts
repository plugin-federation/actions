import fs from "node:fs";

export function setOutput(name: string, value: string): void {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  // Multiline-safe delimiter form
  const delim = `ghadelim_${name}_${Date.now()}`;
  fs.appendFileSync(out, `${name}<<${delim}\n${value}\n${delim}\n`, "utf8");
}

export function setOutputs(map: Record<string, string>): void {
  for (const [k, v] of Object.entries(map)) {
    setOutput(k, v);
  }
}
