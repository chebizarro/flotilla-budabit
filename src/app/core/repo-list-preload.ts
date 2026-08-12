import {request as welshmanRequest, type RequestOptions} from "@welshman/net"
import {isRelayUrl, normalizeRelayUrl, type TrustedEvent} from "@welshman/util"
import {GIT_REPO_ANNOUNCEMENT} from "@nostr-git/core/events"
import {repositoryCache} from "@app/core/repo-cache"
import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"

export const REPO_LIST_ANNOUNCEMENT_LIMIT = 100
export const REPO_LIST_MAX_RELAYS = 6
export const REPO_LIST_PRELOAD_OWNER = "repo-list:announcements"

type RepoListPreloadDependencies = {
  hydrateEligible: () => Promise<unknown>
  request: (options: RequestOptions) => Promise<TrustedEvent[]>
}

type RepoListPreloadOptions = {
  relays: string[]
  signal: AbortSignal
  onHydrated?: () => void
  onHydrationError?: (error: unknown) => void
}

const normalizeRelays = (relays: string[]) =>
  Array.from(
    new Set(
      relays
        .map(relay => {
          try {
            return normalizeRelayUrl(relay)
          } catch {
            return ""
          }
        })
        .filter(isRelayUrl),
    ),
  ).slice(0, REPO_LIST_MAX_RELAYS)

export const createRepoListPreloader = (dependencies: RepoListPreloadDependencies) =>
  async function preloadRepositoryList({
    relays,
    signal,
    onHydrated,
    onHydrationError,
  }: RepoListPreloadOptions) {
    try {
      await dependencies.hydrateEligible()
    } catch (error) {
      onHydrationError?.(error)
    }

    if (signal.aborted) return
    onHydrated?.()

    const targetRelays = normalizeRelays(relays)
    if (targetRelays.length === 0) return

    await dependencies.request({
      relays: targetRelays,
      filters: [{kinds: [GIT_REPO_ANNOUNCEMENT], limit: REPO_LIST_ANNOUNCEMENT_LIMIT}],
      lifetime: "live",
      priority: RELAY_REQUEST_PRIORITY.background,
      owner: REPO_LIST_PRELOAD_OWNER,
      signal,
    })
  }

export const preloadRepositoryList = createRepoListPreloader({
  hydrateEligible: () => repositoryCache.hydrateEligible(),
  request: welshmanRequest,
})
