import {
  getRequestSchedulerSnapshots,
  subscribeRequestScheduler,
  subscribeRequestSchedulerMetrics,
  type RequestClass,
  type RequestSchedulerBlockingReason,
  type RequestSchedulerMetric,
  type RequestSchedulerSnapshot,
} from "@welshman/net"
import {
  subscribeRelayNormalization,
  type RelayNormalizationContext,
  type RelayNormalizationObservation,
} from "@welshman/util"
import type {Readable} from "svelte/store"
import {
  debugDiagnosticsSettings,
  debugDiagnosticsActive,
  debugDiagnosticsRevision,
  getDebugDiagnosticsOverview,
  isDebugDiagnosticCategoryEnabled,
  recordDebugDiagnostic,
  type DebugDiagnosticCategory,
  type DebugDiagnosticsSettings,
} from "@app/core/debug-diagnostics"

export type RelayDiagnosticWarningKind = "saturation" | "priority-queue" | "live-growth"

export type RelayDiagnosticWarning = {
  kind: RelayDiagnosticWarningKind
  relay: string
  snapshot: RequestSchedulerSnapshot
}

type RelayDiagnosticMonitorOptions = {
  enabled: boolean
  now?: () => number
  warn?: (message: string, warning: RelayDiagnosticWarning) => void
  warningIntervalMs?: number
  highPriorityQueueAgeMs?: number
  maxWarningsPerInspection?: number
}

const DEFAULT_WARNING_INTERVAL_MS = 30_000
const DEFAULT_HIGH_PRIORITY_QUEUE_AGE_MS = 5_000
const DEFAULT_MAX_WARNINGS_PER_INSPECTION = 3

export type RelayDiagnosticSocket = Pick<
  RequestSchedulerSnapshot,
  | "schedulerId"
  | "learnedMaxSubscriptions"
  | "effectiveMaxSubscriptions"
  | "effectiveMaxLiveSubscriptions"
  | "effectiveMaxBackgroundLiveSubscriptions"
  | "pausedForMs"
>

export type RelayDiagnosticSnapshot = RequestSchedulerSnapshot & {
  socketCount: number
  configuredCapacityTotal: number
  learnedCapacity: {
    knownCount: number
    unknownCount: number
    min: number | null
    max: number | null
    total: number
  }
  sockets: RelayDiagnosticSocket[]
}

