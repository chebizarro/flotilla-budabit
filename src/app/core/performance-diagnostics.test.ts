import {get} from "svelte/store"
import {beforeEach, describe, expect, it} from "vitest"
import {
  activePerformanceDiagnosticsRun,
  beginPerformanceDiagnosticsRun,
  clearPerformanceDiagnostics,
  finishPerformanceDiagnosticsRun,
  getPerformanceDiagnosticsSnapshot,
  markPerformanceDiagnosticsMilestone,
  preparePerformanceDiagnosticsArtifact,
  recordPerformanceDiagnostics,
  sanitizePerformanceDiagnosticValue,
  serializePerformanceDiagnostics,
  startPerformanceDiagnosticsCapture,
  stopPerformanceDiagnosticsCapture,
} from "./performance-diagnostics"

const makeClock = () => {
  let now = 10
  let wallTime = 1_000

  return {
    clock: {now: () => now, wallTime: () => wallTime},
    advance: (milliseconds: number) => {
      now += milliseconds
      wallTime += milliseconds
    },
  }
}

describe("performance diagnostics", () => {
  beforeEach(() => clearPerformanceDiagnostics())

  it("records monotonic run milestones and rejects stale mutations", () => {
    const {clock, advance} = makeClock()
    const runId = beginPerformanceDiagnosticsRun({
      id: "run-one",
      route: "/git",
      preset: "git-root",
      clock,
    })

    advance(25)
    expect(markPerformanceDiagnosticsMilestone(runId, "shell", {cards: 0})).toBe(true)
    advance(30)
    expect(recordPerformanceDiagnostics(runId, "cards", {count: 18})).toBe(true)
    expect(finishPerformanceDiagnosticsRun(runId)).toBe(true)
    expect(markPerformanceDiagnosticsMilestone(runId, "stale")).toBe(false)

    expect(getPerformanceDiagnosticsSnapshot().runs[0]).toMatchObject({
      id: "run-one",
      durationMs: 55,
      status: "complete",
      milestones: [{name: "shell", elapsedMs: 25, detail: {cards: 0}}],
      records: [{type: "cards", elapsedMs: 55, detail: {count: 18}}],
    })
  })

  it("owns one explicit active capture at a time", () => {
    const first = startPerformanceDiagnosticsCapture({route: "/git", preset: "git-root"})
    const second = startPerformanceDiagnosticsCapture({
      route: "/c/example",
      preset: "community-home",
    })

    expect(first).not.toBe(second)
    expect(get(activePerformanceDiagnosticsRun)).toMatchObject({
      id: second,
      route: "/c/example",
    })
    expect(getPerformanceDiagnosticsSnapshot().runs.map(run => run.status)).toEqual([
      "cancelled",
      "running",
    ])
    expect(stopPerformanceDiagnosticsCapture()).toBe(true)
    expect(get(activePerformanceDiagnosticsRun)).toBeNull()
    expect(getPerformanceDiagnosticsSnapshot().runs.at(-1)?.status).toBe("complete")
  })

  it("bounds retained runs and run details", () => {
    const {clock} = makeClock()
    for (let index = 0; index < 25; index += 1) {
      beginPerformanceDiagnosticsRun({id: `run-${index}`, route: "/git", clock})
    }
    const lastRun = "run-24"
    for (let index = 0; index < 550; index += 1) {
      recordPerformanceDiagnostics(lastRun, "sample", {index})
    }

    const snapshot = getPerformanceDiagnosticsSnapshot()
    expect(snapshot.runs).toHaveLength(20)
    expect(snapshot.runs[0].id).toBe("run-5")
    expect(snapshot.runs.at(-1)?.records).toHaveLength(500)
    expect(snapshot.runs.at(-1)?.records[0].detail).toEqual({index: 50})
  })

  it("redacts hard secret patterns while retaining diagnostic structure", () => {
    const sanitized = sanitizePerformanceDiagnosticValue({
      relay: "wss://relay.example/path",
      authorization: "Nostr signed-value",
      nested: {
        message: "failed bunker://example?secret=value and nsec1qqqqqqqqqqqqqqqqqqqqqqqqqq",
        filter: {kinds: [1, 30078], authors: ["a".repeat(64)]},
      },
    })

    expect(sanitized).toEqual({
      relay: "wss://relay.example/path",
      authorization: "[redacted]",
      nested: {
        message: "failed [redacted] and [redacted]",
        filter: {kinds: [1, 30078], authors: ["a".repeat(64)]},
      },
    })
  })

  it("serializes object keys deterministically", () => {
    const snapshot = getPerformanceDiagnosticsSnapshot()
    const first = serializePerformanceDiagnostics(snapshot)
    const reordered = {
      runs: snapshot.runs,
      environment: snapshot.environment,
      build: snapshot.build,
      generatedAt: snapshot.generatedAt,
      schemaVersion: snapshot.schemaVersion,
      schema: snapshot.schema,
    }

    expect(serializePerformanceDiagnostics(reordered)).toBe(first)
  })

  it("hashes compressed bytes and reports gzip metadata", async () => {
    const snapshot = getPerformanceDiagnosticsSnapshot()
    const hashed: Uint8Array[] = []
    const artifact = await preparePerformanceDiagnosticsArtifact(snapshot, {
      runId: "compressed",
      compress: async () => new Uint8Array([3, 2, 1]),
      hash: async bytes => {
        hashed.push(bytes)
        return "a".repeat(64)
      },
    })

    expect(Array.from(hashed[0])).toEqual([3, 2, 1])
    expect(artifact).toMatchObject({
      filename: "budabit-performance-compressed.json.gz",
      encoding: "gzip",
      contentType: "application/gzip",
      sha256: "a".repeat(64),
    })
  })

  it("falls back to identity encoding when compression is unavailable", async () => {
    const snapshot = getPerformanceDiagnosticsSnapshot()
    const artifact = await preparePerformanceDiagnosticsArtifact(snapshot, {
      runId: "plain",
      compress: async () => undefined,
      hash: async bytes => String(bytes.length).padStart(64, "0"),
    })

    expect(artifact.filename).toBe("budabit-performance-plain.json")
    expect(artifact.encoding).toBe("identity")
    expect(new TextDecoder().decode(artifact.bytes)).toBe(serializePerformanceDiagnostics(snapshot))
  })
})
