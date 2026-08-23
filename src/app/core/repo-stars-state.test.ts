import {beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => {
  const createStore = <T>(initial: T) => {
    let value = initial
    const subscribers = new Set<(value: T) => void>()
    return {
      get: () => value,
      set: (next: T) => {
        value = next
        for (const subscriber of subscribers) subscriber(value)
      },
      subscribe: (subscriber: (value: T) => void) => {
        subscribers.add(subscriber)
        subscriber(value)
        return () => subscribers.delete(subscriber)
      },
    }
  }

  return {
    load: vi.fn(),
    pubkey: createStore<string | undefined>("a".repeat(64)),
    emptyEvents: createStore<any[]>([]),
  }
})

vi.mock("@welshman/app", () => ({
  pubkey: mocks.pubkey,
  repository: {},
}))

vi.mock("@welshman/net", () => ({load: mocks.load}))

vi.mock("@welshman/router", () => ({
  Router: {get: () => ({FromUser: () => ({getUrls: () => []})})},
}))

vi.mock("@welshman/store", () => ({
  deriveEventsAsc: () => mocks.emptyEvents,
  deriveEventsById: () => mocks.emptyEvents,
}))

vi.mock("@app/core/git-state", () => ({GIT_RELAYS: ["wss://git.example"]}))

import {hydrateRepoStars} from "./repo-stars-state"

describe("repository star hydration", () => {
  beforeEach(() => {
    mocks.load.mockReset()
    mocks.load.mockResolvedValue([])
    mocks.pubkey.set("a".repeat(64))
  })

  it("scopes card enrichment to rendered repository addresses", async () => {
    const addresses = [`30617:${"b".repeat(64)}:one`, `30617:${"c".repeat(64)}:two`]

    await hydrateRepoStars({repoAddresses: addresses, force: true})

    expect(mocks.load).toHaveBeenCalledOnce()
    expect(mocks.load.mock.calls[0][0].filters[0]["#a"]).toEqual(addresses)
  })

  it("shares equivalent in-flight hydration", async () => {
    let finish: (() => void) | undefined
    mocks.load.mockReturnValue(
      new Promise<void>(resolve => {
        finish = resolve
      }),
    )
    const options = {repoAddresses: [`30617:${"d".repeat(64)}:shared`], force: false}

    const first = hydrateRepoStars(options)
    const second = hydrateRepoStars(options)

    expect(second).toBe(first)
    expect(mocks.load).toHaveBeenCalledOnce()
    finish?.()
    await first
  })

  it("aborts the underlying load when its timeout expires", async () => {
    vi.useFakeTimers()
    let requestSignal: AbortSignal | undefined
    mocks.load.mockImplementation(
      ({signal}: {signal: AbortSignal}) =>
        new Promise((_resolve, reject) => {
          requestSignal = signal
          signal.addEventListener("abort", () => reject(new Error("aborted")), {once: true})
        }),
    )

    try {
      const pending = hydrateRepoStars({
        repoAddresses: [`30617:${"e".repeat(64)}:timeout`],
        force: true,
      })
      await vi.advanceTimersByTimeAsync(5_500)
      await expect(pending).resolves.toBe(false)
      expect(requestSignal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("aborts superseded rendered-scope work through the caller signal", async () => {
    let requestSignal: AbortSignal | undefined
    mocks.load.mockImplementation(
      ({signal}: {signal: AbortSignal}) =>
        new Promise((_resolve, reject) => {
          requestSignal = signal
          signal.addEventListener("abort", () => reject(new Error("aborted")), {once: true})
        }),
    )
    const controller = new AbortController()
    const pending = hydrateRepoStars({
      repoAddresses: [`30617:${"f".repeat(64)}:superseded`],
      force: true,
      signal: controller.signal,
    })

    controller.abort()

    await expect(pending).resolves.toBe(false)
    expect(requestSignal?.aborted).toBe(true)
  })
})
