import {get} from "svelte/store"
import {beforeEach, describe, expect, it, vi} from "vitest"
import {
  activePerformanceDiagnosticsRun,
  armPerformanceDiagnosticsCapture,
  armedPerformanceDiagnosticsCapture,
  beginPerformanceDiagnosticsRun,
  clearPerformanceDiagnostics,
  completeAutomaticPerformanceDiagnosticsCapture,
  consumeArmedPerformanceDiagnosticsCapture,
  disarmPerformanceDiagnosticsCapture,
  finishPerformanceDiagnosticsRun,
  getPerformanceInteractionTimingDetail,
  getPerformanceLongTaskDetail,
  getPerformanceNavigationTimingDetail,
  getPerformanceDiagnosticsSnapshot,
  markPerformanceDiagnosticsMilestone,
  measurePerformanceDiagnosticsWork,
  preparePerformanceDiagnosticsArtifact,
  recordPerformanceDiagnosticsInteractionPaint,
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
  beforeEach(() => {
    const storage = new Map<string, string>()
    vi.stubGlobal("localStorage", {
      get length() {
        return storage.size
      },
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    clearPerformanceDiagnostics()
    disarmPerformanceDiagnosticsCapture()
  })

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

  it("consumes an exact one-shot route arm and completes only automatic captures", () => {
    armPerformanceDiagnosticsCapture({route: "/git", preset: "git-root"})

    expect(consumeArmedPerformanceDiagnosticsCapture("/c/example")).toBeUndefined()
    expect(get(armedPerformanceDiagnosticsCapture)?.route).toBe("/git")
    const runId = consumeArmedPerformanceDiagnosticsCapture("/git")

    expect(runId).toBeTypeOf("string")
    expect(get(armedPerformanceDiagnosticsCapture)).toBeNull()
    expect(get(activePerformanceDiagnosticsRun)).toMatchObject({id: runId, automatic: true})
    expect(completeAutomaticPerformanceDiagnosticsCapture(runId!)).toBe(true)
    expect(getPerformanceDiagnosticsSnapshot().runs.at(-1)).toMatchObject({
      route: "/git",
      status: "complete",
      startedAt: 0,
      milestones: [{name: "client-bootstrap"}],
    })
  })

  it("fails an automatic capture after its watchdog timeout", () => {
    vi.useFakeTimers()
    armPerformanceDiagnosticsCapture({route: "/git", preset: "git-root"})
    consumeArmedPerformanceDiagnosticsCapture("/git")

    vi.advanceTimersByTime(60_000)

    expect(get(activePerformanceDiagnosticsRun)).toBeNull()
    expect(getPerformanceDiagnosticsSnapshot().runs.at(-1)).toMatchObject({
      route: "/git",
      status: "failed",
      warnings: [{type: "automatic-timeout", detail: {timeoutMs: 60_000}}],
    })
    vi.useRealTimers()
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

  it("derives bounded navigation and interaction timing details", () => {
    const navigation = getPerformanceNavigationTimingDetail({
      name: "https://example.test/git",
      type: "navigate",
      nextHopProtocol: "h2",
      workerStart: 2,
      fetchStart: 4,
      domainLookupStart: 5,
      domainLookupEnd: 8,
      connectStart: 8,
      secureConnectionStart: 10,
      connectEnd: 14,
      requestStart: 15,
      responseStart: 25,
      responseEnd: 40,
      domInteractive: 50,
      domContentLoadedEventEnd: 60,
      loadEventEnd: 70,
      transferSize: 100,
      encodedBodySize: 80,
      decodedBodySize: 120,
    } as PerformanceNavigationTiming)
    expect(navigation).toMatchObject({dnsMs: 3, connectMs: 6, tlsMs: 4, ttfbMs: 10, responseMs: 15})

    const interaction = getPerformanceInteractionTimingDetail({
      name: "click",
      startTime: 100,
      duration: 80,
      processingStart: 120,
      processingEnd: 150,
      interactionId: 7,
      cancelable: true,
    } as unknown as PerformanceEventTiming & {interactionId?: number})
    expect(interaction).toMatchObject({inputDelayMs: 20, processingMs: 30, presentationDelayMs: 30})
  })

  it("retains bounded long-task attribution", () => {
    const detail = getPerformanceLongTaskDetail({
      name: "self",
      startTime: 10,
      duration: 200,
      attribution: Array.from({length: 12}, (_, index) => ({
        name: `task-${index}`,
        containerType: "iframe",
        containerSrc: `https://widgets.example/${index}`,
      })),
    } as unknown as PerformanceEntry)

    expect(detail.attribution).toHaveLength(10)
    expect(detail.attribution[0]).toMatchObject({name: "task-0", containerType: "iframe"})
  })

  it("records bounded work spans and interaction paint only during an active capture", () => {
    let now = 100
    const frames: FrameRequestCallback[] = []
    vi.spyOn(performance, "now").mockImplementation(() => now)
    vi.stubGlobal("window", {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        frames.push(callback)
        return frames.length
      },
    })
    const runId = beginPerformanceDiagnosticsRun({route: "/git", preset: "git-root"})
    activePerformanceDiagnosticsRun.set({
      id: runId,
      route: "/git",
      preset: "git-root",
      automatic: false,
    })

    expect(
      measurePerformanceDiagnosticsWork(
        {owner: "repository", phase: "merge", detail: {events: 12}},
        () => {
          now += 25
          return "result"
        },
      ),
    ).toBe("result")
    expect(
      recordPerformanceDiagnosticsInteractionPaint({
        owner: "community-menu",
        inputStartedAt: 90,
        handlerStartedAt: 100,
        stateChangedAt: 105,
      }),
    ).toBe(true)

    now = 140
    frames.shift()?.(now)
    now = 156
    frames.shift()?.(now)
    now = 160
    frames.shift()?.(now)
    now = 176
    frames.shift()?.(now)

    vi.unstubAllGlobals()
    expect(getPerformanceDiagnosticsSnapshot().runs.at(-1)?.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "work-span",
          detail: expect.objectContaining({owner: "repository", phase: "merge", durationMs: 25}),
        }),
        expect.objectContaining({
          type: "interaction-paint",
          detail: expect.objectContaining({owner: "community-menu", inputDelayMs: 10}),
        }),
      ]),
    )
    stopPerformanceDiagnosticsCapture()
    expect(runId).toBeTypeOf("string")
  })

  it("retains work attribution when capture completion precedes paint", () => {
    let now = 100
    vi.spyOn(performance, "now").mockImplementation(() => now)
    vi.stubGlobal("window", {requestAnimationFrame: vi.fn(() => 1)})
    const runId = beginPerformanceDiagnosticsRun({route: "/git", preset: "git-root"})
    activePerformanceDiagnosticsRun.set({
      id: runId,
      route: "/git",
      preset: "git-root",
      automatic: false,
    })

    measurePerformanceDiagnosticsWork({owner: "repository", phase: "publish"}, () => {
      now += 20
    })
    stopPerformanceDiagnosticsCapture()
    vi.unstubAllGlobals()

    expect(getPerformanceDiagnosticsSnapshot().runs.at(-1)?.records).toEqual([
      expect.objectContaining({
        type: "work-span",
        detail: expect.objectContaining({owner: "repository", phase: "publish", durationMs: 20}),
      }),
    ])
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
