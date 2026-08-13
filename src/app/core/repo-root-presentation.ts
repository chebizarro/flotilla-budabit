import type {RepoRootHistorySnapshot} from "@app/core/repo-root-history"

export type RepoActivityAuthority =
  | "pending"
  | "available"
  | "limited"
  | "partial"
  | "failed"
  | "unavailable"
export type RepoRootListNotice = "loading" | "limited" | "partial" | "failed" | "unavailable" | null
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
                  : authority === "limited"
                    ? "limited"
                    : history.status === "idle" || history.status === "loading"
                      ? "loading"
                      : null

  const content: RepoRootListContent = (() => {
    if (resultCount > 0) return "rows"
    if (projectionPending) return "loading"
    if (notice && (authority !== "limited" || !history.hasOlder)) return "incomplete"
    if (sourceCount > 0) return "filtered-empty"
    if (rawCount > 0) return "hidden-empty"
    if (rootHistoryStatus === "complete" && !cacheHydrationPending && !cacheHydrationFailed) {
      return history.exhausted ? "exhausted-empty" : "recent-empty"
    }
    return "loading"
  })()

  return {
    notice,
    content,
    canRetry:
      cacheHydrationFailed ||
      authority === "partial" ||
      authority === "failed" ||
      ((authority === "available" || authority === "limited") &&
        (history.status === "partial" || history.status === "failed")),
    canLoadOlder:
      (authority === "available" || authority === "limited") &&
      !projectionPending &&
      !cacheHydrationPending &&
      rootHistoryStatus === "complete" &&
      history.hasOlder,
  }
}