export const aggregateRelayDiagnostics = (snapshots: RequestSchedulerSnapshot[]) => {
  const byRelay = new Map<string, RelayDiagnosticSnapshot>()

  for (const snapshot of snapshots) {
    const current = byRelay.get(snapshot.relay)
    if (!current) {
      byRelay.set(snapshot.relay, {
        ...snapshot,
        schedulerId: 0,
        socketCount: 1,
        configuredCapacityTotal: snapshot.configuredMaxSubscriptions,
        learnedCapacity: {
          knownCount: snapshot.learnedMaxSubscriptions === null ? 0 : 1,
          unknownCount: snapshot.learnedMaxSubscriptions === null ? 1 : 0,
          min: snapshot.learnedMaxSubscriptions,
          max: snapshot.learnedMaxSubscriptions,
          total: snapshot.learnedMaxSubscriptions || 0,
        },
        sockets: [
          {
            schedulerId: snapshot.schedulerId,
            learnedMaxSubscriptions: snapshot.learnedMaxSubscriptions,
            effectiveMaxSubscriptions: snapshot.effectiveMaxSubscriptions,
            effectiveMaxLiveSubscriptions: snapshot.effectiveMaxLiveSubscriptions,
            effectiveMaxBackgroundLiveSubscriptions:
              snapshot.effectiveMaxBackgroundLiveSubscriptions,
            pausedForMs: snapshot.pausedForMs,
          },
        ],
        active: {...snapshot.active},
        queued: {...snapshot.queued},
        oldestQueuedAgeMsByClass: {...snapshot.oldestQueuedAgeMsByClass},
        blockingReasonsByClass: Object.fromEntries(
          Object.entries(snapshot.blockingReasonsByClass).map(([key, reasons]) => [
            key,
            [...reasons],
          ]),
        ) as Record<RequestClass, RequestSchedulerBlockingReason[]>,
        owners: snapshot.owners.map(owner => ({...owner})),
      })
      continue
    }

    for (const key of Object.keys(current.active) as Array<keyof typeof current.active>) {
      current.active[key] += snapshot.active[key]
      current.queued[key] += snapshot.queued[key]
    }
    current.configuredMaxSubscriptions += snapshot.configuredMaxSubscriptions
    current.configuredMaxLiveSubscriptions += snapshot.configuredMaxLiveSubscriptions
    current.configuredMaxBackgroundLiveSubscriptions +=
      snapshot.configuredMaxBackgroundLiveSubscriptions
    current.effectiveMaxSubscriptions += snapshot.effectiveMaxSubscriptions
    current.effectiveMaxLiveSubscriptions += snapshot.effectiveMaxLiveSubscriptions
    current.effectiveMaxBackgroundLiveSubscriptions +=
      snapshot.effectiveMaxBackgroundLiveSubscriptions
    current.socketCount += 1
    current.configuredCapacityTotal += snapshot.configuredMaxSubscriptions
    current.sockets.push({
      schedulerId: snapshot.schedulerId,
      learnedMaxSubscriptions: snapshot.learnedMaxSubscriptions,
      effectiveMaxSubscriptions: snapshot.effectiveMaxSubscriptions,
      effectiveMaxLiveSubscriptions: snapshot.effectiveMaxLiveSubscriptions,
      effectiveMaxBackgroundLiveSubscriptions: snapshot.effectiveMaxBackgroundLiveSubscriptions,
      pausedForMs: snapshot.pausedForMs,
    })
    current.sockets.sort((a, b) => a.schedulerId - b.schedulerId)
    if (snapshot.learnedMaxSubscriptions === null) {
      current.learnedCapacity.unknownCount += 1
    } else {
      current.learnedCapacity.knownCount += 1
      current.learnedCapacity.total += snapshot.learnedMaxSubscriptions
      current.learnedCapacity.min = Math.min(
        current.learnedCapacity.min ?? Infinity,
        snapshot.learnedMaxSubscriptions,
      )
      current.learnedCapacity.max = Math.max(
        current.learnedCapacity.max ?? -Infinity,
        snapshot.learnedMaxSubscriptions,
      )
    }
    current.learnedMaxSubscriptions =
      current.learnedMaxSubscriptions === null || snapshot.learnedMaxSubscriptions === null
        ? null
        : current.learnedMaxSubscriptions + snapshot.learnedMaxSubscriptions
    current.oldestQueuedAgeMs = Math.max(current.oldestQueuedAgeMs, snapshot.oldestQueuedAgeMs)
    current.pausedForMs = Math.max(current.pausedForMs, snapshot.pausedForMs)
    for (const requestClass of ["finite", "critical-live", "background-live"] as const) {
      current.oldestQueuedAgeMsByClass[requestClass] = Math.max(
        current.oldestQueuedAgeMsByClass[requestClass],
        snapshot.oldestQueuedAgeMsByClass[requestClass],
      )
      current.blockingReasonsByClass[requestClass] = Array.from(
        new Set([
          ...current.blockingReasonsByClass[requestClass],
          ...snapshot.blockingReasonsByClass[requestClass],
        ]),
      ).sort()
    }
    current.noticeCount += snapshot.noticeCount
    current.queueStartCount += snapshot.queueStartCount
    current.queueStartDelayTotalMs += snapshot.queueStartDelayTotalMs
    current.lastQueueStartDelayMs = Math.max(
      current.lastQueueStartDelayMs,
      snapshot.lastQueueStartDelayMs,
    )
    current.maxQueueStartDelayMs = Math.max(
      current.maxQueueStartDelayMs,
      snapshot.maxQueueStartDelayMs,
    )

    for (const owner of snapshot.owners) {
      const existing = current.owners.find(candidate => candidate.owner === owner.owner)
      if (existing) {
        existing.activeSubscriptions += owner.activeSubscriptions
        existing.activeFilters += owner.activeFilters
        existing.queuedSubscriptions += owner.queuedSubscriptions
        existing.queuedFilters += owner.queuedFilters
      } else {
        current.owners.push({...owner})
      }
    }
    current.owners.sort((a, b) => a.owner.localeCompare(b.owner))
  }

  return Array.from(byRelay.values()).sort((a, b) => a.relay.localeCompare(b.relay))
}

export const readRelayDiagnostics = () => aggregateRelayDiagnostics(getRequestSchedulerSnapshots())

export const subscribeRelayDiagnostics = (
  listener: (snapshots: RelayDiagnosticSnapshot[]) => void,
) => subscribeRequestScheduler(snapshots => listener(aggregateRelayDiagnostics(snapshots)))

