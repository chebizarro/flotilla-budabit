import {lintSource, type SecretLintSourceOptions} from "@secretlint/core"
import {creator as awsRule} from "@secretlint/secretlint-rule-aws"
import {creator as basicAuthRule} from "@secretlint/secretlint-rule-basicauth"
import {creator as githubRule} from "@secretlint/secretlint-rule-github"
import {creator as npmRule} from "@secretlint/secretlint-rule-npm"
import {creator as openAiRule} from "@secretlint/secretlint-rule-openai"
import {creator as privateKeyRule} from "@secretlint/secretlint-rule-privatekey"
import {creator as slackRule} from "@secretlint/secretlint-rule-slack"
import type {SecretFinding} from "./secret-findings.js"

export interface SecretScanEntry {
  path: string
  content: string
}

const MAX_ENTRY_BYTES = 1024 * 1024
const MAX_SNIPPET_LENGTH = 160

const config: SecretLintSourceOptions["options"]["config"] = {
  rules: [
    {id: "@secretlint/secretlint-rule-aws", rule: awsRule},
    {id: "@secretlint/secretlint-rule-basicauth", rule: basicAuthRule},
    {id: "@secretlint/secretlint-rule-github", rule: githubRule},
    {id: "@secretlint/secretlint-rule-npm", rule: npmRule},
    {id: "@secretlint/secretlint-rule-openai", rule: openAiRule},
    {id: "@secretlint/secretlint-rule-privatekey", rule: privateKeyRule},
    {id: "@secretlint/secretlint-rule-slack", rule: slackRule},
  ],
}

function normalizeRange(
  content: string,
  range: readonly [number, number],
): readonly [number, number] {
  const start = Math.max(0, Math.min(range[0], content.length))
  return [start, Math.max(start, Math.min(range[1], content.length))]
}

function redactDetectedValues(
  value: string,
  content: string,
  ranges: ReadonlyArray<readonly [number, number]>,
): string {
  const secrets = Array.from(
    new Set(ranges.map(range => content.slice(range[0], range[1])).filter(Boolean)),
  ).sort((a, b) => b.length - a.length)
  return secrets.reduce((redacted, secret) => redacted.split(secret).join("****"), value)
}

function maskedLineSnippet(
  content: string,
  range: readonly [number, number],
  allRanges: ReadonlyArray<readonly [number, number]>,
): string {
  const [start] = normalizeRange(content, range)
  const lineStart = content.lastIndexOf("\n", start - 1) + 1
  const nextLine = content.indexOf("\n", start)
  const lineEnd = nextLine === -1 ? content.length : nextLine
  const ranges = allRanges
    .map(item => normalizeRange(content, item))
    .filter(([rangeStart, rangeEnd]) => rangeStart < lineEnd && rangeEnd > lineStart)
    .map(
      ([rangeStart, rangeEnd]) =>
        [Math.max(rangeStart, lineStart), Math.min(rangeEnd, lineEnd)] as const,
    )
    .sort((a, b) => a[0] - b[0])

  let cursor = lineStart
  let masked = ""
  for (const [rangeStart, rangeEnd] of ranges) {
    if (rangeEnd <= cursor) continue
    masked += content.slice(cursor, Math.max(cursor, rangeStart)) + "••••"
    cursor = rangeEnd
  }
  masked += content.slice(cursor, lineEnd)

  const normalized = masked.replace(/\s+/g, " ").trim()
  if (normalized.length <= MAX_SNIPPET_LENGTH) return normalized
  return `${normalized.slice(0, MAX_SNIPPET_LENGTH - 1)}…`
}

function getEntryByteLength(entry: SecretScanEntry): number {
  return new TextEncoder().encode(entry.content).byteLength
}

export async function scanTextForSecrets(entry: SecretScanEntry): Promise<SecretFinding[]> {
  if (!entry.content || entry.content.includes("\0")) return []
  if (getEntryByteLength(entry) > MAX_ENTRY_BYTES) {
    throw new Error(`Secret scan blocked: "${entry.path}" exceeds the 1 MiB scan limit.`)
  }

  const result = await lintSource({
    source: {
      content: entry.content,
      filePath: entry.path,
      contentType: "text",
    },
    options: {
      config,
      maskSecrets: true,
    },
  })

  const ranges = result.messages.map(message => normalizeRange(entry.content, message.range))
  return result.messages.map(message => ({
    ruleId: message.ruleId,
    path: entry.path,
    line: message.loc.start.line,
    column: message.loc.start.column + 1,
    severity: message.severity,
    message: redactDetectedValues(message.message, entry.content, ranges),
    maskedSnippet: maskedLineSnippet(entry.content, message.range, ranges),
  }))
}

export async function scanSecretEntries(entries: SecretScanEntry[]): Promise<SecretFinding[]> {
  const findings: SecretFinding[] = []
  for (const entry of entries) {
    findings.push(...(await scanTextForSecrets(entry)))
  }
  return findings
}
