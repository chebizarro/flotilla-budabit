import {describe, expect, it, vi} from "vitest"
import {REPO_LIST_HYDRATION_BUDGET_MS, createRepoListPreloader} from "./repo-list-preload"

describe("repository list preload", () => {
  it("hydrates the eligible list cache without starting network discovery", async () => {
    const hydrateEligible = vi.fn().mockResolvedValue(undefined)
    const onHydrated = vi.fn()
    const preload = createRepoListPreloader({hydrateEligible})

    await preload({signal: new AbortController().signal, onHydrated})

    expect(hydrateEligible).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(onHydrated).toHaveBeenCalledOnce()
  })

  it("does not start cache work for a pre-aborted route", async () => {
    const hydrateEligible = vi.fn().mockResolvedValue(undefined)
    const onHydrated = vi.fn()
    const preload = createRepoListPreloader({hydrateEligible})
    const controller = new AbortController()
    controller.abort()

    await preload({signal: controller.signal, onHydrated})

    expect(hydrateEligible).not.toHaveBeenCalled()
    expect(onHydrated).not.toHaveBeenCalled()
  })

  it("reports hydration failure and still settles readiness", async () => {
    const error = new Error("cache unavailable")
    const onHydrationError = vi.fn()
    const onHydrated = vi.fn()
    const preload = createRepoListPreloader({
      hydrateEligible: vi.fn().mockRejectedValue(error),
    })

    await preload({signal: new AbortController().signal, onHydrated, onHydrationError})

    expect(onHydrationError).toHaveBeenCalledWith(error)
    expect(onHydrated).toHaveBeenCalledOnce()
  })

  it("marks cache hydration ready after the route budget while hydration continues", async () => {
    vi.useFakeTimers()
    let finishHydration: (() => void) | undefined
    const hydrateEligible = vi.fn(
      () =>
        new Promise<void>(resolve => {
          finishHydration = resolve
        }),
    )
    const onHydrated = vi.fn()
    const preload = createRepoListPreloader({hydrateEligible})
    const pending = preload({signal: new AbortController().signal, onHydrated})

    try {
      await vi.advanceTimersByTimeAsync(REPO_LIST_HYDRATION_BUDGET_MS - 1)
      expect(onHydrated).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(onHydrated).toHaveBeenCalledOnce()

      finishHydration?.()
      await pending
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not mark an aborted route ready", async () => {
    let finishHydration: (() => void) | undefined
    const hydrateEligible = vi.fn(
      () =>
        new Promise<void>(resolve => {
          finishHydration = resolve
        }),
    )
    const onHydrated = vi.fn()
    const preload = createRepoListPreloader({hydrateEligible})
    const controller = new AbortController()
    const pending = preload({signal: controller.signal, onHydrated})

    controller.abort()
    finishHydration?.()
    await pending

    expect(onHydrated).not.toHaveBeenCalled()
  })
})