export const createRelayDiagnosticMonitor = ({
  enabled,
  now = Date.now,
  warn = (message, warning) => console.warn(message, warning),
  warningIntervalMs = DEFAULT_WARNING_INTERVAL_MS,
  highPriorityQueueAgeMs = DEFAULT_HIGH_PRIORITY_QUEUE_AGE_MS,
  maxWarningsPerInspection = DEFAULT_MAX_WARNINGS_PER_INSPECTION,
}: RelayDiagnosticMonitorOptions) => {
  const lastWarningAt = new Map<string, number>()
  const previousLiveByScheduler = new Map<string, number>()

  const inspect = (snapshots: RequestSchedulerSnapshot[]) => {
    if (!enabled) return

    const timestamp = now()
    const warnings: RelayDiagnosticWarning[] = []
    for (const snapshot of snapshots) {
      const schedulerKey = `${snapshot.relay}:${snapshot.schedulerId}`
      const previousLive = previousLiveByScheduler.get(schedulerKey)
      previousLiveByScheduler.set(schedulerKey, snapshot.active.live)

      const capacityReasons = Object.values(snapshot.blockingReasonsByClass).flatMap(reasons =>
        reasons.filter(reason => reason !== "paused"),
      )
      if (snapshot.queued.total > 0 && capacityReasons.length > 0) {
        warnings.push({kind: "saturation", relay: snapshot.relay, snapshot})
      }

      const oldestPriorityAge = Math.max(
        snapshot.oldestQueuedAgeMsByClass.finite,
        snapshot.oldestQueuedAgeMsByClass["critical-live"],
      )
      if (oldestPriorityAge >= highPriorityQueueAgeMs) {
        warnings.push({kind: "priority-queue", relay: snapshot.relay, snapshot})
      }

      const liveGrowthThreshold = Math.max(
        4,
        Math.ceil(snapshot.effectiveMaxLiveSubscriptions * 0.8),
      )
      if (
        previousLive !== undefined &&
        snapshot.active.live > previousLive &&
        snapshot.active.live >= liveGrowthThreshold
      ) {
        warnings.push({kind: "live-growth", relay: snapshot.relay, snapshot})
      }
    }

    let emitted = 0
    for (const warning of warnings) {
      if (emitted >= maxWarningsPerInspection) break
      const key = `${warning.kind}:${warning.relay}:${warning.snapshot.schedulerId}`
      const previousWarningAt = lastWarningAt.get(key)
      if (previousWarningAt !== undefined && timestamp - previousWarningAt < warningIntervalMs) {
        continue
      }

      lastWarningAt.set(key, timestamp)
      emitted += 1
      warn(`[relay-diagnostics] ${warning.kind} on ${warning.relay}`, warning)
    }
  }

  return {inspect}
}

export const installRelayDiagnostics = ({
  enabled,
  pollIntervalMs = 1_000,
}: {
  enabled: boolean
  pollIntervalMs?: number
}) => {
  if (!enabled) return () => {}

  const monitor = createRelayDiagnosticMonitor({enabled})
  const unsubscribe = subscribeRequestScheduler(monitor.inspect)
  const interval = setInterval(
    () => monitor.inspect(getRequestSchedulerSnapshots()),
    pollIntervalMs,
  )

  return () => {
    clearInterval(interval)
    unsubscribe()
  }
}

