// @vitest-environment jsdom

import {describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
import {DAY} from "@welshman/lib"
import {EVENT_DATE, EVENT_TIME, type Filter, type TrustedEvent} from "@welshman/util"

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()},
  db: {},
}))

vi.mock("@lib/html", async importOriginal => ({
  ...(await importOriginal<typeof import("@lib/html")>()),
  createScroller: vi.fn(() => ({check: vi.fn(), stop: vi.fn()})),
}))

vi.mock("@welshman/app", async importOriginal => {
  const actual = await importOriginal<typeof import("@welshman/app")>()
  return {
    ...actual,
    loadRelay: vi.fn().mockResolvedValue({}),
    makeFeedController: vi.fn(actual.makeFeedController),
  }
})

describe("requests", () => {
  it("discoverRelays returns promise for empty lists", async () => {
    const {discoverRelays} = await import("./requests")
    const result = discoverRelays([])
    expect(result).toBeInstanceOf(Promise)
    await expect(result).resolves.toEqual([])
  })

  it("discoverRelays filters to shareable relay URLs from lists", async () => {
    const {discoverRelays} = await import("./requests")
    const listWithRelays = {
      kind: 10003,
      publicTags: [["r", "wss://relay.damus.io"]],
      privateTags: [],
    } as any
    const result = discoverRelays([listWithRelays])
    expect(result).toBeInstanceOf(Promise)
    const resolved = await result
    expect(Array.isArray(resolved)).toBe(true)
  })

  it("builds separate date and time calendar feed filters", async () => {
    const {makeCalendarDateBasedFilters, makeCalendarTimeBasedFilters} = await import("./requests")
    const filters: Filter[] = [
      {kinds: [EVENT_DATE, EVENT_TIME], authors: ["a"], "#h": ["target"]},
      {kinds: [EVENT_TIME], authors: ["b"]},
      {kinds: [EVENT_DATE], authors: ["c"]},
    ]

    expect(makeCalendarDateBasedFilters(filters)).toEqual([
      {kinds: [EVENT_DATE], authors: ["a"], "#h": ["target"]},
      {kinds: [EVENT_DATE], authors: ["c"]},
    ])
    expect(makeCalendarTimeBasedFilters(filters, 0, DAY)).toEqual([
      {kinds: [EVENT_TIME], authors: ["a"], "#h": ["target"], "#D": ["0"]},
      {kinds: [EVENT_TIME], authors: ["b"], "#D": ["0"]},
    ])
  })

  it("keeps a live event visible when its signed replacement uses the same id", async () => {
    vi.useFakeTimers()

    const {makeFeed} = await import("./requests")
    const {repository, tracker} = await import("@welshman/app")
    const relay = "wss://room-feed.test"
    const event: TrustedEvent = {
      id: "1".repeat(64),
      pubkey: "2".repeat(64),
      created_at: 123,
      kind: 1,
      tags: [],
      content: "live message",
      sig: "3".repeat(128),
    }
    const feed = makeFeed({
      element: document.createElement("div"),
      relays: [relay],
      feedFilters: [{kinds: [event.kind], authors: [event.pubkey]}],
    })

    try {
      vi.advanceTimersByTime(3000)
      tracker.addRelay(event.id, relay)
      repository.publish(event)

      expect(get(feed.events).map(item => item.id)).toEqual([event.id])

      repository.removeEvent(event.id)
      repository.publish({...event, sig: "4".repeat(128)})

      expect(get(feed.events).map(item => item.id)).toEqual([event.id])
    } finally {
      feed.cleanup()
      repository.removeEvent(event.id)
      tracker.removeRelay(event.id, relay)
      vi.useRealTimers()
    }
  })

  it("adds a cached event when a room relay acknowledges it later", async () => {
    vi.useFakeTimers()

    const {makeFeed} = await import("./requests")
    const {repository, tracker} = await import("@welshman/app")
    const relay = "wss://acknowledged-room-feed.test"
    const otherRelay = "wss://other-room-feed.test"
    const event: TrustedEvent = {
      id: "4".repeat(64),
      pubkey: "5".repeat(64),
      created_at: 456,
      kind: 9,
      tags: [],
      content: "optimistic room message",
      sig: "6".repeat(128),
    }
    const feed = makeFeed({
      element: document.createElement("div"),
      relays: [relay],
      feedFilters: [{kinds: [event.kind], authors: [event.pubkey]}],
    })

    try {
      vi.advanceTimersByTime(3000)
      repository.publish(event)

      expect(get(feed.events)).toEqual([])

      tracker.addRelay(event.id, otherRelay)
      expect(get(feed.events)).toEqual([])

      tracker.addRelay(event.id, relay)
      expect(get(feed.events).map(item => item.id)).toEqual([event.id])
    } finally {
      feed.cleanup()
      repository.removeEvent(event.id)
      tracker.removeRelay(event.id, relay)
      tracker.removeRelay(event.id, otherRelay)
      vi.useRealTimers()
    }
  })

  it("honors a custom initial timeout and forwards request scheduling metadata", async () => {
    vi.useFakeTimers()

    const {makeFeed} = await import("./requests")
    const {makeFeedController} = await import("@welshman/app")
    const onInitialLoad = vi.fn()
    const controllerMock = vi.mocked(makeFeedController)
    controllerMock.mockClear()
    const feed = makeFeed({
      element: document.createElement("div"),
      relays: ["wss://priority-room.test"],
      feedFilters: [{kinds: [9]}],
      initialLoadTimeoutMs: 10_000,
      priority: 350,
      owner: "active-room:test",
      onInitialLoad,
    })

    try {
      expect(controllerMock).toHaveBeenCalledWith(
        expect.objectContaining({priority: 350, owner: "active-room:test"}),
      )

      await vi.advanceTimersByTimeAsync(9_999)
      expect(onInitialLoad).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(onInitialLoad).toHaveBeenCalledOnce()
      expect(onInitialLoad).toHaveBeenCalledWith({complete: false, timedOut: true})
    } finally {
      feed.cleanup()
      vi.useRealTimers()
    }
  })

  it("uses broad relay filters while admitting only current writers locally", async () => {
    vi.useFakeTimers()

    const {makeFeed} = await import("./requests")
    const {makeFeedController, repository, tracker} = await import("@welshman/app")
    const relay = "wss://broad-community-feed.test"
    const allowedAuthors = Array.from({length: 1001}, (_, index) =>
      index.toString(16).padStart(64, "0"),
    )
    const allowedAuthor = allowedAuthors[1000]
    const outsiderAuthor = "8".repeat(64)
    const makeEvent = (id: string, pubkey: string): TrustedEvent => ({
      id: id.repeat(64),
      pubkey,
      created_at: 789,
      kind: 9,
      tags: [["h", "community"]],
      content: "message",
      sig: "9".repeat(128),
    })
    const controllerMock = vi.mocked(makeFeedController)
    controllerMock.mockClear()
    const feed = makeFeed({
      element: document.createElement("div"),
      relays: [relay],
      feedFilters: [{kinds: [9], authors: allowedAuthors, "#h": ["community"]}],
      relayFilters: [{kinds: [9], "#h": ["community"]}],
    })
    const outsider = makeEvent("a", outsiderAuthor)
    const allowed = makeEvent("b", allowedAuthor)

    try {
      expect(JSON.stringify(controllerMock.mock.calls[0][0].feed)).not.toContain(allowedAuthor)
      vi.advanceTimersByTime(3000)

      tracker.addRelay(outsider.id, relay)
      repository.publish(outsider)
      tracker.addRelay(allowed.id, relay)
      repository.publish(allowed)

      expect(get(feed.events).map(event => event.id)).toEqual([allowed.id])
    } finally {
      feed.cleanup()
      repository.removeEvent(outsider.id)
      repository.removeEvent(allowed.id)
      tracker.removeRelay(outsider.id, relay)
      tracker.removeRelay(allowed.id, relay)
      vi.useRealTimers()
    }
  })

  it("applies local admission to caller-provided initial events", async () => {
    const {makeFeed} = await import("./requests")
    const allowedAuthor = "1".repeat(64)
    const makeEvent = (id: string, pubkey: string): TrustedEvent => ({
      id: id.repeat(64),
      pubkey,
      created_at: 1,
      kind: 11,
      tags: [["h", "community"]],
      content: "thread",
      sig: "2".repeat(128),
    })
    const allowed = makeEvent("3", allowedAuthor)
    const outsider = makeEvent("4", "5".repeat(64))
    const feed = makeFeed({
      element: document.createElement("div"),
      relays: [],
      feedFilters: [{kinds: [11], authors: [allowedAuthor], "#h": ["community"]}],
      relayFilters: [{kinds: [11], "#h": ["community"]}],
      initialEvents: [outsider, allowed],
    })

    try {
      expect(get(feed.events).map(event => event.id)).toEqual([allowed.id])
    } finally {
      feed.cleanup()
    }
  })

  it("bounds unauthorized-only scanning and reports an incomplete initial load", async () => {
    const {makeFeed} = await import("./requests")
    const {makeFeedController} = await import("@welshman/app")
    const {createScroller} = await import("@lib/html")
    const controllerMock = vi.mocked(makeFeedController)
    const scrollerMock = vi.mocked(createScroller)
    const outsider: TrustedEvent = {
      id: "d".repeat(64),
      pubkey: "e".repeat(64),
      created_at: 1,
      kind: 9,
      tags: [["h", "community"]],
      content: "outsider",
      sig: "f".repeat(128),
    }
    const load = vi.fn()
    controllerMock.mockImplementationOnce(options => {
      load.mockImplementation(async () => options.onEvent?.(outsider))
      return {load} as any
    })
    const onInitialLoad = vi.fn()
    const feed = makeFeed({
      element: document.createElement("div"),
      relays: ["wss://saturated-community-feed.test"],
      feedFilters: [{kinds: [9], authors: ["c".repeat(64)], "#h": ["community"]}],
      relayFilters: [{kinds: [9], "#h": ["community"]}],
      onInitialLoad,
    })

    try {
      const onScroll = scrollerMock.mock.calls.at(-1)?.[0].onScroll
      expect(onScroll).toBeTypeOf("function")
      await onScroll?.()

      expect(load).toHaveBeenCalledTimes(3)
      expect(onInitialLoad).toHaveBeenCalledWith({
        complete: false,
        timedOut: false,
        saturated: true,
      })
    } finally {
      feed.cleanup()
    }
  })

  it("does not treat an empty non-exhausted broad scan as authoritative", async () => {
    const {makeFeed} = await import("./requests")
    const {makeFeedController} = await import("@welshman/app")
    const {createScroller} = await import("@lib/html")
    const controllerMock = vi.mocked(makeFeedController)
    const scrollerMock = vi.mocked(createScroller)
    controllerMock.mockImplementationOnce(
      () => ({load: vi.fn().mockResolvedValue(undefined)}) as any,
    )
    const onInitialLoad = vi.fn()
    const feed = makeFeed({
      element: document.createElement("div"),
      relays: ["wss://disconnected-community-feed.test"],
      feedFilters: [{kinds: [9], authors: ["1".repeat(64)], "#h": ["community"]}],
      relayFilters: [{kinds: [9], "#h": ["community"]}],
      onInitialLoad,
    })

    try {
      const onScroll = scrollerMock.mock.calls.at(-1)?.[0].onScroll
      await onScroll?.()

      expect(onInitialLoad).toHaveBeenCalledWith({complete: false, timedOut: false})
    } finally {
      feed.cleanup()
    }
  })

  it("does not count repeated exhaustion from one relay as multi-relay exhaustion", async () => {
    const {makeFeed} = await import("./requests")
    const {makeFeedController} = await import("@welshman/app")
    const {createScroller} = await import("@lib/html")
    const controllerMock = vi.mocked(makeFeedController)
    const scrollerMock = vi.mocked(createScroller)
    const outsider: TrustedEvent = {
      id: "6".repeat(64),
      pubkey: "7".repeat(64),
      created_at: 1,
      kind: 9,
      tags: [["h", "community"]],
      content: "outsider",
      sig: "8".repeat(128),
    }
    controllerMock.mockImplementationOnce(
      options =>
        ({
          load: vi.fn(async () => {
            options.onEvent?.(outsider)
            options.onExhausted?.()
          }),
        }) as any,
    )
    controllerMock.mockImplementationOnce(
      options =>
        ({
          load: vi.fn(async () => options.onEvent?.({...outsider, id: "9".repeat(64)})),
        }) as any,
    )
    const onExhausted = vi.fn()
    const feed = makeFeed({
      element: document.createElement("div"),
      relays: ["wss://exhausted.test", "wss://active.test"],
      feedFilters: [{kinds: [9], authors: ["a".repeat(64)], "#h": ["community"]}],
      relayFilters: [{kinds: [9], "#h": ["community"]}],
      onExhausted,
    })

    try {
      const onScroll = scrollerMock.mock.calls.at(-1)?.[0].onScroll
      await onScroll?.()

      expect(onExhausted).not.toHaveBeenCalled()
    } finally {
      feed.cleanup()
    }
  })
})
