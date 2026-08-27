import {get, writable} from "svelte/store"
import {APP_BUILD_HASH, APP_BUILD_ID} from "@app/core/build-info"

export const DEBUG_DIAGNOSTICS_SCHEMA_VERSION = 1
export const DEBUG_DIAGNOSTICS_SCHEMA = "budabit-debug-run-v1"
export const DEBUG_DIAGNOSTICS_SETTINGS_STORAGE_KEY = "budabit/debug-diagnostics/settings:v1"
export const DEBUG_DIAGNOSTICS_DEFAULT_BLOSSOM = "https://blossom.budabit.club"
export const DEBUG_DIAGNOSTICS_DEFAULT_RELAY = "wss://relay.budabit.club"

export const DEBUG_DIAGNOSTIC_CATEGORIES = [
  "relay-normalization",
  "relay-scheduler",
  "publication-lifecycle",
] as const

export const DEBUG_DIAGNOSTIC_PRESET_IDS = ["quick", "standard", "extended"] as const
export type DebugDiagnosticPreset = (typeof DEBUG_DIAGNOSTIC_PRESET_IDS)[number]
export const DEBUG_DIAGNOSTIC_PRESETS: Record<
  DebugDiagnosticPreset,
  {label: string; maxRecords: number; maxRecordsPerCategory: number}
> = {
  quick: {label: "Quick", maxRecords: 1_000, maxRecordsPerCategory: 500},
  standard: {label: "Standard", maxRecords: 5_000, maxRecordsPerCategory: 2_500},
  extended: {label: "Extended", maxRecords: 20_000, maxRecordsPerCategory: 10_000},
}

export type DebugDiagnosticCategory = (typeof DEBUG_DIAGNOSTIC_CATEGORIES)[number]
export type DebugDiagnosticValue =
  | null
  | boolean
  | number
  | string
  | DebugDiagnosticValue[]
  | {[key: string]: DebugDiagnosticValue}

export type DebugDiagnosticRecord = {
  category: DebugDiagnosticCategory
  type: string
  at: number
  elapsedMs: number
  detail?: DebugDiagnosticValue
}

export type DebugDiagnosticsSettings = {
  version: 1
  preset: DebugDiagnosticPreset
  categories: Record<DebugDiagnosticCategory, boolean>
}

export type DebugDiagnosticsSnapshot = {
  schema: typeof DEBUG_DIAGNOSTICS_SCHEMA
  schemaVersion: typeof DEBUG_DIAGNOSTICS_SCHEMA_VERSION
  generatedAt: number
  build: {id: string; hash: string}
  environment: {
    origin: string
    pathname: string
    userAgent: string
    language: string
  }
  capture: {
    id: string
    startedAt: number
    finishedAt?: number
    active: boolean
    preset: DebugDiagnosticPreset
    limits: {maxRecords: number; maxRecordsPerCategory: number}
    enabledCategories: DebugDiagnosticCategory[]
  }
  records: DebugDiagnosticRecord[]
}

export type PreparedDebugDiagnosticsArtifact = {
  schemaVersion: 1
  filename: string
  encoding: "gzip" | "identity"
  contentType: "application/gzip" | "application/json"
  bytes: Uint8Array
  sha256: string
  uncompressedBytes: number
}

const MAX_DETAIL_DEPTH = 8
const MAX_STRING_LENGTH = 20_000
const SECRET_KEY_PATTERN =
  /^(authorization|cookie|private[-_]?key|secret|token|password|signer|sig|content|tags|bunker|nostrconnect|nsec)$/i
