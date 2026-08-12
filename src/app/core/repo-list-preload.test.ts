import {describe, expect, it, vi} from "vitest"
import type {RequestOptions} from "@welshman/net"
import type {TrustedEvent} from "@welshman/util"
import {
  REPO_LIST_ANNOUNCEMENT_LIMIT,
  REPO_LIST_MAX_RELAYS,
  REPO_LIST_PRELOAD_OWNER,
  createRepoListPreloader,
} from "./repo-list-preload"

const pendingRequest = (options: RequestOptions) =>
  new Promise<TrustedEvent[]>(resolve => {
    options.signal?.addEventListener("abort", () => resolve([]), {once: true})
  })

describe("repository list preload", () => {
  it("hydrates before starting one bounded background live request", async () => {
    const order: string[] = []
    const hydrateEligible = vi.fn(async () => {
      order.push("hydrate")
    })
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

    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    expect(order).toEqual(["hydrate", "ready", "request"])
    expect(request).toHaveBeenCalledWith({
      relays: expect.arrayContaining(["wss://one.example/"]),
      filters: [{kinds: [30617], limit: REPO_LIST_ANNOUNCEMENT_LIMIT}],
      lifetime: "live",
      priority: -100,
      owner: REPO_LIST_PRELOAD_OWNER,
      signal: controller.signal,
    })
    expect(vi.mocked(request).mock.calls[0][0].relays).toHaveLength(REPO_LIST_MAX_RELAYS)

    controller.abort()
    await pending
  })

  it("does not start network work when the route aborts during hydration", async () => {
    let finishHydration: (() => void) | undefined
    const hydrateEligible = vi.fn(
      () =>
        new Promise<void>(resolve => {
          finishHydration = resolve
        }),
    )
    const request = vi.fn().mockResolvedValue([])
    const preload = createRepoListPreloader({hydrateEligible, request})
    const controller = new AbortController()
    const pending = preload({relays: ["wss://one.example"], signal: controller.signal})

    controller.abort()
    finishHydration?.()
    await pending

    expect(request).not.toHaveBeenCalled()
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
})
