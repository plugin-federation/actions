export function ruleIdToCode(ruleId: string): string {
  return ruleId.toLowerCase().replaceAll("-", "_");
}
