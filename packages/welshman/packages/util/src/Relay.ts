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
  outcome: "unchanged" | "normalized" | "rejected"
  classification: "canonical" | "equivalent-spelling" | "invalid"
  changed: boolean
  inputType: string
  inputShape: {
    hadProtocol: boolean
    hadCredentials: boolean
    hadQuery: boolean
    hadFragment: boolean
    hadTrailingSlash: boolean
    pathHadUppercase: boolean
    queryHadUppercase: boolean
  }
  reasons: {
    schemeCaseChanged: boolean
    hostnameCaseChanged: boolean
    defaultPortRemoved: boolean
    rootSlashAdded: boolean
    fragmentRemoved: boolean
  }
  inputEndpoint: string
  canonicalEndpoint?: string
}

export type RelayNormalizationContext = {
  inputPath: string
  canonicalPath?: string
}

type RelayNormalizationListener = (
  event: RelayNormalizationObservation,
  context: RelayNormalizationContext,
) => void

const relayNormalizationListeners = new Set<RelayNormalizationListener>()

export const subscribeRelayNormalization = (listener: RelayNormalizationListener) => {
  relayNormalizationListeners.add(listener)
  return () => relayNormalizationListeners.delete(listener)
}

const getRelayParts = (value: unknown) => {
  try {
    if (typeof value !== "string") throw new TypeError("Invalid relay URL")
    const candidate = value.includes("://") ? value : `wss://${value}`
    const parsed = new URL(candidate)
    const authority = candidate.slice(candidate.indexOf("://") + 3).split(/[/?#]/, 1)[0]
    const afterAuthority = candidate.slice(candidate.indexOf("://") + 3 + authority.length)
    const rawPath = afterAuthority.split(/[?#]/, 1)[0]
    const rawHost = authority.slice(authority.lastIndexOf("@") + 1)
    const rawHostname = rawHost.startsWith("[")
      ? rawHost.slice(0, rawHost.indexOf("]") + 1)
      : rawHost.split(":", 1)[0]
    return {
      endpoint: `${parsed.protocol}//${parsed.host}`,
      path: rawPath || "/",
      scheme: candidate.slice(0, candidate.indexOf(":")),
      hostname: rawHostname,
      explicitPort: candidate.match(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*:(\d+)/i)?.[1],
    }
  } catch {
    return {endpoint: "[invalid-relay]", path: ""}
  }
}

const getRelayInputShape = (value: unknown) => {
  if (typeof value !== "string") {
    return {
      hadProtocol: false,
      hadCredentials: false,
      hadQuery: false,
      hadFragment: false,
      hadTrailingSlash: false,
      pathHadUppercase: false,
      queryHadUppercase: false,
    }
  }

  let hadCredentials = false
  try {
    const parsed = new URL(value.includes("://") ? value : `wss://${value}`)
    hadCredentials = Boolean(parsed.username || parsed.password)
  } catch {
    hadCredentials = /\/\/[^/\s]*@/.test(value)
  }

  const withoutFragment = value.split("#", 1)[0]
  const queryStart = withoutFragment.indexOf("?")
  const beforeQuery = queryStart === -1 ? withoutFragment : withoutFragment.slice(0, queryStart)
  const pathStart = beforeQuery.indexOf("/", beforeQuery.indexOf("://") + 3)
  const path = pathStart === -1 ? "" : beforeQuery.slice(pathStart)
  const query = queryStart === -1 ? "" : withoutFragment.slice(queryStart + 1)

  return {
    hadProtocol: /^wss?:\/\//i.test(value),
    hadCredentials,
    hadQuery: value.includes("?"),
    hadFragment: value.includes("#"),
    hadTrailingSlash: value.endsWith("/"),
    pathHadUppercase: path !== path.toLowerCase(),
    queryHadUppercase: query !== query.toLowerCase(),
  }
}

const emitRelayNormalization = (
  event: RelayNormalizationObservation,
  context: RelayNormalizationContext,
) => {
  for (const listener of relayNormalizationListeners) {
    try {
      listener(event, context)
    } catch {
      // Diagnostics must never affect relay normalization.
    }
  }
}

export const normalizeRelayUrl = (url: string) => {
  if (url === LOCAL_RELAY_URL) return url

  const original: unknown = url
  const inputShape = getRelayInputShape(original)
  const inputParts = getRelayParts(original)

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
    if (relayNormalizationListeners.size > 0) {
      const canonicalParts = getRelayParts(normalized)
      const changed = normalized !== original
      const originalScheme = schemeMatch?.[1]
      const reasons = {
        schemeCaseChanged: Boolean(
          originalScheme && originalScheme !== parsed.protocol.slice(0, -1),
        ),
        hostnameCaseChanged:
          inputParts.hostname !== undefined && inputParts.hostname !== parsed.hostname,
        defaultPortRemoved:
          (parsed.protocol === "wss:" && inputParts.explicitPort === "443") ||
          (parsed.protocol === "ws:" && inputParts.explicitPort === "80"),
        rootSlashAdded: !rawSuffix || rawSuffix.startsWith("?") || rawSuffix.startsWith("#"),
        fragmentRemoved: inputShape.hadFragment,
      }
      emitRelayNormalization(
        {
          source: "welshman.normalizeRelayUrl",
          outcome: changed ? "normalized" : "unchanged",
          classification: changed ? "equivalent-spelling" : "canonical",
          changed,
          inputType: typeof original,
          inputShape,
          reasons,
          inputEndpoint: inputParts.endpoint,
          canonicalEndpoint: canonicalParts.endpoint,
        },
        {
          inputPath: inputParts.path,
          canonicalPath: canonicalParts.path,
        },
      )
    }
    return normalized
  } catch (error) {
    if (relayNormalizationListeners.size > 0) {
      emitRelayNormalization(
        {
          source: "welshman.normalizeRelayUrl",
          outcome: "rejected",
          classification: "invalid",
          changed: false,
          inputType: typeof original,
          inputShape,
          reasons: {
            schemeCaseChanged: false,
            hostnameCaseChanged: false,
            defaultPortRemoved: false,
            rootSlashAdded: false,
            fragmentRemoved: inputShape.hadFragment,
          },
          inputEndpoint: inputParts.endpoint,
        },
        {inputPath: inputParts.path},
      )
    }
    throw error
  }
}

export const sanitizeRelayUrls = (urls: Iterable<unknown>): string[] => {
  const relays: string[] = []
  const seen = new Set<string>()

  for (const value of urls) {
    if (typeof value !== "string" || (value !== LOCAL_RELAY_URL && !isRelayUrl(value))) continue

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
