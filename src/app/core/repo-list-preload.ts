import {REPO_CACHE_ROUTE_HYDRATION_BUDGET_MS, repositoryCache} from "@app/core/repo-cache"

export const REPO_LIST_ANNOUNCEMENT_LIMIT = 100
export const REPO_LIST_MAX_RELAYS = 6
export const REPO_LIST_HYDRATION_BUDGET_MS = REPO_CACHE_ROUTE_HYDRATION_BUDGET_MS

type RepoListPreloadDependencies = {
  hydrateEligible: (signal: AbortSignal) => Promise<unknown>
}

type RepoListPreloadOptions = {
  signal: AbortSignal
  onHydrated?: () => void
  onHydrationError?: (error: unknown) => void
}

export const createRepoListPreloader = (dependencies: RepoListPreloadDependencies) =>
  async function preloadRepositoryList({
    signal,
    onHydrated,
    onHydrationError,
  }: RepoListPreloadOptions) {
    if (signal.aborted) return

    const hydrationAttempt = (async () => {
      try {
        await dependencies.hydrateEligible(signal)
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

    await Promise.all([hydration, hydrationAttempt])
  }

export const preloadRepositoryList = createRepoListPreloader({
  hydrateEligible: signal => repositoryCache.hydrateEligibleAnnouncements(signal),
})
