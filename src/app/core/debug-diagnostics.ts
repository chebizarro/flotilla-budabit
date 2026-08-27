import {get, writable} from "svelte/store"
import {APP_BUILD_HASH, APP_BUILD_ID} from "@app/core/build-info"

export const DEBUG_DIAGNOSTICS_SCHEMA_VERSION = 1
export const DEBUG_DIAGNOSTICS_SCHEMA = "budabit-debug-run-v1"
export const DEBUG_DIAGNOSTICS_SETTINGS_STORAGE_KEY = "budabit/debug-diagnostics/settings:v1"

export const DEBUG_DIAGNOSTIC_CATEGORIES = [
  "relay-normalization",
  "relay-scheduler",
  "publication-lifecycle",
] as const

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
  categories: Record<DebugDiagnosticCategory, boolean>
}

export type DebugDiagnosticsSnapshot = {
  schema: typeof DEBUG_DIAGNOSTICS_SCHEMA
  schemaVersion: typeof DEBUG_DIAGNOSTICS_SCHEMA_VERSION
  generatedAt: number
  build: {id: string; hash: string}
  capture: {
    id: string
    startedAt: number
    finishedAt?: number
    active: boolean
    enabledCategories: DebugDiagnosticCategory[]
  }
  records: DebugDiagnosticRecord[]
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

export const normalizeDebugDiagnosticsSettings = (value: unknown): DebugDiagnosticsSettings => {
  const defaults = defaultDebugDiagnosticsSettings()
  if (!value || typeof value !== "object" || (value as {version?: unknown}).version !== 1) {
    return defaults
  }
  const categories = (value as {categories?: unknown}).categories
  if (!categories || typeof categories !== "object" || Array.isArray(categories)) return defaults

  return {
    version: 1,
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
  maxRecords = 1_000,
  maxRecordsPerCategory = 500,
}: RecorderOptions = {}) => {
  const settings = writable(defaultDebugDiagnosticsSettings())
  const active = writable(false)
  const revision = writable(0)
  let captureId = ""
  let startedAt = 0
  let finishedAt: number | undefined
  let records: DebugDiagnosticRecord[] = []

  const notify = () => revision.update(value => value + 1)
  const setSettings = (value: unknown) => {
    const normalized = normalizeDebugDiagnosticsSettings(value)
    settings.set(normalized)
    return normalized
  }
  const setCategoryEnabled = (category: DebugDiagnosticCategory, enabled: boolean) => {
    settings.update(current => ({
      version: 1,
      categories: {...current.categories, [category]: enabled},
    }))
  }
  const isCategoryEnabled = (category: DebugDiagnosticCategory) =>
    get(settings).categories[category]
  const start = (id = `debug-${now().toString(36)}`) => {
    records = []
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

    const categoryIndexes = records.flatMap((candidate, index) =>
      candidate.category === category ? [index] : [],
    )
    if (categoryIndexes.length > maxRecordsPerCategory) {
      records.splice(categoryIndexes[0], categoryIndexes.length - maxRecordsPerCategory)
    }
    if (records.length > maxRecords) records.splice(0, records.length - maxRecords)
    notify()
    return true
  }
  const snapshot = (): DebugDiagnosticsSnapshot => {
    const currentSettings = get(settings)
    return structuredClone({
      schema: DEBUG_DIAGNOSTICS_SCHEMA,
      schemaVersion: DEBUG_DIAGNOSTICS_SCHEMA_VERSION,
      generatedAt: now(),
      build: {id: APP_BUILD_ID, hash: APP_BUILD_HASH},
      capture: {
        id: captureId,
        startedAt,
        ...(finishedAt === undefined ? {} : {finishedAt}),
        active: get(active),
        enabledCategories: DEBUG_DIAGNOSTIC_CATEGORIES.filter(
          category => currentSettings.categories[category],
        ),
      },
      records,
    })
  }
  const overview = () => {
    const counts = Object.fromEntries(
      DEBUG_DIAGNOSTIC_CATEGORIES.map(category => [
        category,
        records.filter(record => record.category === category).length,
      ]),
    ) as Record<DebugDiagnosticCategory, number>
    return {
      captureId,
      active: get(active),
      startedAt,
      finishedAt,
      recordCount: records.length,
      counts,
    }
  }

  return {
    settings,
    active,
    revision,
    setSettings,
    setCategoryEnabled,
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
