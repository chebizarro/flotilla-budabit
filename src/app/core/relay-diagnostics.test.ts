import {writable} from "svelte/store"
import {afterEach, describe, expect, it, vi} from "vitest"
import type {RequestSchedulerMetric, RequestSchedulerSnapshot} from "@welshman/net"
import type {RelayNormalizationContext, RelayNormalizationObservation} from "@welshman/util"
import {defaultDebugDiagnosticsSettings} from "./debug-diagnostics"
import {
  aggregateRelayDiagnostics,
  createRelayDiagnosticMonitor,
  installRelayDebugDiagnostics,
} from "./relay-diagnostics"

const makeSnapshot = (
  overrides: Partial<RequestSchedulerSnapshot> = {},
): RequestSchedulerSnapshot => ({
  schedulerId: 1,
  relay: "wss://relay.example/",
  configuredMaxSubscriptions: 28,
  configuredMaxLiveSubscriptions: 24,
  configuredMaxBackgroundLiveSubscriptions: 18,
  learnedMaxSubscriptions: null,
  effectiveMaxSubscriptions: 28,
  effectiveMaxLiveSubscriptions: 24,
  effectiveMaxBackgroundLiveSubscriptions: 18,
  blockingReasonsByClass: {finite: [], "critical-live": [], "background-live": []},
  pausedForMs: 0,
  active: {total: 0, finite: 0, live: 0, criticalLive: 0, backgroundLive: 0},
  queued: {total: 0, finite: 0, live: 0, criticalLive: 0, backgroundLive: 0},
  oldestQueuedAgeMs: 0,
  oldestQueuedAgeMsByClass: {finite: 0, "critical-live": 0, "background-live": 0},
  owners: [],
  noticeCount: 0,
  lastQueueStartDelayMs: 0,
  maxQueueStartDelayMs: 0,
  queueStartCount: 0,
  queueStartDelayTotalMs: 0,
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
        schedulerId: 0,
        socketCount: 2,
        configuredCapacityTotal: 56,
        learnedCapacity: {knownCount: 1, unknownCount: 1, min: 20, max: 20, total: 20},
        configuredMaxSubscriptions: 56,
        effectiveMaxSubscriptions: 56,
        learnedMaxSubscriptions: null,
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
      blockingReasonsByClass: {
        finite: ["max-subscriptions"],
        "critical-live": ["max-live-subscriptions"],
        "background-live": [],
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

  it("does not treat combined same-relay socket load as one socket's saturation", () => {
    const warn = vi.fn()
    const monitor = createRelayDiagnosticMonitor({enabled: true, warn})

    monitor.inspect([
      makeSnapshot({
        schedulerId: 1,
        active: {total: 15, finite: 0, live: 15, criticalLive: 0, backgroundLive: 0},
      }),
      makeSnapshot({
        schedulerId: 2,
        active: {total: 15, finite: 0, live: 15, criticalLive: 0, backgroundLive: 0},
        queued: {total: 1, finite: 1, live: 0, criticalLive: 0, backgroundLive: 0},
      }),
    ])

    expect(warn).not.toHaveBeenCalled()
  })

  it("warns for class-limited queues but not adaptive pauses alone", () => {
    const warn = vi.fn()
    const monitor = createRelayDiagnosticMonitor({enabled: true, warn})

    monitor.inspect([
      makeSnapshot({
        active: {total: 18, finite: 0, live: 18, criticalLive: 0, backgroundLive: 18},
        queued: {total: 1, finite: 0, live: 1, criticalLive: 0, backgroundLive: 1},
        blockingReasonsByClass: {
          finite: [],
          "critical-live": [],
          "background-live": ["max-background-live-subscriptions"],
        },
      }),
    ])
    expect(warn.mock.calls.map(([, warning]) => warning.kind)).toContain("saturation")

    warn.mockClear()
    monitor.inspect([
      makeSnapshot({
        queued: {total: 1, finite: 1, live: 0, criticalLive: 0, backgroundLive: 0},
        blockingReasonsByClass: {finite: ["paused"], "critical-live": [], "background-live": []},
        pausedForMs: 200,
      }),
    ])
    expect(warn).not.toHaveBeenCalled()
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
      blockingReasonsByClass: {
        finite: ["max-subscriptions"],
        "critical-live": [],
        "background-live": [],
      },
    })

    monitor.inspect([snapshot])

    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("gates and aggregates normalization and scheduler recording by active capture", async () => {
    vi.useFakeTimers()
    const settings = writable(defaultDebugDiagnosticsSettings())
    let currentSettings = defaultDebugDiagnosticsSettings()
    settings.subscribe(value => (currentSettings = value))
    const active = writable(false)
    const revision = writable(0)
    const overview = {active: false, captureId: ""}
    const record = vi.fn(() => true)
    const read = vi.fn(() => [makeSnapshot()])
    let normalizationListener:
      | ((event: RelayNormalizationObservation, context: RelayNormalizationContext) => void)
      | undefined
    const unsubscribeNormalization = vi.fn()
    const subscribeNormalization = vi.fn(listener => {
      normalizationListener = listener
      return unsubscribeNormalization
    })
    const uninstall = installRelayDebugDiagnostics({
      enabled: true,
      pollIntervalMs: 100,
      settings,
      active,
      revision,
      getOverview: () => overview,
      isCategoryEnabled: category => currentSettings.categories[category],
      read,
      record,
      subscribeNormalization,
      subscribeMetrics: () => () => {},
      createSalt: () => new Uint8Array([1]),
      hashPath: async (_salt, path) => `hash:${path}`,
    })

    vi.advanceTimersByTime(200)
    expect(read).not.toHaveBeenCalled()
    expect(subscribeNormalization).not.toHaveBeenCalled()

    settings.update(current => ({
      ...current,
      categories: {...current.categories, "relay-normalization": true},
    }))
    expect(subscribeNormalization).not.toHaveBeenCalled()
    overview.active = true
    overview.captureId = "capture-1"
    active.set(true)
    expect(subscribeNormalization).toHaveBeenCalledOnce()
    normalizationListener?.(
      {
        source: "welshman.normalizeRelayUrl",
        outcome: "normalized",
        classification: "equivalent-spelling",
        changed: true,
        inputType: "string",
        inputShape: {
          hadProtocol: false,
          hadCredentials: false,
          hadQuery: false,
          hadFragment: false,
          hadTrailingSlash: false,
          pathHadUppercase: false,
          queryHadUppercase: false,
        },
        reasons: {
          schemeCaseChanged: false,
          hostnameCaseChanged: false,
          defaultPortRemoved: false,
          rootSlashAdded: true,
          fragmentRemoved: false,
        },
        inputEndpoint: "wss://relay.example",
        canonicalEndpoint: "wss://relay.example",
      },
      {inputPath: "", canonicalPath: "/"},
    )
    expect(record).not.toHaveBeenCalledWith("relay-normalization", "normalized", expect.anything())
    await vi.advanceTimersByTimeAsync(100)
    expect(record).toHaveBeenCalledWith(
      "relay-normalization",
      "aggregate",
      expect.objectContaining({
        calls: {total: 1, unchanged: 0, normalized: 1, rejected: 0},
        samples: [expect.objectContaining({endpoint: "wss://relay.example", pathHash: "hash:"})],
      }),
      1,
    )

    settings.update(current => ({
      ...current,
      categories: {...current.categories, "relay-scheduler": true},
    }))
    vi.advanceTimersByTime(250)
    expect(read).toHaveBeenCalledTimes(3)
    expect(record).toHaveBeenCalledWith(
      "relay-scheduler",
      "heartbeat",
      expect.objectContaining({
        snapshots: [expect.objectContaining({schedulerId: 0, socketCount: 1})],
      }),
      0,
    )

    settings.update(current => ({
      ...current,
      categories: {...current.categories, "relay-normalization": false},
    }))
    expect(unsubscribeNormalization).toHaveBeenCalledOnce()
    uninstall()
    vi.advanceTimersByTime(200)
    expect(read).toHaveBeenCalledTimes(3)
  })

  it("flushes partial normalization and scheduler observations before capture stop", async () => {
    vi.useFakeTimers()
    const settings = writable({
      ...defaultDebugDiagnosticsSettings(),
      categories: {
        ...defaultDebugDiagnosticsSettings().categories,
        "relay-normalization": true,
        "relay-scheduler": true,
      },
    })
    const active = writable(true)
    const revision = writable(0)
    const overview = {active: true, captureId: "capture"}
    const record = vi.fn(() => true)
    let normalizationListener:
      | ((event: RelayNormalizationObservation, context: RelayNormalizationContext) => void)
      | undefined
    let metricListener: ((metric: RequestSchedulerMetric) => void) | undefined
    let finalize: (() => void | Promise<void>) | undefined
    const unregisterFinalizer = vi.fn()
    const uninstall = installRelayDebugDiagnostics({
      enabled: true,
      pollIntervalMs: 10_000,
      settings,
      active,
      revision,
      getOverview: () => overview,
      isCategoryEnabled: category => category !== "publication-lifecycle",
      read: () => [makeSnapshot()],
      record,
      registerFinalizer: callback => {
        finalize = callback
        return unregisterFinalizer
      },
      subscribeNormalization: listener => {
        normalizationListener = listener
        return vi.fn()
      },
      subscribeMetrics: listener => {
        metricListener = listener
        return vi.fn()
      },
      createSalt: () => new Uint8Array([1]),
      hashPath: async (_salt, path) => `hash:${path}`,
    })
    record.mockClear()
    normalizationListener?.(
      {
        source: "welshman.normalizeRelayUrl",
        outcome: "unchanged",
        classification: "canonical",
        changed: false,
        inputType: "string",
        inputShape: {
          hadProtocol: true,
          hadCredentials: false,
          hadQuery: false,
          hadFragment: false,
          hadTrailingSlash: true,
          pathHadUppercase: false,
          queryHadUppercase: false,
        },
        reasons: {
          schemeCaseChanged: false,
          hostnameCaseChanged: false,
          defaultPortRemoved: false,
          rootSlashAdded: false,
          fragmentRemoved: false,
        },
        inputEndpoint: "wss://relay.example",
        canonicalEndpoint: "wss://relay.example",
      },
      {inputPath: "/", canonicalPath: "/"},
    )
    metricListener?.({
      type: "queue-start",
      schedulerId: 1,
      relay: "wss://relay.example/",
      delayMs: 5,
    })

    await finalize?.()

    expect(record).toHaveBeenCalledWith(
      "relay-normalization",
      "aggregate",
      expect.objectContaining({calls: expect.objectContaining({total: 1})}),
      1,
    )
    expect(record).toHaveBeenCalledWith(
      "relay-scheduler",
      "heartbeat",
      expect.objectContaining({capture: expect.objectContaining({queueStartCount: 1})}),
      1,
    )
    uninstall()
    expect(unregisterFinalizer).toHaveBeenCalledOnce()
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
      active: writable(true),
      revision: writable(0),
      getOverview: () => ({active: true, captureId: "capture"}),
      isCategoryEnabled: category => category === "relay-scheduler",
      read,
      record,
      subscribeMetrics: () => () => {},
    })
    expect(() => vi.advanceTimersByTime(100)).not.toThrow()
    expect(read).toHaveBeenCalledTimes(2)
    expect(() => uninstall()).not.toThrow()
    expect(() => uninstall()).not.toThrow()
  })
})
