import {last, stripProtocol} from "@welshman/lib"

// Constants and types

export enum RelayMode {
  Read = "read",
  Write = "write",
  Search = "search",
  Blocked = "blocked",
  Messaging = "messaging",
}

export type RelayProfile = {
  url: string
  icon?: string
  banner?: string
  name?: string
  self?: string
  pubkey?: string
  contact?: string
  software?: string
  version?: string
  negentropy?: number
  description?: string
  supported_nips?: string[]
  privacy_policy?: string
  terms_of_service?: string
  limitation?: {
    min_pow_difficulty?: number
    payment_required?: boolean
    auth_required?: boolean
  }
}

// Utils related to bare urls

export const LOCAL_RELAY_URL = "local://welshman.relay/"

export const isRelayUrl = (url: unknown): url is string => {
  if (typeof url !== "string") return false

  const relayUrl = url.includes("://") ? url : "wss://" + url

  let parsed: URL
  try {
    parsed = new URL(relayUrl)
  } catch (e) {
    return false
  }

  // Skip non-ws urls
  if (!parsed.protocol.match(/^wss?:$/)) return false

  // Host is required (rejects local file paths like /home/foo/bar.png)
  if (!parsed.hostname) return false

  // Relay credentials are not part of the supported transport identity contract
  if (parsed.username || parsed.password) return false

  // Skip non-localhost hosts without a dot (checks host, not path)
  if (!parsed.hostname.includes(".") && parsed.hostname !== "localhost") return false

  return true
}

export const isOnionUrl = (url: string) => Boolean(stripProtocol(url).match(/^[a-z2-7]{56}.onion/))

export const isLocalUrl = (url: string) =>
  Boolean(url.match(/\.local(:[\d]+)?\/?$/) || stripProtocol(url).match(/^localhost:/))

export const isIPAddress = (url: string) => Boolean(url.match(/\d+\.\d+\.\d+\.\d+/))

export const isShareableRelayUrl = (url: string) => Boolean(isRelayUrl(url) && !isLocalUrl(url))

export type RelayNormalizationObservation = {
  source: "welshman.normalizeRelayUrl"
  outcome: "normalized" | "rejected"
  classification: "equivalent-spelling" | "invalid"
  changed: boolean
  inputShape: {
    hadProtocol: boolean
    hadCredentials: boolean
    hadQuery: boolean
    hadFragment: boolean
    hadTrailingSlash: boolean
    hadUppercase: boolean
  }
  inputEndpoint: string
  canonicalEndpoint?: string
}

const relayNormalizationListeners = new Set<(event: RelayNormalizationObservation) => void>()

export const subscribeRelayNormalization = (
  listener: (event: RelayNormalizationObservation) => void,
) => {
  relayNormalizationListeners.add(listener)
  return () => relayNormalizationListeners.delete(listener)
}

const getSafeRelayEndpoint = (value: string) => {
  try {
    const candidate = value.includes("://") ? value : `wss://${value}`
    const parsed = new URL(candidate)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname || "/"}`
  } catch {
    return "[invalid-relay]"
  }
}

const getRelayInputShape = (value: string) => {
  let hadCredentials = false
  try {
    const parsed = new URL(value.includes("://") ? value : `wss://${value}`)
    hadCredentials = Boolean(parsed.username || parsed.password)
  } catch {
    hadCredentials = /\/\/[^/\s]*@/.test(value)
  }

  return {
    hadProtocol: /^wss?:\/\//i.test(value),
    hadCredentials,
    hadQuery: value.includes("?"),
    hadFragment: value.includes("#"),
    hadTrailingSlash: value.endsWith("/"),
    hadUppercase: value !== value.toLowerCase(),
  }
}

const emitRelayNormalization = (event: RelayNormalizationObservation) => {
  for (const listener of relayNormalizationListeners) {
    try {
      listener(event)
    } catch {
      // Diagnostics must never affect relay normalization.
    }
  }
}

export const normalizeRelayUrl = (url: string) => {
  if (url === LOCAL_RELAY_URL) return url

  const original = url
  const inputShape = getRelayInputShape(original)

  try {
    if (typeof url !== "string" || !url) throw new TypeError("Invalid relay URL")

    const schemeMatch = url.match(/^([a-z][a-z\d+.-]*):\/\//i)
    const candidate = schemeMatch ? url : `${isOnionUrl(url.toLowerCase()) ? "ws" : "wss"}://${url}`
    const parsed = new URL(candidate)

    if (
      !/^wss?:$/.test(parsed.protocol) ||
      !parsed.hostname ||
      (!parsed.hostname.includes(".") && parsed.hostname !== "localhost") ||
      parsed.username ||
      parsed.password
    ) {
      throw new TypeError("Invalid relay URL")
    }

    // URL canonicalizes the scheme, hostname, and default port. Preserve the
    // caller's path and query byte-for-byte because they may identify distinct endpoints.
    const rawAfterScheme = candidate.slice(candidate.indexOf("://") + 3)
    const suffixStart = rawAfterScheme.search(/[/?#]/)
    const rawSuffix = suffixStart === -1 ? "" : rawAfterScheme.slice(suffixStart)
    const suffixWithoutFragment = rawSuffix.split("#", 1)[0]
    const pathAndQuery =
      !suffixWithoutFragment || suffixWithoutFragment.startsWith("?")
        ? `/${suffixWithoutFragment}`
        : suffixWithoutFragment
    const normalized = `${parsed.protocol}//${parsed.host}${pathAndQuery}`
    if (normalized !== original) {
      emitRelayNormalization({
        source: "welshman.normalizeRelayUrl",
        outcome: "normalized",
        classification: "equivalent-spelling",
        changed: true,
        inputShape,
        inputEndpoint: getSafeRelayEndpoint(original),
        canonicalEndpoint: getSafeRelayEndpoint(normalized),
      })
    }
    return normalized
  } catch (error) {
    emitRelayNormalization({
      source: "welshman.normalizeRelayUrl",
      outcome: "rejected",
      classification: "invalid",
      changed: false,
      inputShape,
      inputEndpoint: getSafeRelayEndpoint(original),
    })
    throw error
  }
}

export const sanitizeRelayUrls = (urls: Iterable<unknown>): string[] => {
  const relays: string[] = []
  const seen = new Set<string>()

  for (const value of urls) {
    if (typeof value !== "string" || !isRelayUrl(value)) continue

    try {
      const relay = normalizeRelayUrl(value)
      if (!seen.has(relay)) {
        seen.add(relay)
        relays.push(relay)
      }
    } catch {
      // Invalid collection entries are omitted rather than invalidating the collection.
    }
  }

  return relays
}

export const displayRelayUrl = (url: string) => last(url.split("://")).replace(/\/$/, "")

export const displayRelayProfile = (profile?: RelayProfile, fallback = "") =>
  profile?.name || fallback
