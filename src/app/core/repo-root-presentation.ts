import type {RepoRootHistorySnapshot} from "@app/core/repo-root-history"

export type RepoActivityAuthority = "pending" | "available" | "partial" | "failed" | "unavailable"
export type RepoRootListNotice = "loading" | "partial" | "failed" | "unavailable" | null
export type RepoRootListContent =
  | "rows"
  | "loading"
  | "filtered-empty"
  | "hidden-empty"
  | "recent-empty"
  | "exhausted-empty"
  | "incomplete"

export type RepoRootListPresentation = {
  notice: RepoRootListNotice
  content: RepoRootListContent
  canRetry: boolean
  canLoadOlder: boolean
}

export const getAutoFilledRootVisibleCount = ({
  visibleCount,
  resultCount,
  pageSize,
}: {
  visibleCount: number
  resultCount: number
  pageSize: number
}) => {
  const boundedResultCount = Math.max(0, resultCount)
  const firstPageTarget = Math.min(Math.max(1, pageSize), boundedResultCount)

  return Math.min(Math.max(visibleCount, firstPageTarget), boundedResultCount)
}

export const getRepoRootListPresentation = ({
  authority,
  history,
  rawCount,
  sourceCount,
  resultCount,
  projectionPending,
  cacheHydrationPending = false,
  cacheHydrationFailed = false,
}: {
  authority: RepoActivityAuthority
  history: RepoRootHistorySnapshot
  rawCount: number
  sourceCount: number
  resultCount: number
  projectionPending: boolean
  cacheHydrationPending?: boolean
  cacheHydrationFailed?: boolean
}): RepoRootListPresentation => {
  const rootHistoryStatus = history.rootStatus ?? history.status
  const notice: RepoRootListNotice = cacheHydrationPending
    ? "loading"
    : cacheHydrationFailed
      ? "failed"
      : authority === "pending"
        ? "loading"
        : authority === "partial"
          ? "partial"
          : authority === "failed"
            ? "failed"
            : authority === "unavailable"
              ? "unavailable"
              : history.status === "partial"
                ? "partial"
                : history.status === "failed"
                  ? "failed"
                  : history.status === "idle" || history.status === "loading"
                    ? "loading"
                    : null

  const content: RepoRootListContent = (() => {
    if (resultCount > 0) return "rows"
    if (projectionPending) return "loading"
    if (sourceCount > 0) return "filtered-empty"
    if (rawCount > 0) return "hidden-empty"
    if (rootHistoryStatus === "complete" && !cacheHydrationPending && !cacheHydrationFailed) {
      return history.exhausted ? "exhausted-empty" : "recent-empty"
    }
    if (notice) return "incomplete"
    return "loading"
  })()

  return {
    notice,
    content,
    canRetry:
      cacheHydrationFailed ||
      authority === "partial" ||
      authority === "failed" ||
      (authority === "available" &&
        ((history.rootStatus === "complete" && history.status === "partial") ||
          history.relays.some(
            relay => relay.outcome && relay.outcome !== "eose" && relay.outcome !== "aborted",
          ))),
    canLoadOlder:
      authority === "available" &&
      !projectionPending &&
      !cacheHydrationPending &&
      rootHistoryStatus === "complete" &&
      history.hasOlder,
  }
}
