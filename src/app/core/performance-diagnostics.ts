import {writable} from "svelte/store"
import {APP_BUILD_HASH, APP_BUILD_ID} from "@app/core/build-info"
import {readRelayDiagnostics} from "@app/core/relay-diagnostics"

export const PERFORMANCE_DIAGNOSTICS_SCHEMA_VERSION = 1
export const PERFORMANCE_DIAGNOSTICS_DEFAULT_BLOSSOM = "https://blossom.budabit.club"
export const PERFORMANCE_DIAGNOSTICS_DEFAULT_RELAY = "wss://blossom.budabit.club"

const MAX_RUNS = 20
const MAX_MILESTONES = 100
const MAX_RECORDS = 500
const MAX_LONG_TASKS = 200
const MAX_RESOURCES = 500
const MAX_SCHEDULER_SNAPSHOTS = 240
const MAX_WARNINGS = 100
const MAX_DETAIL_DEPTH = 8
const MAX_STRING_LENGTH = 20_000

const SECRET_KEY_PATTERN =
  /^(authorization|cookie|private[-_]?key|secret|signer[-_]?secret|bunker|nostrconnect|nsec)$/i
const SECRET_VALUE_PATTERNS = [
  /nsec1[023456789acdefghjklmnpqrstuvwxyz]{20,}/gi,
  /ncryptsec1[023456789acdefghjklmnpqrstuvwxyz]{20,}/gi,
  /bunker:\/\/[^\s"']+/gi,
  /nostrconnect:\/\/[^\s"']+/gi,
  /Authorization:\s*(?:Nostr|Bearer)\s+[^\s"']+/gi,
]

export type PerformanceDiagnosticValue =
  | null
  | boolean
  | number
  | string
  | PerformanceDiagnosticValue[]
  | {[key: string]: PerformanceDiagnosticValue}

export type PerformanceDiagnosticMilestone = {
  name: string
  elapsedMs: number
  at: number
  detail?: PerformanceDiagnosticValue
}

export type PerformanceDiagnosticRecord = {
  type: string
  elapsedMs: number
  at: number
  detail?: PerformanceDiagnosticValue
}

export type PerformanceDiagnosticRun = {
  id: string
  route: string
  preset: "community-home" | "git-root" | "custom"
  context?: PerformanceDiagnosticValue
  startedAt: number
  startedWallTime: number
  finishedAt?: number
  durationMs?: number
  status: "running" | "complete" | "failed" | "cancelled"
  milestones: PerformanceDiagnosticMilestone[]
  records: PerformanceDiagnosticRecord[]
  longTasks: PerformanceDiagnosticRecord[]
  resources: PerformanceDiagnosticRecord[]
  scheduler: PerformanceDiagnosticRecord[]
  warnings: PerformanceDiagnosticRecord[]
}

export type PerformanceDiagnosticsSnapshot = {
  schemaVersion: 1
  generatedAt: number
  build: {id: string; hash: string}
  environment: {
    href: string
    userAgent: string
    language: string
    viewport: {width: number; height: number; devicePixelRatio: number}
    hardwareConcurrency: number
    deviceMemory?: number
    serviceWorkerControlled: boolean
  }
  runs: PerformanceDiagnosticRun[]
}

export type PreparedPerformanceDiagnosticsArtifact = {
  schemaVersion: 1
  filename: string
  encoding: "gzip" | "identity"
  contentType: "application/gzip" | "application/json"
  bytes: Uint8Array
  sha256: string
  uncompressedBytes: number
}

type Clock = {
  now: () => number
  wallTime: () => number
}

type PrepareOptions = {
  compress?: (bytes: Uint8Array) => Promise<Uint8Array | undefined>
  hash?: (bytes: Uint8Array) => Promise<string>
  runId?: string
}

const defaultClock: Clock = {
  now: () => (typeof performance === "undefined" ? Date.now() : performance.now()),
  wallTime: () => Date.now(),
}

let runs: PerformanceDiagnosticRun[] = []
const clockByRun = new Map<string, Clock>()

export const performanceDiagnosticsRevision = writable(0)

const notify = () => performanceDiagnosticsRevision.update(value => value + 1)

const boundedPush = <T>(items: T[], value: T, limit: number) => {
  items.push(value)
  if (items.length > limit) items.splice(0, items.length - limit)
}

const replaceSecrets = (value: string) => {
  let next = value.slice(0, MAX_STRING_LENGTH)

  for (const pattern of SECRET_VALUE_PATTERNS) next = next.replace(pattern, "[redacted]")

  return next
}

export const sanitizePerformanceDiagnosticValue = (
  value: unknown,
  depth = 0,
): PerformanceDiagnosticValue => {
  if (depth >= MAX_DETAIL_DEPTH) return "[max-depth]"
  if (value === null || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value)
  if (typeof value === "string") return replaceSecrets(value)
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "undefined") return "[undefined]"
  if (typeof value === "function") return `[function ${value.name || "anonymous"}]`
  if (typeof value === "symbol") return value.toString()
  if (value instanceof Error) {
    return {
      name: value.name,
      message: replaceSecrets(value.message),
      stack: replaceSecrets(value.stack || ""),
    }
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_RECORDS)
      .map(item => sanitizePerformanceDiagnosticValue(item, depth + 1))
  }

  const result: Record<string, PerformanceDiagnosticValue> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(
    0,
    MAX_RECORDS,
  )) {
    result[key] = SECRET_KEY_PATTERN.test(key)
      ? "[redacted]"
      : sanitizePerformanceDiagnosticValue(item, depth + 1)
  }

  return result
}

