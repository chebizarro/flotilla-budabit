import {describe, expect, it, vi} from "vitest"
import type {RequestOptions} from "@welshman/net"
import type {TrustedEvent} from "@welshman/util"
import {
  REPO_LIST_ANNOUNCEMENT_LIMIT,
  REPO_LIST_HYDRATION_BUDGET_MS,
  REPO_LIST_MAX_RELAYS,
  REPO_LIST_PRELOAD_OWNER,
  createRepoListPreloader,
} from "./repo-list-preload"

const pendingRequest = (options: RequestOptions) =>
  new Promise<TrustedEvent[]>(resolve => {
    options.signal?.addEventListener("abort", () => resolve([]), {once: true})
  })

describe("repository list preload", () => {
  it("hydrates concurrently with one bounded background live request", async () => {
    const order: string[] = []
    let finishHydration: (() => void) | undefined
    const hydrateEligible = vi.fn(
      () =>
        new Promise<void>(resolve => {
          order.push("hydrate")
          finishHydration = resolve
        }),
    )
    const request = vi.fn((options: RequestOptions) => {
      order.push("request")
      return pendingRequest(options)
    })
    const preload = createRepoListPreloader({hydrateEligible, request})
    const controller = new AbortController()
    const onHydrated = vi.fn(() => order.push("ready"))
    const pending = preload({
      relays: [
        "wss://one.example",
        "wss://one.example/",
        ...Array.from({length: REPO_LIST_MAX_RELAYS}, (_, index) => `wss://relay-${index}.example`),
      ],
      signal: controller.signal,
      onHydrated,
    })

    expect(request).toHaveBeenCalledTimes(1)
    expect(order).toEqual(["hydrate", "request"])
    expect(onHydrated).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledWith({
      relays: expect.arrayContaining(["wss://one.example/"]),
      filters: [{kinds: [30617], limit: REPO_LIST_ANNOUNCEMENT_LIMIT}],
      lifetime: "live",
      priority: -100,
      owner: REPO_LIST_PRELOAD_OWNER,
      signal: controller.signal,
    })
    expect(vi.mocked(request).mock.calls[0][0].relays).toHaveLength(REPO_LIST_MAX_RELAYS)

    finishHydration?.()
    await vi.waitFor(() => expect(onHydrated).toHaveBeenCalledOnce())
    expect(order).toEqual(["hydrate", "request", "ready"])

    controller.abort()
    await pending
  })

  it("aborts concurrent network work without marking cache hydration ready", async () => {
    let finishHydration: (() => void) | undefined
    const hydrateEligible = vi.fn(
      () =>
        new Promise<void>(resolve => {
          finishHydration = resolve
        }),
    )
    const request = vi.fn((options: RequestOptions) => pendingRequest(options))
    const preload = createRepoListPreloader({hydrateEligible, request})
    const controller = new AbortController()
    const onHydrated = vi.fn()
    const pending = preload({
      relays: ["wss://one.example"],
      signal: controller.signal,
      onHydrated,
    })

    expect(request).toHaveBeenCalledOnce()
    controller.abort()
    finishHydration?.()
    await pending

    expect(onHydrated).not.toHaveBeenCalled()
    expect(vi.mocked(request).mock.calls[0][0].signal?.aborted).toBe(true)
  })

  it("does not start cache or network work for a pre-aborted route", async () => {
    const hydrateEligible = vi.fn().mockResolvedValue(undefined)
    const request = vi.fn().mockResolvedValue([])
    const onHydrated = vi.fn()
    const preload = createRepoListPreloader({hydrateEligible, request})
    const controller = new AbortController()
    controller.abort()

    await preload({relays: ["wss://one.example"], signal: controller.signal, onHydrated})

    expect(hydrateEligible).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
    expect(onHydrated).not.toHaveBeenCalled()
  })

  it("continues refresh after cache hydration fails", async () => {
    const error = new Error("cache unavailable")
    const request = vi.fn().mockResolvedValue([])
    const onHydrationError = vi.fn()
    const onHydrated = vi.fn()
    const preload = createRepoListPreloader({
      hydrateEligible: vi.fn().mockRejectedValue(error),
      request,
    })

    await preload({
      relays: ["invalid", "wss://one.example"],
      signal: new AbortController().signal,
      onHydrated,
      onHydrationError,
    })

    expect(onHydrationError).toHaveBeenCalledWith(error)
    expect(onHydrated).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith(expect.objectContaining({relays: ["wss://one.example/"]}))
  })

  it("marks cache hydration ready after the route budget while hydration continues", async () => {
    vi.useFakeTimers()
    const hydrateEligible = vi.fn(() => new Promise<void>(() => {}))
    const request = vi.fn((options: RequestOptions) => pendingRequest(options))
    const onHydrated = vi.fn()
    const preload = createRepoListPreloader({hydrateEligible, request})
    const controller = new AbortController()
    const pending = preload({
      relays: ["wss://one.example"],
      signal: controller.signal,
      onHydrated,
    })

    try {
      await vi.advanceTimersByTimeAsync(REPO_LIST_HYDRATION_BUDGET_MS - 1)
      expect(onHydrated).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(onHydrated).toHaveBeenCalledOnce()

      controller.abort()
      await pending
    } finally {
      vi.useRealTimers()
    }
  })

  it("completes hydration independently when network coverage fails", async () => {
    let finishHydration: (() => void) | undefined
    const hydrateEligible = vi.fn(
      () =>
        new Promise<void>(resolve => {
          finishHydration = resolve
        }),
    )
    const error = new Error("relay unavailable")
    const request = vi.fn().mockRejectedValue(error)
    const onHydrated = vi.fn()
    const preload = createRepoListPreloader({hydrateEligible, request})
    const pending = preload({
      relays: ["wss://one.example"],
      signal: new AbortController().signal,
      onHydrated,
    })
    const rejected = expect(pending).rejects.toBe(error)

    finishHydration?.()

    await rejected
    await vi.waitFor(() => expect(onHydrated).toHaveBeenCalledOnce())
  })
})
