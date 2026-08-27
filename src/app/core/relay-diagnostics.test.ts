import {writable} from "svelte/store"
import {afterEach, describe, expect, it, vi} from "vitest"
import type {RequestSchedulerSnapshot} from "@welshman/net"
import type {RelayNormalizationObservation} from "@welshman/util"
import {defaultDebugDiagnosticsSettings} from "./debug-diagnostics"
import {
  aggregateRelayDiagnostics,
  createRelayDiagnosticMonitor,
  installRelayDebugDiagnostics,
} from "./relay-diagnostics"

const makeSnapshot = (
  overrides: Partial<RequestSchedulerSnapshot> = {},
): RequestSchedulerSnapshot => ({
  relay: "wss://relay.example/",
  configuredMaxSubscriptions: 28,
  configuredMaxLiveSubscriptions: 24,
  configuredMaxBackgroundLiveSubscriptions: 18,
  learnedMaxSubscriptions: null,
  effectiveMaxSubscriptions: 28,
  active: {total: 0, finite: 0, live: 0, criticalLive: 0, backgroundLive: 0},
  queued: {total: 0, finite: 0, live: 0, criticalLive: 0, backgroundLive: 0},
  oldestQueuedAgeMs: 0,
  oldestQueuedAgeMsByClass: {finite: 0, "critical-live": 0, "background-live": 0},
  owners: [],
  noticeCount: 0,
  lastQueueStartDelayMs: 0,
  maxQueueStartDelayMs: 0,
  ...overrides,
})

