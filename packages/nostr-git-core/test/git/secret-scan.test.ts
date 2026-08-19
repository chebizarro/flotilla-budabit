import {describe, expect, it} from "vitest"
import {scanSecretEntries, scanTextForSecrets} from "../../src/git/secret-scan.js"
import {getSecretGateMessage} from "../../src/git/secret-findings.js"

describe("secret scanning", () => {
  it("returns masked structured findings for planted credentials", async () => {
    const credential = "admin:s3cr3t-value"
    const findings = await scanTextForSecrets({
      path: "config/example.env",
      content: `API_URL=https://${credential}@example.com\n`,
    })

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      ruleId: "@secretlint/secretlint-rule-basicauth",
      path: "config/example.env",
      line: 1,
      severity: "error",
    })
    expect(findings[0]?.column).toBeGreaterThan(0)
    expect(findings[0]?.message).not.toContain(credential)
    expect(findings[0]?.maskedSnippet).toContain("••••")
    expect(findings[0]?.maskedSnippet).not.toContain(credential)
  })

  it("redacts every detected value when multiple secrets share a line", async () => {
    const first = "alice:first-secret-value"
    const second = "bob:second-secret-value"
    const findings = await scanTextForSecrets({
      path: "config/remotes.txt",
      content: `https://${first}@one.example.org https://${second}@two.example.org\n`,
    })

    expect(findings).toHaveLength(2)
    const serialized = JSON.stringify(findings)
    expect(serialized).not.toContain(first)
    expect(serialized).not.toContain(second)
    expect(findings.every(finding => !finding.maskedSnippet.includes(first))).toBe(true)
    expect(findings.every(finding => !finding.maskedSnippet.includes(second))).toBe(true)
  })

  it("allows clean changed files", async () => {
    await expect(
      scanSecretEntries([
        {path: "src/main.ts", content: 'export const greeting = "hello"\n'},
        {path: "README.md", content: "# Example\nNo credentials here.\n"},
      ]),
    ).resolves.toEqual([])
  })

  it("produces a blocking gate message without exposing secret values", async () => {
    const credential = "developer:not-a-real-secret"
    const findings = await scanSecretEntries([
      {
        path: "config/local.txt",
        content: `remote=https://${credential}@example.test\n`,
      },
    ])

    const message = getSecretGateMessage(findings, "PR creation")
    expect(message).toContain("Secret scan blocked PR creation")
    expect(message).toContain("config/local.txt")
    expect(message).not.toContain(credential)
    expect(getSecretGateMessage([], "merge")).toBeNull()
  })
})