const sortValue = (value: PerformanceDiagnosticValue): PerformanceDiagnosticValue => {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!value || typeof value !== "object") return value

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortValue(item)]),
  )
}

export const serializePerformanceDiagnostics = (snapshot: PerformanceDiagnosticsSnapshot) =>
  JSON.stringify(sortValue(snapshot as unknown as PerformanceDiagnosticValue))

const getRun = (runId: string) => runs.find(run => run.id === runId)

const getElapsed = (run: PerformanceDiagnosticRun) => {
  const clock = clockByRun.get(run.id) || defaultClock

  return {at: clock.now(), clock}
}

export const beginPerformanceDiagnosticsRun = ({
  route,
  preset = "custom",
  context,
  clock = defaultClock,
  id,
}: {
  route: string
  preset?: PerformanceDiagnosticRun["preset"]
  context?: unknown
  clock?: Clock
  id?: string
}) => {
  const startedAt = clock.now()
  const runId = id || `${clock.wallTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const run: PerformanceDiagnosticRun = {
    id: runId,
    route,
    preset,
    context: context === undefined ? undefined : sanitizePerformanceDiagnosticValue(context),
    startedAt,
    startedWallTime: clock.wallTime(),
    status: "running",
    milestones: [],
    records: [],
    longTasks: [],
    resources: [],
    scheduler: [],
    warnings: [],
  }

  boundedPush(runs, run, MAX_RUNS)
  clockByRun.set(runId, clock)
  for (const knownRunId of Array.from(clockByRun.keys())) {
    if (!runs.some(candidate => candidate.id === knownRunId)) clockByRun.delete(knownRunId)
  }
  notify()

  return runId
}

export const markPerformanceDiagnosticsMilestone = (
  runId: string,
  name: string,
  detail?: unknown,
) => {
  const run = getRun(runId)
  if (!run || run.status !== "running") return false
  const {at} = getElapsed(run)

  boundedPush(
    run.milestones,
    {
      name,
      at,
      elapsedMs: Math.max(0, at - run.startedAt),
      ...(detail === undefined ? {} : {detail: sanitizePerformanceDiagnosticValue(detail)}),
    },
    MAX_MILESTONES,
  )
  notify()
  return true
}

export const recordPerformanceDiagnostics = (
  runId: string,
  type: string,
  detail?: unknown,
  target: "records" | "longTasks" | "resources" | "scheduler" | "warnings" = "records",
) => {
  const run = getRun(runId)
  if (!run || run.status !== "running") return false
  const {at} = getElapsed(run)
  const limits = {
    records: MAX_RECORDS,
    longTasks: MAX_LONG_TASKS,
    resources: MAX_RESOURCES,
    scheduler: MAX_SCHEDULER_SNAPSHOTS,
    warnings: MAX_WARNINGS,
  }

  boundedPush(
    run[target],
    {
      type,
      at,
      elapsedMs: Math.max(0, at - run.startedAt),
      ...(detail === undefined ? {} : {detail: sanitizePerformanceDiagnosticValue(detail)}),
    },
    limits[target],
  )
  notify()
  return true
}

export const finishPerformanceDiagnosticsRun = (
  runId: string,
  status: Exclude<PerformanceDiagnosticRun["status"], "running"> = "complete",
) => {
  const run = getRun(runId)
  if (!run || run.status !== "running") return false
  const {at} = getElapsed(run)

  run.status = status
  run.finishedAt = at
  run.durationMs = Math.max(0, at - run.startedAt)
  clockByRun.delete(runId)
  notify()
  return true
}

const getEnvironment = (): PerformanceDiagnosticsSnapshot["environment"] => {
  if (typeof window === "undefined") {
    return {
      href: "",
      userAgent: "",
      language: "",
      viewport: {width: 0, height: 0, devicePixelRatio: 1},
      hardwareConcurrency: 0,
      serviceWorkerControlled: false,
    }
  }

  const nav = navigator as Navigator & {deviceMemory?: number}

  return {
    href: window.location.href,
    userAgent: navigator.userAgent,
    language: navigator.language,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    hardwareConcurrency: navigator.hardwareConcurrency || 0,
    ...(nav.deviceMemory === undefined ? {} : {deviceMemory: nav.deviceMemory}),
    serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
  }
}

export const getPerformanceDiagnosticsSnapshot = (): PerformanceDiagnosticsSnapshot =>
  structuredClone({
    schemaVersion: PERFORMANCE_DIAGNOSTICS_SCHEMA_VERSION,
    generatedAt: Date.now(),
    build: {id: APP_BUILD_ID, hash: APP_BUILD_HASH},
    environment: getEnvironment(),
    runs,
  })

export const clearPerformanceDiagnostics = () => {
  runs = []
  clockByRun.clear()
  notify()
}

export const startPerformanceDiagnosticsObservers = (
  runId: string,
  {schedulerIntervalMs = 250}: {schedulerIntervalMs?: number} = {},
) => {
  if (typeof window === "undefined" || !getRun(runId)) return () => {}
  const observers: PerformanceObserver[] = []

  if (typeof PerformanceObserver !== "undefined") {
    try {
      const longTaskObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          recordPerformanceDiagnostics(
            runId,
            "long-task",
            {name: entry.name, startTime: entry.startTime, duration: entry.duration},
            "longTasks",
          )
        }
      })
      longTaskObserver.observe({type: "longtask", buffered: true} as PerformanceObserverInit)
      observers.push(longTaskObserver)
    } catch {
      // Long Task API is not available in every browser.
    }

    try {
      const resourceObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          const resource = entry as PerformanceResourceTiming
          recordPerformanceDiagnostics(
            runId,
            "resource",
            {
              name: resource.name,
              initiatorType: resource.initiatorType,
              startTime: resource.startTime,
              duration: resource.duration,
              transferSize: resource.transferSize,
              encodedBodySize: resource.encodedBodySize,
              decodedBodySize: resource.decodedBodySize,
            },
            "resources",
          )
        }
      })
      resourceObserver.observe({type: "resource", buffered: true} as PerformanceObserverInit)
      observers.push(resourceObserver)
    } catch {
      // Resource Timing observation is best effort.
    }
  }

  const schedulerInterval = window.setInterval(
    () => {
      recordPerformanceDiagnostics(runId, "relay-scheduler", readRelayDiagnostics(), "scheduler")
    },
    Math.max(100, schedulerIntervalMs),
  )
  const onError = (event: ErrorEvent) =>
    recordPerformanceDiagnostics(
      runId,
      "window-error",
      {message: event.message, filename: event.filename, lineno: event.lineno, error: event.error},
      "warnings",
    )
  const onRejection = (event: PromiseRejectionEvent) =>
    recordPerformanceDiagnostics(runId, "unhandled-rejection", {reason: event.reason}, "warnings")

  window.addEventListener("error", onError)
  window.addEventListener("unhandledrejection", onRejection)

  return () => {
    observers.forEach(observer => observer.disconnect())
    window.clearInterval(schedulerInterval)
    window.removeEventListener("error", onError)
    window.removeEventListener("unhandledrejection", onRejection)
  }
}

const defaultCompress = async (bytes: Uint8Array) => {
  if (typeof CompressionStream === "undefined") return
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"))

  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const defaultHash = async (bytes: Uint8Array) => {
  const hash = await crypto.subtle.digest("SHA-256", bytes as BufferSource)

  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("")
}

export const preparePerformanceDiagnosticsArtifact = async (
  snapshot: PerformanceDiagnosticsSnapshot,
  {compress = defaultCompress, hash = defaultHash, runId}: PrepareOptions = {},
): Promise<PreparedPerformanceDiagnosticsArtifact> => {
  const serialized = serializePerformanceDiagnostics(snapshot)
  const sourceBytes = new TextEncoder().encode(serialized)
  const compressed = await compress(sourceBytes)
  const bytes = compressed?.length ? compressed : sourceBytes
  const encoding = compressed?.length ? "gzip" : "identity"
  const artifactId = runId || snapshot.runs.at(-1)?.id || String(snapshot.generatedAt)

  return {
    schemaVersion: PERFORMANCE_DIAGNOSTICS_SCHEMA_VERSION,
    filename: `budabit-performance-${artifactId}.json${encoding === "gzip" ? ".gz" : ""}`,
    encoding,
    contentType: encoding === "gzip" ? "application/gzip" : "application/json",
    bytes,
    sha256: await hash(bytes),
    uncompressedBytes: sourceBytes.length,
  }
}