describe("relay diagnostics", () => {
  afterEach(() => vi.useRealTimers())

  it("aggregates duplicate socket snapshots by relay and owner", () => {
    const snapshots = aggregateRelayDiagnostics([
      makeSnapshot({
        active: {total: 1, finite: 0, live: 1, criticalLive: 0, backgroundLive: 1},
        owners: [
          {
            owner: "extension:a",
            activeSubscriptions: 1,
            activeFilters: 2,
            queuedSubscriptions: 0,
            queuedFilters: 0,
          },
        ],
        noticeCount: 1,
      }),
      makeSnapshot({
        learnedMaxSubscriptions: 20,
        active: {total: 1, finite: 1, live: 0, criticalLive: 0, backgroundLive: 0},
        queued: {total: 1, finite: 0, live: 1, criticalLive: 1, backgroundLive: 0},
        oldestQueuedAgeMs: 2_000,
        oldestQueuedAgeMsByClass: {
          finite: 0,
          "critical-live": 2_000,
          "background-live": 0,
        },
        owners: [
          {
            owner: "extension:a",
            activeSubscriptions: 1,
            activeFilters: 1,
            queuedSubscriptions: 1,
            queuedFilters: 3,
          },
        ],
        noticeCount: 2,
      }),
    ])

    expect(snapshots).toEqual([
      expect.objectContaining({
        relay: "wss://relay.example/",
        learnedMaxSubscriptions: 20,
        active: {total: 2, finite: 1, live: 1, criticalLive: 0, backgroundLive: 1},
        queued: {total: 1, finite: 0, live: 1, criticalLive: 1, backgroundLive: 0},
        oldestQueuedAgeMs: 2_000,
        noticeCount: 3,
        owners: [
          {
            owner: "extension:a",
            activeSubscriptions: 2,
            activeFilters: 3,
            queuedSubscriptions: 1,
            queuedFilters: 3,
          },
        ],
      }),
    ])
  })

  it("does not emit production-disabled warnings", () => {
    const warn = vi.fn()
    const monitor = createRelayDiagnosticMonitor({enabled: false, warn})

    monitor.inspect([
      makeSnapshot({
        active: {total: 28, finite: 8, live: 20, criticalLive: 2, backgroundLive: 18},
        queued: {total: 1, finite: 1, live: 0, criticalLive: 0, backgroundLive: 0},
        oldestQueuedAgeMsByClass: {
          finite: 10_000,
          "critical-live": 0,
          "background-live": 0,
        },
      }),
    ])

    expect(warn).not.toHaveBeenCalled()
  })

  it("warns for saturation, stale priority work, and unexpected live growth", () => {
    let timestamp = 1_000
    const warn = vi.fn()
    const monitor = createRelayDiagnosticMonitor({
      enabled: true,
      now: () => timestamp,
      warn,
      warningIntervalMs: 30_000,
    })
    monitor.inspect([
      makeSnapshot({
        active: {total: 26, finite: 7, live: 19, criticalLive: 1, backgroundLive: 18},
      }),
    ])

    const saturated = makeSnapshot({
      active: {total: 28, finite: 8, live: 20, criticalLive: 2, backgroundLive: 18},
      queued: {total: 2, finite: 1, live: 1, criticalLive: 1, backgroundLive: 0},
      oldestQueuedAgeMs: 7_000,
      oldestQueuedAgeMsByClass: {
        finite: 7_000,
        "critical-live": 6_000,
        "background-live": 0,
      },
      owners: [
        {
          owner: "community-core",
          activeSubscriptions: 20,
          activeFilters: 40,
          queuedSubscriptions: 1,
          queuedFilters: 2,
        },
      ],
    })
    monitor.inspect([saturated])

    expect(warn.mock.calls.map(([, warning]) => warning.kind)).toEqual([
      "saturation",
      "priority-queue",
      "live-growth",
    ])

    timestamp += 1_000
    monitor.inspect([saturated])
    expect(warn).toHaveBeenCalledTimes(3)

    timestamp += 30_000
    monitor.inspect([saturated])
    expect(warn.mock.calls.slice(3).map(([, warning]) => warning.kind)).toEqual([
      "saturation",
      "priority-queue",
    ])
  })

  it("bounds warnings emitted by one inspection", () => {
    const warn = vi.fn()
    const monitor = createRelayDiagnosticMonitor({
      enabled: true,
      warn,
      highPriorityQueueAgeMs: 1,
      maxWarningsPerInspection: 1,
    })
    const snapshot = makeSnapshot({
      active: {total: 28, finite: 10, live: 18, criticalLive: 0, backgroundLive: 18},
      queued: {total: 1, finite: 1, live: 0, criticalLive: 0, backgroundLive: 0},
      oldestQueuedAgeMsByClass: {finite: 10, "critical-live": 0, "background-live": 0},
    })

    monitor.inspect([snapshot])

    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("installs category-controlled normalization and scheduler recording", () => {
    vi.useFakeTimers()
    const settings = writable(defaultDebugDiagnosticsSettings())
    const record = vi.fn(() => true)
    const read = vi.fn(() => [makeSnapshot()])
    let normalizationListener: ((event: RelayNormalizationObservation) => void) | undefined
    const unsubscribeNormalization = vi.fn()
    const subscribeNormalization = vi.fn(listener => {
      normalizationListener = listener
      return unsubscribeNormalization
    })
    const uninstall = installRelayDebugDiagnostics({
      enabled: true,
      pollIntervalMs: 100,
      settings,
      read,
      record,
      subscribeNormalization,
    })

    vi.advanceTimersByTime(200)
    expect(read).not.toHaveBeenCalled()
    expect(subscribeNormalization).not.toHaveBeenCalled()

    settings.update(current => ({
      ...current,
      categories: {...current.categories, "relay-normalization": true},
    }))
    expect(subscribeNormalization).toHaveBeenCalledOnce()
    normalizationListener?.({
      source: "welshman.normalizeRelayUrl",
      outcome: "normalized",
      classification: "equivalent-spelling",
      changed: true,
      inputShape: {
        hadProtocol: false,
        hadCredentials: false,
        hadQuery: false,
        hadFragment: false,
        hadTrailingSlash: false,
        hadUppercase: false,
      },
      inputEndpoint: "wss://relay.example/",
      canonicalEndpoint: "wss://relay.example/",
    })
    expect(record).toHaveBeenCalledWith(
      "relay-normalization",
      "normalized",
      expect.objectContaining({classification: "equivalent-spelling"}),
    )

    settings.update(current => ({
      ...current,
      categories: {...current.categories, "relay-scheduler": true},
    }))
    vi.advanceTimersByTime(250)
    expect(read).toHaveBeenCalledTimes(2)
    expect(record).toHaveBeenCalledWith("relay-scheduler", "snapshot", {
      snapshots: [makeSnapshot()],
    })

    settings.update(current => ({
      ...current,
      categories: {...current.categories, "relay-normalization": false},
    }))
    expect(unsubscribeNormalization).toHaveBeenCalledOnce()
    uninstall()
    vi.advanceTimersByTime(200)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it("keeps disabled and failing debug installers isolated", () => {
    vi.useFakeTimers()
    const settings = writable({
      ...defaultDebugDiagnosticsSettings(),
      categories: {
        ...defaultDebugDiagnosticsSettings().categories,
        "relay-scheduler": true,
      },
    })
    const read = vi.fn(() => {
      throw new Error("diagnostic read failed")
    })
    const record = vi.fn(() => {
      throw new Error("diagnostic record failed")
    })

    const disabled = installRelayDebugDiagnostics({enabled: false, settings, read, record})
    vi.advanceTimersByTime(1_000)
    expect(read).not.toHaveBeenCalled()
    disabled()

    const uninstall = installRelayDebugDiagnostics({
      enabled: true,
      pollIntervalMs: 100,
      settings,
      read,
      record,
    })
    expect(() => vi.advanceTimersByTime(100)).not.toThrow()
    expect(read).toHaveBeenCalledOnce()
    expect(() => uninstall()).not.toThrow()
    expect(() => uninstall()).not.toThrow()
  })
})
