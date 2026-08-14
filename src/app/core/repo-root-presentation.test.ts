import {describe, expect, it} from "vitest"
import type {RepoRootHistorySnapshot} from "./repo-root-history"
import {getRepoRootListPresentation} from "./repo-root-presentation"

const history = (
  status: RepoRootHistorySnapshot["status"],
  options: Partial<RepoRootHistorySnapshot> = {},
): RepoRootHistorySnapshot => ({
  status,
  operation: null,
  relays: [],
  hasOlder: false,
  exhausted: false,
  ...options,
})

describe("repository root list presentation", () => {
  it("preserves rows while refresh is loading, partial, failed, or unavailable", () => {
    for (const [authority, snapshot, notice] of [
      ["available", history("loading", {operation: "recent"}), "loading"],
      ["available", history("partial", {operation: "recent"}), "partial"],
      ["available", history("failed", {operation: "recent"}), "failed"],
      ["unavailable", history("idle"), "unavailable"],
    ] as const) {
      expect(
        getRepoRootListPresentation({
          authority,
          history: snapshot,
          rawCount: 2,
          sourceCount: 2,
          resultCount: 2,
          projectionPending: false,
        }),
      ).toMatchObject({content: "rows", notice})
    }
  })

  it("distinguishes recent, exhausted, filtered, and hidden empty states", () => {
    const completeRecent = history("complete", {operation: "recent", hasOlder: true})
    const completeAll = history("complete", {operation: "older", exhausted: true})

    expect(
      getRepoRootListPresentation({
        authority: "available",
        history: completeRecent,
        rawCount: 0,
        sourceCount: 0,
        resultCount: 0,
        projectionPending: false,
      }).content,
    ).toBe("recent-empty")
    expect(
      getRepoRootListPresentation({
        authority: "available",
        history: completeAll,
        rawCount: 0,
        sourceCount: 0,
        resultCount: 0,
        projectionPending: false,
      }).content,
    ).toBe("exhausted-empty")
    expect(
      getRepoRootListPresentation({
        authority: "available",
        history: completeRecent,
        rawCount: 2,
        sourceCount: 2,
        resultCount: 0,
        projectionPending: false,
      }).content,
    ).toBe("filtered-empty")
    expect(
      getRepoRootListPresentation({
        authority: "available",
        history: completeRecent,
        rawCount: 2,
        sourceCount: 0,
        resultCount: 0,
        projectionPending: false,
      }).content,
    ).toBe("hidden-empty")
  })

  it("never presents incomplete relay work as authoritative empty", () => {
    for (const status of ["idle", "loading", "partial", "failed"] as const) {
      const presentation = getRepoRootListPresentation({
        authority: "available",
        history: history(status, {operation: "recent"}),
        rawCount: 0,
        sourceCount: 0,
        resultCount: 0,
        projectionPending: false,
      })

      expect(["recent-empty", "exhausted-empty"]).not.toContain(presentation.content)
    }
  })

  it("keeps loaded filtered and hidden empty states truthful while failures remain advisory", () => {
    for (const counts of [
      {rawCount: 2, sourceCount: 2},
      {rawCount: 2, sourceCount: 0},
    ]) {
      const presentation = getRepoRootListPresentation({
        authority: "available",
        history: history("partial", {operation: "recent"}),
        ...counts,
        resultCount: 0,
        projectionPending: false,
      })
      expect(presentation.notice).toBe("partial")
      expect(presentation.content).toBe(counts.sourceCount > 0 ? "filtered-empty" : "hidden-empty")
    }
  })

  it("does not present authoritative empty while cache hydration remains incomplete", () => {
    expect(
      getRepoRootListPresentation({
        authority: "available",
        history: history("complete", {operation: "older", exhausted: true}),
        rawCount: 0,
        sourceCount: 0,
        resultCount: 0,
        projectionPending: false,
        cacheHydrationPending: true,
      }),
    ).toMatchObject({notice: "loading", content: "incomplete", canLoadOlder: false})

    expect(
      getRepoRootListPresentation({
        authority: "available",
        history: history("complete", {operation: "older", exhausted: true}),
        rawCount: 0,
        sourceCount: 0,
        resultCount: 0,
        projectionPending: false,
        cacheHydrationFailed: true,
      }),
    ).toMatchObject({notice: "failed", content: "incomplete", canRetry: true})

    expect(
      getRepoRootListPresentation({
        authority: "unavailable",
        history: history("idle"),
        rawCount: 0,
        sourceCount: 0,
        resultCount: 0,
        projectionPending: false,
        cacheHydrationFailed: true,
      }),
    ).toMatchObject({notice: "failed", content: "incomplete", canRetry: true})
  })

  it("offers only the action supported by the current history state", () => {
    expect(
      getRepoRootListPresentation({
        authority: "available",
        history: history("partial", {
          operation: "recent",
          hasOlder: true,
          relays: [
            {
              relay: "wss://slow",
              status: "partial",
              exhausted: false,
              boundarySaturated: false,
              pageSize: 100,
              eventCount: 0,
              outcome: "timeout",
            },
          ],
        }),
        rawCount: 0,
        sourceCount: 0,
        resultCount: 0,
        projectionPending: false,
      }),
    ).toMatchObject({canRetry: true, canLoadOlder: false})

    expect(
      getRepoRootListPresentation({
        authority: "available",
        history: history("complete", {operation: "recent", hasOlder: true}),
        rawCount: 0,
        sourceCount: 0,
        resultCount: 0,
        projectionPending: false,
      }),
    ).toMatchObject({canRetry: false, canLoadOlder: true})

    expect(
      getRepoRootListPresentation({
        authority: "partial",
        history: history("idle"),
        rawCount: 0,
        sourceCount: 0,
        resultCount: 0,
        projectionPending: false,
      }),
    ).toMatchObject({notice: "partial", content: "incomplete", canRetry: true})

    expect(
      getRepoRootListPresentation({
        authority: "available",
        history: history("partial", {
          rootStatus: "complete",
          operation: "recent",
          hasOlder: true,
        }),
        rawCount: 2,
        sourceCount: 2,
        resultCount: 2,
        projectionPending: false,
      }),
    ).toMatchObject({notice: "partial", content: "rows", canRetry: true, canLoadOlder: true})

    expect(
      getRepoRootListPresentation({
        authority: "available",
        history: history("partial", {
          rootStatus: "complete",
          operation: "older",
          exhausted: true,
        }),
        rawCount: 0,
        sourceCount: 0,
        resultCount: 0,
        projectionPending: false,
      }),
    ).toMatchObject({notice: "partial", content: "exhausted-empty"})

    expect(
      getRepoRootListPresentation({
        authority: "available",
        history: history("partial", {
          operation: "older",
          relays: [
            {
              relay: "wss://saturated",
              status: "partial",
              exhausted: false,
              boundarySaturated: true,
              pageSize: 100,
              eventCount: 100,
              outcome: "eose",
            },
          ],
        }),
        rawCount: 2,
        sourceCount: 2,
        resultCount: 2,
        projectionPending: false,
      }),
    ).toMatchObject({notice: "partial", canRetry: false})
  })
})
