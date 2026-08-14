import {request as welshmanRequest, type RequestOptions} from "@welshman/net"
import {isRelayUrl, normalizeRelayUrl, type TrustedEvent} from "@welshman/util"
import {GIT_REPO_ANNOUNCEMENT} from "@nostr-git/core/events"
import {REPO_CACHE_ROUTE_HYDRATION_BUDGET_MS, repositoryCache} from "@app/core/repo-cache"
import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"

export const REPO_LIST_ANNOUNCEMENT_LIMIT = 100
export const REPO_LIST_MAX_RELAYS = 6
export const REPO_LIST_PRELOAD_OWNER = "repo-list:announcements"
export const REPO_LIST_HYDRATION_BUDGET_MS = REPO_CACHE_ROUTE_HYDRATION_BUDGET_MS

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
    if (signal.aborted) return

    const hydrationAttempt = (async () => {
      try {
        await dependencies.hydrateEligible()
      } catch (error) {
        if (!signal.aborted) onHydrationError?.(error)
      }
    })()

    const hydration = (async () => {
      let budgetTimer: ReturnType<typeof setTimeout> | undefined
      const budget = new Promise<void>(resolve => {
        budgetTimer = setTimeout(resolve, REPO_LIST_HYDRATION_BUDGET_MS)
      })

      await Promise.race([hydrationAttempt, budget])
      if (budgetTimer) clearTimeout(budgetTimer)

      if (!signal.aborted) onHydrated?.()
    })()

    const coverage = (async () => {
      const targetRelays = normalizeRelays(relays)
      if (signal.aborted || targetRelays.length === 0) return

      await dependencies.request({
        relays: targetRelays,
        filters: [{kinds: [GIT_REPO_ANNOUNCEMENT], limit: REPO_LIST_ANNOUNCEMENT_LIMIT}],
        lifetime: "live",
        priority: RELAY_REQUEST_PRIORITY.background,
        owner: REPO_LIST_PRELOAD_OWNER,
        signal,
      })
    })()

    await Promise.all([hydration, coverage])
  }

export const preloadRepositoryList = createRepoListPreloader({
  hydrateEligible: () => repositoryCache.hydrateEligibleAnnouncements(),
  request: welshmanRequest,
})
