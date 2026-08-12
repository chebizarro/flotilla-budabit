import {describe, expect, it, vi} from "vitest"
import type {RequestOptions} from "@welshman/net"
import type {TrustedEvent} from "@welshman/util"
import {
  buildRepoExactThreadLiveFilters,
  buildRepoStableLiveFilters,
  createRepoLiveRequester,
} from "./repo-live-session"

const relay = "wss://repo.example"
const address = `30617:${"a".repeat(64)}:repo`
const event: TrustedEvent = {
  id: "1".repeat(64),
  pubkey: "2".repeat(64),
  created_at: 120,
  kind: 1621,
  tags: [["a", address]],
  content: "issue",
  sig: "3".repeat(128),
}

const pendingRequest = (options: RequestOptions) =>
  new Promise<TrustedEvent[]>(resolve => {
    options.signal?.addEventListener("abort", () => resolve([]), {once: true})
  })

describe("repository live session", () => {
  it("builds stable coordinate, comment, metadata, and viewer filters", () => {
    const filters = buildRepoStableLiveFilters({
      addresses: [address],
      repoPubkey: "a".repeat(64),
      repoName: "repo",
      ownerPubkeys: ["a".repeat(64), "b".repeat(64)],
      viewer: "c".repeat(64),
      includeAnnouncement: true,
      includeActivity: true,
    })

    expect(filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({kinds: [30617], "#d": ["repo"]}),
        expect.objectContaining({kinds: [30618], "#d": ["repo"]}),
        expect.objectContaining({"#a": [address]}),
        {kinds: [1111], "#q": [address]},
        expect.objectContaining({"#p": ["c".repeat(64)]}),
      ]),
    )
    expect(filters.some(filter => "#e" in filter || "#E" in filter)).toBe(false)
  })

  it("keeps exact legacy thread filters separate from stable filters", () => {
    const filters = buildRepoExactThreadLiveFilters(event.id)

    expect(filters).toEqual(
      expect.arrayContaining([
        {kinds: [1111], "#E": [event.id]},
        {kinds: [1111], "#e": [event.id]},
      ]),
    )
    expect(filters.some(filter => "ids" in filter)).toBe(false)
  })

  it("retries an unexpectedly closed relay with overlap from the last event", async () => {
    vi.useFakeTimers()
    const calls: RequestOptions[] = []
    let firstResolve: ((events: TrustedEvent[]) => void) | undefined
    const request = vi.fn((options: RequestOptions) => {
      calls.push(options)
      if (calls.length === 1) {
        options.onEvent?.(event, relay)
        options.onClosed?.("rate-limited", relay)
        return new Promise<TrustedEvent[]>(resolve => {
          firstResolve = resolve
        })
      }
      return pendingRequest(options)
    })
    const start = createRepoLiveRequester({
      request,
      now: () => 100_000,
      random: () => 0,
      onError: vi.fn(),
    })
    const routeController = new AbortController()
    const stop = start({
      relay,
      filters: [{kinds: [1621]}],
      signal: routeController.signal,
      priority: 200,
      owner: "repo-foreground:stable",
      onEvent: vi.fn(),
      retryBaseMs: 1000,
    })

    try {
      firstResolve?.([])
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1000)

      expect(calls).toHaveLength(2)
      expect(calls[0].filters[0]).toMatchObject({limit: 0})
      expect(calls[0].filters[0].since).toBeUndefined()
      expect(calls[1].filters[0].since).toBe(110)
    } finally {
      stop()
      vi.useRealTimers()
    }
  })

  it("does not retry after route abort", async () => {
    vi.useFakeTimers()
    const calls: RequestOptions[] = []
    const request = vi.fn((options: RequestOptions) => {
      calls.push(options)
      return pendingRequest(options)
    })
    const start = createRepoLiveRequester({request, random: () => 0})
    const routeController = new AbortController()
    const stop = start({
      relay,
      filters: [{kinds: [1621]}],
      signal: routeController.signal,
      priority: 200,
      owner: "repo-foreground:stable",
      onEvent: vi.fn(),
    })

    try {
      routeController.abort()
      await Promise.resolve()
      await vi.runAllTimersAsync()
      expect(calls).toHaveLength(1)
    } finally {
      stop()
      vi.useRealTimers()
    }
  })
})
