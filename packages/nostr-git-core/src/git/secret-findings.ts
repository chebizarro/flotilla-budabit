export interface SecretFinding {
  ruleId: string
  path: string
  line: number
  column: number
  severity: "error" | "warning" | "info"
  message: string
  maskedSnippet: string
}

export function getSecretGateMessage(
  findings: SecretFinding[],
  operation: "PR creation" | "merge",
): string | null {
  if (findings.length === 0) return null
  const uniqueFiles = Array.from(new Set(findings.map(finding => finding.path)))
  const noun = findings.length === 1 ? "potential secret" : "potential secrets"
  const fileSummary = uniqueFiles.slice(0, 3).join(", ")
  const moreFiles = uniqueFiles.length > 3 ? ` and ${uniqueFiles.length - 3} more` : ""
  return `Secret scan blocked ${operation}: ${findings.length} ${noun} found in ${fileSummary}${moreFiles}.`
}
