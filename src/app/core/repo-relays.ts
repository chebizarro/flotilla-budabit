import {isRelayUrl, normalizeRelayUrl} from "@welshman/util"

export const normalizeRepoRelay = (relay: unknown) => {
  try {
    const value = String(relay || "").trim()
    if (!/^wss?:\/\//i.test(value)) return ""
    const normalized = normalizeRelayUrl(value)
    return isRelayUrl(normalized) ? normalized : ""
  } catch {
    return ""
  }
}

export const normalizeRepoRelays = (relays: Iterable<unknown>) =>
  Array.from(new Set(Array.from(relays, normalizeRepoRelay).filter(Boolean)))
