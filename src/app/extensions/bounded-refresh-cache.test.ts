import {describe, expect, it, vi} from "vitest"
import {BoundedRefreshCache} from "./bounded-refresh-cache"

describe("bounded refresh cache", () => {
  it("deduplicates in-flight and sequential refreshes within the freshness TTL", async () => {
    let now = 1_000
    const load = vi.fn(async () => "value")
    const cache = new BoundedRefreshCache<string>(5_000, 10, () => now)

    const first = cache.refresh("scope", load)
    const concurrent = cache.refresh("scope", load)
    expect(concurrent).toBe(first)
    await first

    await expect(cache.refresh("scope", load)).resolves.toBe("value")
    expect(load).toHaveBeenCalledTimes(1)

    now += 5_000
    await cache.refresh("scope", load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("keeps scopes independent and evicts the oldest scope at the cardinality bound", async () => {
    const cache = new BoundedRefreshCache<string>(5_000, 2)
    await cache.refresh("one", async () => "first")
    await cache.refresh("two", async () => "second")
    await cache.refresh("three", async () => "third")

    expect(cache.size).toBe(2)
    expect(cache.getLatest("one")).toBeUndefined()
    expect(cache.getLatest("two")).toBe("second")
    expect(cache.getLatest("three")).toBe("third")
  })

  it("does not freshness-cache values rejected by the cache policy", async () => {
    const load = vi.fn(async () => ({complete: false}))
    const cache = new BoundedRefreshCache<{complete: boolean}>(
      5_000,
      2,
      Date.now,
      value => value.complete,
    )

    await cache.refresh("scope", load)
    await cache.refresh("scope", load)

    expect(load).toHaveBeenCalledTimes(2)
  })
})