export const installRelayDebugDiagnostics = ({
  enabled,
  pollIntervalMs = 10_000,
  settings = debugDiagnosticsSettings,
  active = debugDiagnosticsActive,
  revision = debugDiagnosticsRevision,
  getOverview = getDebugDiagnosticsOverview,
  isCategoryEnabled = isDebugDiagnosticCategoryEnabled,
  read = getRequestSchedulerSnapshots,
  record = recordDebugDiagnostic,
  subscribeNormalization = subscribeRelayNormalization,
  subscribeMetrics = subscribeRequestSchedulerMetrics,
  createSalt = () => crypto.getRandomValues(new Uint8Array(16)),
  hashPath = async (salt, path) => {
    const input = new Uint8Array(salt.length + 1 + new TextEncoder().encode(path).length)
    input.set(salt)
    input[salt.length] = 0
    input.set(new TextEncoder().encode(path), salt.length + 1)
    const digest = await crypto.subtle.digest("SHA-256", input)
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("")
  },
}: {
  enabled: boolean
  pollIntervalMs?: number
  settings?: Readable<DebugDiagnosticsSettings>
  active?: Readable<boolean>
  revision?: Readable<number>
  getOverview?: () => {active: boolean; captureId: string}
  isCategoryEnabled?: (category: DebugDiagnosticCategory) => boolean
  read?: () => RequestSchedulerSnapshot[]
  record?: (category: DebugDiagnosticCategory, type: string, detail?: unknown) => boolean
  subscribeNormalization?: (
    listener: (event: RelayNormalizationObservation, context: RelayNormalizationContext) => void,
  ) => () => void
  subscribeMetrics?: (listener: (metric: RequestSchedulerMetric) => void) => () => void
  createSalt?: () => Uint8Array
  hashPath?: (salt: Uint8Array, path: string) => Promise<string>
}) => {
  if (!enabled) return () => {}

  const MAX_NORMALIZATION_SAMPLES = 20
  let normalizationUnsubscribe: (() => void) | undefined
  let normalizationInterval: ReturnType<typeof setInterval> | undefined
  let normalizationSalt = new Uint8Array()
  let normalizationGeneration = 0
  let normalizationBatch = createNormalizationBatch()
  let schedulerInterval: ReturnType<typeof setInterval> | undefined
  let schedulerStarted = false
  let schedulerMetricUnsubscribe: (() => void) | undefined
  let schedulerMonitor: ReturnType<typeof createRelayDiagnosticMonitor> | undefined
  let schedulerCapture = {
    noticeCount: 0,
    queueStartCount: 0,
    queueStartDelayTotalMs: 0,
    maxQueueStartDelayMs: 0,
  }
  let schedulerStates = new Map<number, string>()
  let captureId = ""
  let stopped = false

  function createNormalizationBatch() {
    return {
      calls: {total: 0, unchanged: 0, normalized: 0, rejected: 0},
      reasons: {
        schemeCaseChanged: 0,
        hostnameCaseChanged: 0,
        defaultPortRemoved: 0,
        rootSlashAdded: 0,
        fragmentRemoved: 0,
      },
      samples: [] as Array<{
        endpoint: string
        outcome: RelayNormalizationObservation["outcome"]
        reasons: string[]
        inputPath: string
        canonicalPath?: string
      }>,
      droppedSamples: 0,
    }
  }

  const recordSafely = (category: DebugDiagnosticCategory, type: string, detail: unknown) => {
    try {
      record(category, type, detail)
    } catch {
      // Diagnostics must never affect relay scheduling or normalization.
    }
  }
  const stopNormalization = () => {
    normalizationUnsubscribe?.()
    normalizationUnsubscribe = undefined
    if (normalizationInterval !== undefined) clearInterval(normalizationInterval)
    normalizationInterval = undefined
    normalizationGeneration += 1
    normalizationBatch = createNormalizationBatch()
  }
  const stopScheduler = () => {
    if (schedulerInterval !== undefined) clearInterval(schedulerInterval)
    schedulerMetricUnsubscribe?.()
    schedulerInterval = undefined
    schedulerStarted = false
    schedulerMetricUnsubscribe = undefined
    schedulerMonitor = undefined
    schedulerStates.clear()
  }
  const flushNormalization = async () => {
    const batch = normalizationBatch
    if (batch.calls.total === 0) return
    normalizationBatch = createNormalizationBatch()
    const generation = normalizationGeneration
    const samples = await Promise.all(
      batch.samples.map(async sample => ({
        endpoint: sample.endpoint,
        outcome: sample.outcome,
        reasons: sample.reasons,
        pathSegments: sample.inputPath.split("/").filter(Boolean).length,
        pathHadTrailingSlash: sample.inputPath.endsWith("/"),
        pathHash: await hashPath(normalizationSalt, sample.inputPath),
        ...(sample.canonicalPath === undefined
          ? {}
          : {canonicalPathHash: await hashPath(normalizationSalt, sample.canonicalPath)}),
      })),
    ).catch(() => [])
    if (
      stopped ||
      generation !== normalizationGeneration ||
      getOverview().captureId !== captureId
    ) {
      return
    }
    recordSafely("relay-normalization", "aggregate", {
      intervalMs: pollIntervalMs,
      calls: batch.calls,
      reasons: batch.reasons,
      samples,
      droppedSamples: batch.droppedSamples,
      pathHashAlgorithm: "sha256",
      pathHashScope: "capture",
    })
  }
  const startNormalization = () => {
    if (normalizationUnsubscribe) return
    normalizationSalt = new Uint8Array(createSalt())
    normalizationGeneration += 1
    normalizationBatch = createNormalizationBatch()
    normalizationUnsubscribe = subscribeNormalization((event, context) => {
      const batch = normalizationBatch
      batch.calls.total += 1
      batch.calls[event.outcome] += 1
      for (const reason of Object.keys(batch.reasons) as Array<keyof typeof batch.reasons>) {
        if (event.reasons[reason]) batch.reasons[reason] += 1
      }
      if (event.outcome === "unchanged") return
      if (batch.samples.length < MAX_NORMALIZATION_SAMPLES) {
        batch.samples.push({
          endpoint: event.inputEndpoint,
          outcome: event.outcome,
          reasons: Object.entries(event.reasons)
            .filter(([, present]) => present)
            .map(([reason]) => reason),
          inputPath: context?.inputPath || "",
          canonicalPath: context?.canonicalPath,
        })
      } else {
        batch.droppedSamples += 1
      }
    })
    normalizationInterval = setInterval(() => void flushNormalization(), pollIntervalMs)
  }
  const recordSchedulerTransitions = (snapshots: RequestSchedulerSnapshot[]) => {
    for (const snapshot of snapshots) {
      const state = JSON.stringify({
        blockingReasonsByClass: snapshot.blockingReasonsByClass,
        paused: snapshot.pausedForMs > 0,
        learnedMaxSubscriptions: snapshot.learnedMaxSubscriptions,
      })
      const previous = schedulerStates.get(snapshot.schedulerId)
      if (previous !== undefined && previous !== state) {
        recordSafely("relay-scheduler", "state-transition", {
          schedulerId: snapshot.schedulerId,
          relay: snapshot.relay,
          blockingReasonsByClass: snapshot.blockingReasonsByClass,
          pausedForMs: snapshot.pausedForMs,
          learnedMaxSubscriptions: snapshot.learnedMaxSubscriptions,
        })
      }
      schedulerStates.set(snapshot.schedulerId, state)
    }
  }
  const recordSchedulerSnapshot = () => {
    const snapshots = read()
    recordSafely("relay-scheduler", "heartbeat", {
      snapshots: aggregateRelayDiagnostics(snapshots),
      capture: {
        ...schedulerCapture,
        averageQueueStartDelayMs:
          schedulerCapture.queueStartCount === 0
            ? 0
            : schedulerCapture.queueStartDelayTotalMs / schedulerCapture.queueStartCount,
      },
    })
    recordSchedulerTransitions(snapshots)
    schedulerMonitor?.inspect(snapshots)
  }
  const startScheduler = () => {
    if (schedulerStarted) return
    schedulerStarted = true
    schedulerCapture = {
      noticeCount: 0,
      queueStartCount: 0,
      queueStartDelayTotalMs: 0,
      maxQueueStartDelayMs: 0,
    }
    schedulerMonitor = createRelayDiagnosticMonitor({
      enabled: true,
      warn: (_message, warning) => recordSafely("relay-scheduler", "warning", warning),
    })
    schedulerMetricUnsubscribe = subscribeMetrics(metric => {
      if (metric.type === "notice") schedulerCapture.noticeCount += 1
      else {
        schedulerCapture.queueStartCount += 1
        schedulerCapture.queueStartDelayTotalMs += metric.delayMs
        schedulerCapture.maxQueueStartDelayMs = Math.max(
          schedulerCapture.maxQueueStartDelayMs,
          metric.delayMs,
        )
      }
      queueMicrotask(() => {
        if (!schedulerStarted) return
        try {
          recordSchedulerTransitions(read())
        } catch {
          // Metric-triggered diagnostics are best effort.
        }
      })
    })
    try {
      recordSchedulerSnapshot()
    } catch {
      // A diagnostic read failure must not affect the scheduler.
    }
    schedulerInterval = setInterval(() => {
      try {
        recordSchedulerSnapshot()
      } catch {
        // A diagnostic read failure must not affect the scheduler.
      }
    }, pollIntervalMs)
  }

  const reconcile = () => {
    const overview = getOverview()
    if (!overview.active) {
      captureId = overview.captureId
      stopNormalization()
      stopScheduler()
      return
    }
    if (captureId !== overview.captureId) {
      stopNormalization()
      stopScheduler()
      captureId = overview.captureId
    }
    if (isCategoryEnabled("relay-normalization")) startNormalization()
    else stopNormalization()
    if (isCategoryEnabled("relay-scheduler")) startScheduler()
    else stopScheduler()
  }
  const unsubscribeSettings = settings.subscribe(reconcile)
  const unsubscribeActive = active.subscribe(reconcile)
  const unsubscribeRevision = revision.subscribe(reconcile)

  return () => {
    if (stopped) return
    stopped = true
    unsubscribeSettings()
    unsubscribeActive()
    unsubscribeRevision()
    stopNormalization()
    stopScheduler()
  }
}
