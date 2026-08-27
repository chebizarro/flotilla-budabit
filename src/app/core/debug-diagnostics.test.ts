import {get} from "svelte/store"
import {beforeEach, describe, expect, it, vi} from "vitest"
import {
  DEBUG_DIAGNOSTICS_SETTINGS_STORAGE_KEY,
  createDebugDiagnosticsRecorder,
  defaultDebugDiagnosticsSettings,
  normalizeDebugDiagnosticsSettings,
  refreshDebugDiagnosticsSettings,
  debugDiagnosticsSettings,
  sanitizeDebugDiagnosticValue,
  setDebugDiagnosticCategoryEnabled,
} from "./debug-diagnostics"

describe("debug diagnostics", () => {
  beforeEach(() => {
    const storage = new Map<string, string>()
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    refreshDebugDiagnosticsSettings()
  })

  it("defaults every category off and fails malformed settings closed", () => {
    expect(defaultDebugDiagnosticsSettings().categories).toEqual({
      "relay-normalization": false,
      "relay-scheduler": false,
      "publication-lifecycle": false,
    })
    expect(normalizeDebugDiagnosticsSettings({version: 2, categories: {}})).toEqual(
      defaultDebugDiagnosticsSettings(),
    )
    expect(
      normalizeDebugDiagnosticsSettings({
        version: 1,
        categories: {"relay-normalization": true, unknown: true},
      }).categories,
    ).toEqual({
      "relay-normalization": true,
      "relay-scheduler": false,
      "publication-lifecycle": false,
    })
  })

  it("persists category selections but no records", () => {
    setDebugDiagnosticCategoryEnabled("relay-normalization", true)

    expect(get(debugDiagnosticsSettings).categories["relay-normalization"]).toBe(true)
    expect(JSON.parse(localStorage.getItem(DEBUG_DIAGNOSTICS_SETTINGS_STORAGE_KEY)!)).toEqual({
      version: 1,
      categories: {
        "relay-normalization": true,
        "relay-scheduler": false,
        "publication-lifecycle": false,
      },
    })
  })

  it("records only while active and enabled", () => {
    let now = 100
    const recorder = createDebugDiagnosticsRecorder({now: () => now})
    recorder.start("capture")

    expect(recorder.record("relay-normalization", "ignored")).toBe(false)
    recorder.setCategoryEnabled("relay-normalization", true)
    now = 125
    expect(recorder.record("relay-normalization", "normalized", {valid: true})).toBe(true)
    recorder.stop()
    expect(recorder.record("relay-normalization", "ignored-after-stop")).toBe(false)

    expect(recorder.snapshot()).toMatchObject({
      capture: {id: "capture", startedAt: 100, finishedAt: 125, active: false},
      records: [{category: "relay-normalization", type: "normalized", elapsedMs: 25}],
    })
  })

  it("enforces global and per-category bounds", () => {
    let now = 0
    const recorder = createDebugDiagnosticsRecorder({
      now: () => ++now,
      maxRecords: 3,
      maxRecordsPerCategory: 2,
    })
    recorder.setCategoryEnabled("relay-normalization", true)
    recorder.setCategoryEnabled("relay-scheduler", true)
    recorder.start("bounded")
    recorder.record("relay-normalization", "one")
    recorder.record("relay-normalization", "two")
    recorder.record("relay-normalization", "three")
    recorder.record("relay-scheduler", "four")
    recorder.record("relay-scheduler", "five")

    expect(recorder.snapshot().records.map(record => record.type)).toEqual([
      "three",
      "four",
      "five",
    ])
    expect(recorder.overview()).toMatchObject({
      recordCount: 3,
      counts: {"relay-normalization": 1, "relay-scheduler": 2},
    })
  })

  it("redacts secret keys, secret values, credentials, and URL queries", () => {
    expect(
      sanitizeDebugDiagnosticValue({
        token: "plain-secret",
        content: "private event body",
        message: "Authorization: Bearer abc123 nsec1qqqqqqqqqqqqqqqqqqqqqqqq",
        relay: "wss://user:pass@relay.example/Path?token=AbC#fragment",
      }),
    ).toEqual({
      token: "[redacted]",
      content: "[redacted]",
      message: "[redacted] [redacted]",
      relay: "wss://relay.example/Path?[redacted]",
    })
  })
})