const SECRET_VALUE_PATTERNS = [
  /nsec1[023456789acdefghjklmnpqrstuvwxyz]{20,}/gi,
  /ncryptsec1[023456789acdefghjklmnpqrstuvwxyz]{20,}/gi,
  /bunker:\/\/[^\s"']+/gi,
  /nostrconnect:\/\/[^\s"']+/gi,
  /Authorization:\s*(?:Nostr|Bearer)\s+[^\s"']+/gi,
]

export const defaultDebugDiagnosticsSettings = (): DebugDiagnosticsSettings => ({
  version: 1,
  preset: "standard",
  categories: {
    "relay-normalization": false,
    "relay-scheduler": false,
    "publication-lifecycle": false,
  },
})

const redactUrlSecrets = (value: string) =>
  value.replace(/\b(wss?:\/\/)([^\s/]+)([^\s]*)/gi, (_match, protocol, authority, suffix) => {
    let host = authority
    try {
      host = new URL(`${protocol}${authority}`).host
    } catch {
      host = authority.includes("@") ? authority.slice(authority.lastIndexOf("@") + 1) : authority
    }
    const safeSuffix = String(suffix)
      .replace(/\?.*?(?=[\s"']|$)/, "?[redacted]")
      .replace(/#.*$/, "")
    return `${protocol}${host}${safeSuffix}`
  })

const sanitizeString = (value: string) => {
  let next = redactUrlSecrets(value.slice(0, MAX_STRING_LENGTH))
  for (const pattern of SECRET_VALUE_PATTERNS) next = next.replace(pattern, "[redacted]")
  return next
}

export const sanitizeDebugDiagnosticValue = (value: unknown, depth = 0): DebugDiagnosticValue => {
  if (depth >= MAX_DETAIL_DEPTH) return "[max-depth]"
  if (value === null || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value)
  if (typeof value === "string") return sanitizeString(value)
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "undefined") return "[undefined]"
  if (typeof value === "function") return `[function ${value.name || "anonymous"}]`
  if (typeof value === "symbol") return value.toString()
  if (value instanceof Error) {
    return {name: value.name, message: sanitizeString(value.message)}
  }
  if (Array.isArray(value)) {
    return value.slice(0, 200).map(item => sanitizeDebugDiagnosticValue(item, depth + 1))
  }
  if (typeof value === "object") {
    const result: {[key: string]: DebugDiagnosticValue} = {}
    for (const [key, item] of Object.entries(value).slice(0, 200)) {
      result[key] = SECRET_KEY_PATTERN.test(key)
        ? "[redacted]"
        : sanitizeDebugDiagnosticValue(item, depth + 1)
    }
    return result
  }
  return sanitizeString(String(value))
}

const sortDebugDiagnosticValue = (value: DebugDiagnosticValue): DebugDiagnosticValue => {
  if (Array.isArray(value)) return value.map(sortDebugDiagnosticValue)
  if (!value || typeof value !== "object") return value

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortDebugDiagnosticValue(item)]),
  )
}

export const serializeDebugDiagnostics = (snapshot: DebugDiagnosticsSnapshot) =>
  JSON.stringify(sortDebugDiagnosticValue(sanitizeDebugDiagnosticValue(snapshot)))

const getDebugDiagnosticsEnvironment = (): DebugDiagnosticsSnapshot["environment"] => {
  if (typeof window === "undefined") {
    return {origin: "", pathname: "", userAgent: "", language: ""}
  }

  return {
    origin: window.location.origin,
    pathname: window.location.pathname,
    userAgent: navigator.userAgent,
    language: navigator.language,
  }
}

export const normalizeDebugDiagnosticsSettings = (value: unknown): DebugDiagnosticsSettings => {
  const defaults = defaultDebugDiagnosticsSettings()
  if (!value || typeof value !== "object" || (value as {version?: unknown}).version !== 1) {
    return defaults
  }
  const categories = (value as {categories?: unknown}).categories
  if (!categories || typeof categories !== "object" || Array.isArray(categories)) return defaults

  return {
    version: 1,
    preset: DEBUG_DIAGNOSTIC_PRESET_IDS.includes(
      (value as {preset?: DebugDiagnosticPreset}).preset as DebugDiagnosticPreset,
    )
      ? (value as {preset: DebugDiagnosticPreset}).preset
      : defaults.preset,
    categories: Object.fromEntries(
      DEBUG_DIAGNOSTIC_CATEGORIES.map(category => [
        category,
        (categories as Record<string, unknown>)[category] === true,
      ]),
    ) as Record<DebugDiagnosticCategory, boolean>,
  }
}

type RecorderOptions = {
  now?: () => number
  maxRecords?: number
  maxRecordsPerCategory?: number
}

export const createDebugDiagnosticsRecorder = ({
  now = Date.now,
  maxRecords,
  maxRecordsPerCategory,
}: RecorderOptions = {}) => {
  const settings = writable(defaultDebugDiagnosticsSettings())
  const active = writable(false)
  const revision = writable(0)
  let captureId = ""
  let startedAt = 0
  let finishedAt: number | undefined
  let records: DebugDiagnosticRecord[] = []
  let counts = Object.fromEntries(
    DEBUG_DIAGNOSTIC_CATEGORIES.map(category => [category, 0]),
  ) as Record<DebugDiagnosticCategory, number>

  const notify = () => revision.update(value => value + 1)
  const getLimits = () => {
    const preset = DEBUG_DIAGNOSTIC_PRESETS[get(settings).preset]
    return {
      maxRecords: maxRecords ?? preset.maxRecords,
      maxRecordsPerCategory: maxRecordsPerCategory ?? preset.maxRecordsPerCategory,
    }
  }
  const trimRecords = () => {
    const limits = getLimits()
    for (const category of DEBUG_DIAGNOSTIC_CATEGORIES) {
      let excess =
        records.filter(record => record.category === category).length - limits.maxRecordsPerCategory
      if (excess <= 0) continue
      records = records.filter(record => {
        if (record.category !== category || excess <= 0) return true
        excess -= 1
        return false
      })
    }
    if (records.length > limits.maxRecords) records = records.slice(-limits.maxRecords)
    counts = Object.fromEntries(
      DEBUG_DIAGNOSTIC_CATEGORIES.map(category => [
        category,
        records.filter(record => record.category === category).length,
      ]),
    ) as Record<DebugDiagnosticCategory, number>
  }
  const setSettings = (value: unknown) => {
    const normalized = normalizeDebugDiagnosticsSettings(value)
    settings.set(normalized)
    trimRecords()
    notify()
    return normalized
  }
  const setCategoryEnabled = (category: DebugDiagnosticCategory, enabled: boolean) => {
    settings.update(current => ({
      ...current,
      categories: {...current.categories, [category]: enabled},
    }))
  }
  const setPreset = (preset: DebugDiagnosticPreset) => {
    settings.update(current => ({...current, preset}))
    trimRecords()
    notify()
  }
  const isCategoryEnabled = (category: DebugDiagnosticCategory) =>
    get(settings).categories[category]
  const start = (id = `debug-${now().toString(36)}`) => {
    records = []
    counts = Object.fromEntries(
      DEBUG_DIAGNOSTIC_CATEGORIES.map(category => [category, 0]),
    ) as Record<DebugDiagnosticCategory, number>
    captureId = id
    startedAt = now()
    finishedAt = undefined
    active.set(true)
    notify()
    return id
  }
  const stop = () => {
    if (!get(active)) return false
    finishedAt = now()
    active.set(false)
    notify()
    return true
  }
  const clear = () => {
    records = []
    counts = Object.fromEntries(
      DEBUG_DIAGNOSTIC_CATEGORIES.map(category => [category, 0]),
    ) as Record<DebugDiagnosticCategory, number>
    captureId = ""
    startedAt = 0
    finishedAt = undefined
    active.set(false)
    notify()
  }
  const record = (category: DebugDiagnosticCategory, type: string, detail?: unknown) => {
    if (!get(active) || !isCategoryEnabled(category)) return false
    const at = now()
    const record: DebugDiagnosticRecord = {
      category,
      type: sanitizeString(type),
      at,
      elapsedMs: Math.max(0, at - startedAt),
      ...(detail === undefined ? {} : {detail: sanitizeDebugDiagnosticValue(detail)}),
    }
    records.push(record)
    counts[category] += 1
    const limits = getLimits()
    if (counts[category] > limits.maxRecordsPerCategory) {
      const oldestCategoryRecord = records.findIndex(candidate => candidate.category === category)
      if (oldestCategoryRecord >= 0) records.splice(oldestCategoryRecord, 1)
      counts[category] -= 1
    }
    if (records.length > limits.maxRecords) {
      const removed = records.shift()
      if (removed) counts[removed.category] -= 1
    }
    notify()
    return true
  }
  const snapshot = (): DebugDiagnosticsSnapshot => {
    const currentSettings = get(settings)
    const limits = getLimits()
    return structuredClone({
      schema: DEBUG_DIAGNOSTICS_SCHEMA,
      schemaVersion: DEBUG_DIAGNOSTICS_SCHEMA_VERSION,
      generatedAt: now(),
      build: {id: APP_BUILD_ID, hash: APP_BUILD_HASH},
      environment: getDebugDiagnosticsEnvironment(),
      capture: {
        id: captureId,
        startedAt,
        ...(finishedAt === undefined ? {} : {finishedAt}),
        active: get(active),
        preset: currentSettings.preset,
        limits,
        enabledCategories: DEBUG_DIAGNOSTIC_CATEGORIES.filter(
          category => currentSettings.categories[category],
        ),
      },
      records,
    })
  }
  const overview = () => {
    const currentSettings = get(settings)
    return {
      captureId,
      active: get(active),
      startedAt,
      finishedAt,
      recordCount: records.length,
      preset: currentSettings.preset,
      limits: getLimits(),
      counts: {...counts},
    }
  }

  return {
    settings,
    active,
    revision,
    setSettings,
    setCategoryEnabled,
    setPreset,
    isCategoryEnabled,
    start,
    stop,
    clear,
    record,
    snapshot,
    overview,
  }
}

const recorder = createDebugDiagnosticsRecorder()

export const debugDiagnosticsSettings = recorder.settings
export const debugDiagnosticsActive = recorder.active
export const debugDiagnosticsRevision = recorder.revision
export const startDebugDiagnosticsCapture = recorder.start
export const stopDebugDiagnosticsCapture = recorder.stop
export const clearDebugDiagnostics = recorder.clear
export const recordDebugDiagnostic = recorder.record
export const getDebugDiagnosticsSnapshot = recorder.snapshot
export const getDebugDiagnosticsOverview = recorder.overview
export const isDebugDiagnosticCategoryEnabled = recorder.isCategoryEnabled

export const refreshDebugDiagnosticsSettings = () => {
  if (typeof localStorage === "undefined") return get(debugDiagnosticsSettings)
  try {
    return recorder.setSettings(
      JSON.parse(localStorage.getItem(DEBUG_DIAGNOSTICS_SETTINGS_STORAGE_KEY) || "null"),
    )
  } catch {
    localStorage.removeItem(DEBUG_DIAGNOSTICS_SETTINGS_STORAGE_KEY)
    return recorder.setSettings(null)
  }
}

export const setDebugDiagnosticCategoryEnabled = (
  category: DebugDiagnosticCategory,
  enabled: boolean,
) => {
  recorder.setCategoryEnabled(category, enabled)
  const settings = get(debugDiagnosticsSettings)
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(DEBUG_DIAGNOSTICS_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  }
  return settings
}

export const setDebugDiagnosticsPreset = (preset: DebugDiagnosticPreset) => {
  recorder.setPreset(preset)
  const settings = get(debugDiagnosticsSettings)
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(DEBUG_DIAGNOSTICS_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  }
  return settings
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

export const prepareDebugDiagnosticsArtifact = async (
  snapshot: DebugDiagnosticsSnapshot,
  {
    compress = defaultCompress,
    hash = defaultHash,
    runId,
  }: {
    compress?: (bytes: Uint8Array) => Promise<Uint8Array | undefined>
    hash?: (bytes: Uint8Array) => Promise<string>
    runId?: string
  } = {},
): Promise<PreparedDebugDiagnosticsArtifact> => {
  const serialized = serializeDebugDiagnostics(snapshot)
  const sourceBytes = new TextEncoder().encode(serialized)
  const compressed = await compress(sourceBytes)
  const bytes = compressed?.length ? compressed : sourceBytes
  const encoding = compressed?.length ? "gzip" : "identity"
  const artifactId = (runId || snapshot.capture.id || String(snapshot.generatedAt)).replace(
    /[^a-z0-9._-]/gi,
    "-",
  )

  return {
    schemaVersion: DEBUG_DIAGNOSTICS_SCHEMA_VERSION,
    filename: `budabit-debug-${artifactId}.json${encoding === "gzip" ? ".gz" : ""}`,
    encoding,
    contentType: encoding === "gzip" ? "application/gzip" : "application/json",
    bytes,
    sha256: await hash(bytes),
    uncompressedBytes: sourceBytes.length,
  }
}
