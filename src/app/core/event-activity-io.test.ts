import {readFileSync} from "node:fs"
import {afterEach, describe, expect, it, vi} from "vitest"
import type {Filter, TrustedEvent} from "@welshman/util"
import {
  createEventActivityIO,
  type EventActivityRegistration,
  type EventActivityRequestOptions,
} from "./event-activity-io"

const BATCH_MS = 75
const RELAYS = ["wss://one.example", "wss://two.example"]
const BASE_FILTER = {kinds: [1111], "#K": ["1"]}

const ordinaryFilters = (id: string): Filter[] => [
  {...BASE_FILTER, "#E": [id]},
  {...BASE_FILTER, "#e": [id]},
]
const replaceableFilters = (id: string): Filter[] => [
  {...BASE_FILTER, "#E": [id]},
  {...BASE_FILTER, "#e": [id]},
  {...BASE_FILTER, "#A": [`30023:author:${id}`]},
  {...BASE_FILTER, "#a": [`30023:author:${id}`]},
]

const makeActivityEvent = ({
  id = "reply-1",
  pubkey = "a".repeat(64),
  target = "event-1",
  scopeH = "",
  createdAt = 900,
} = {}): TrustedEvent =>
  ({
    id,
    pubkey,
    created_at: createdAt,
    kind: 1111,
    tags: [["K", "1"], ["E", target], ...(scopeH ? [["h", scopeH]] : [])],
    content: "",
    sig: "sig",
  }) as TrustedEvent

const makeRegistration = (
  filters: Filter[],
  overrides: Partial<EventActivityRegistration> = {},
): EventActivityRegistration => ({
  routeScope: "/activity",
  relays: RELAYS,
  filters,
  ...overrides,
})

const makeHarness = () => {
  let now = 1_000_000
  const calls: EventActivityRequestOptions[] = []
  const publish = vi.fn()
  const track = vi.fn()
  const request = vi.fn((options: EventActivityRequestOptions) => {
    calls.push(options)
    if (options.lifetime === "finite") return Promise.resolve([])

    return new Promise<unknown>(resolve => {
      options.signal.addEventListener("abort", () => resolve([]), {once: true})
    })
  })
  const io = createEventActivityIO({
    request,
    publish,
    track,
    now: () => now,
    batchMs: BATCH_MS,
  })

  return {
    calls,
    io,
    publish,
    request,
    setNow: (value: number) => (now = value),
    track,
  }
}

const flushBatch = () => vi.advanceTimersByTimeAsync(BATCH_MS)
const getLiveCalls = (calls: EventActivityRequestOptions[]) =>
  calls.filter(call => call.lifetime === "live")
const getHistoryCalls = (calls: EventActivityRequestOptions[]) =>
  calls.filter(call => call.lifetime === "finite")

afterEach(() => {
  vi.useRealTimers()
})

describe("event activity coordinator", () => {
  it("groups 100 ordinary registrations into root and direct-reply live filters", async () => {
    vi.useFakeTimers()
    const {calls, io} = makeHarness()

    for (let index = 0; index < 100; index += 1) {
      io.register(makeRegistration(ordinaryFilters(`event-${index}`)))
    }
    await flushBatch()

    const liveCalls = getLiveCalls(calls)
    expect(liveCalls).toHaveLength(1)
    expect(liveCalls[0].filters).toHaveLength(2)
    expect(liveCalls[0].filters[0]["#E"]).toHaveLength(100)
    expect(liveCalls[0].filters[1]["#e"]).toHaveLength(100)
    expect(liveCalls[0]).toMatchObject({lifetime: "live", priority: -100})
    io.close()
  })

  it("packs replaceable references into at most four live filters", async () => {
    vi.useFakeTimers()
    const {calls, io} = makeHarness()

    for (let index = 0; index < 100; index += 1) {
      io.register(makeRegistration(replaceableFilters(`event-${index}`)))
    }
    await flushBatch()

    const [live] = getLiveCalls(calls)
    expect(live.filters).toHaveLength(4)
    expect(
      live.filters.map(filter => Object.keys(filter).find(key => /^#[EeAa]$/.test(key))),
    ).toEqual(["#E", "#e", "#A", "#a"])
    io.close()
  })

  it("suppresses live activity when core community COMMENT #h coverage is declared", async () => {
    vi.useFakeTimers()
    const {calls, io} = makeHarness()

    for (let index = 0; index < 100; index += 1) {
      io.register(
        makeRegistration([{...BASE_FILTER, "#h": ["community"], "#E": [`event-${index}`]}], {
          scopeH: "community",
          coreCommunityLiveCovered: true,
        }),
      )
    }
    await flushBatch()

    expect(getLiveCalls(calls)).toHaveLength(0)
    expect(getHistoryCalls(calls)).toHaveLength(1)
    io.close()
  })

  it("loads exact historical filters through finite background requests and publishes events", async () => {
    vi.useFakeTimers()
    const {calls, io, publish, track} = makeHarness()
    const filters = replaceableFilters("event-1")

    io.register(makeRegistration(filters))
    await flushBatch()

    const [history] = getHistoryCalls(calls)
    expect(history).toMatchObject({autoClose: true, lifetime: "finite", priority: -100})
    expect(history.filters).toEqual(filters.map(filter => ({...filter, until: 995})))

    const event = makeActivityEvent()
    history.onEvent(event, "wss://one.example/")
    expect(track).toHaveBeenCalledWith("reply-1", "wss://one.example/")
    expect(publish).toHaveBeenCalledWith(event)
    io.close()
  })

  it("uses broad scoped wire filters while rejecting unauthorized activity", async () => {
    vi.useFakeTimers()
    const {calls, io, publish, track} = makeHarness()
    const scopeH = "b".repeat(64)
    const allowedAuthors = Array.from({length: 1001}, (_, index) =>
      index.toString(16).padStart(64, "0"),
    )
    const allowedAuthor = allowedAuthors[1000]
    const relayFilters = [{...BASE_FILTER, "#h": [scopeH], "#E": ["event-1"]}]
    const filters = relayFilters.map(filter => ({...filter, authors: allowedAuthors}))

    io.register(
      makeRegistration(filters, {
        scopeH,
        relayFilters,
      }),
    )
    await flushBatch()

    const [history] = getHistoryCalls(calls)
    const [live] = getLiveCalls(calls)
    expect(history.filters[0]).toMatchObject({
      kinds: [1111],
      "#K": ["1"],
      "#h": [scopeH],
      "#E": ["event-1"],
    })
    expect(history.filters[0]).not.toHaveProperty("authors")
    expect(live.filters[0]).not.toHaveProperty("authors")

    history.onEvent(
      makeActivityEvent({id: "outsider", pubkey: "f".repeat(64), scopeH}),
      "wss://one.example/",
    )
    history.onEvent(
      makeActivityEvent({id: "wrong-scope", pubkey: allowedAuthor, scopeH: "c".repeat(64)}),
      "wss://one.example/",
    )
    expect(track).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()

    const admitted = makeActivityEvent({pubkey: allowedAuthor, scopeH})
    history.onEvent(admitted, "wss://one.example/")
    expect(track).toHaveBeenCalledWith(admitted.id, "wss://one.example/")
    expect(publish).toHaveBeenCalledWith(admitted)
    io.close()
  })

  it("retains author filters on the wire for generic activity", async () => {
    vi.useFakeTimers()
    const {calls, io} = makeHarness()
    const authors = ["a".repeat(64)]

    io.register(makeRegistration([{...BASE_FILTER, authors, "#E": ["event-1"]}]))
    await flushBatch()

    expect(getHistoryCalls(calls)[0].filters[0].authors).toEqual(authors)
    expect(getLiveCalls(calls)[0].filters[0].authors).toEqual(authors)
    io.close()
  })

  it("paginates broad history by raw events and loads exact deletes for admitted comments", async () => {
    vi.useFakeTimers()
    const scopeH = "b".repeat(64)
    const relay = "wss://one.example/"
    const allowedAuthor = "c".repeat(64)
    const outsiderPage = Array.from({length: 100}, (_, index) =>
      makeActivityEvent({
        id: index.toString(16).padStart(64, "0"),
        pubkey: "d".repeat(64),
        scopeH,
        createdAt: 995 - index,
      }),
    )
    const admitted = makeActivityEvent({
      id: "e".repeat(64),
      pubkey: allowedAuthor,
      scopeH,
      createdAt: 800,
    })
    const calls: EventActivityRequestOptions[] = []
    const publish = vi.fn()
    const track = vi.fn()
    const historyResult = vi.fn()
    const request = vi.fn((options: EventActivityRequestOptions) => {
      calls.push(options)
      if (options.lifetime === "live") {
        return new Promise<unknown>(resolve => {
          options.signal.addEventListener("abort", () => resolve([]), {once: true})
        })
      }

      const isDeleteLoad = options.filters.every(filter => filter.kinds?.includes(5))
      const events = isDeleteLoad
        ? []
        : options.filters[0].until === 995
          ? outsiderPage
          : [admitted]
      for (const event of events) options.onEvent(event, relay)
      options.onEose?.(relay)
      return Promise.resolve(events)
    })
    const io = createEventActivityIO({
      request,
      publish,
      track,
      now: () => 1_000_000,
      batchMs: BATCH_MS,
    })
    const relayFilters = [{...BASE_FILTER, "#h": [scopeH], "#E": ["event-1"]}]
    const localFilters = relayFilters.map(filter => ({...filter, authors: [allowedAuthor]}))

    io.register(
      makeRegistration(localFilters, {
        relays: [relay],
        scopeH,
        relayFilters,
        onHistoryResult: historyResult,
      }),
    )
    await flushBatch()
    for (let index = 0; index < 10; index += 1) await Promise.resolve()

    const historyCalls = getHistoryCalls(calls)
    expect(historyCalls).toHaveLength(3)
    expect(historyCalls[0].filters[0]).toMatchObject({limit: 100, until: 995})
    expect(historyCalls[0].filters[0]).not.toHaveProperty("authors")
    expect(historyCalls[1].filters[0]).toMatchObject({limit: 100, until: 895})
    expect(historyCalls[2].filters[0]).toMatchObject({
      kinds: [5],
      authors: [allowedAuthor],
      "#e": [admitted.id],
    })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith(admitted)
    expect(track).toHaveBeenCalledWith(admitted.id, relay)
    expect(historyResult).toHaveBeenCalledWith({
      events: [admitted],
      complete: false,
      timedOut: false,
      saturated: true,
    })
    io.close()
  })

  it("keeps the original live since boundary for late registrations", async () => {
    vi.useFakeTimers()
    const {calls, io, setNow} = makeHarness()

    io.register(makeRegistration(ordinaryFilters("event-1")))
    await flushBatch()
    const first = getLiveCalls(calls)[0]

    setNow(2_000_000)
    io.register(makeRegistration(ordinaryFilters("event-2")))
    await flushBatch()
    const replacement = getLiveCalls(calls)[1]

    expect(first.filters[0].since).toBe(995)
    expect(replacement.filters.every(filter => filter.since === 995)).toBe(true)
    io.close()
  })

  it("reference-counts registrations and closes live activity after the last unregister", async () => {
    vi.useFakeTimers()
    const {calls, io} = makeHarness()
    const registration = makeRegistration(ordinaryFilters("event-1"))
    const unregisterFirst = io.register(registration)
    const unregisterSecond = io.register(registration)
    await flushBatch()

    const [live] = getLiveCalls(calls)
    unregisterFirst()
    expect(live.signal.aborted).toBe(false)
    unregisterSecond()
    expect(live.signal.aborted).toBe(true)
    io.close()
  })

  it("keeps the old live request until its replacement reaches EOSE on every relay", async () => {
    vi.useFakeTimers()
    const {calls, io} = makeHarness()

    io.register(makeRegistration(ordinaryFilters("event-1")))
    await flushBatch()
    const first = getLiveCalls(calls)[0]

    io.register(makeRegistration(ordinaryFilters("event-2")))
    await flushBatch()
    const replacement = getLiveCalls(calls)[1]

    expect(first.signal.aborted).toBe(false)
    replacement.onEose?.("wss://one.example/")
    expect(first.signal.aborted).toBe(false)
    replacement.onEose?.("wss://two.example/")
    expect(first.signal.aborted).toBe(true)
    io.close()
  })
})

describe("activity request ownership", () => {
  const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

  it("keeps EventActivity repository-driven and removes CommunityMenu room request ownership", () => {
    const activity = readProjectFile("../components/EventActivity.svelte")
    const menu = readProjectFile("../components/CommunityMenu.svelte")

    expect(activity).toContain("registerEventActivity")
    expect(activity).not.toContain('from "@welshman/net"')
    expect(menu).not.toContain("request({relays: $activeExactCommunityRelays, filters: roomFilters")
    expect(menu).toContain("deriveEventsById({repository, filters: roomFilters})")
  })

  it("leaves issue edit hydration with the layout-owned root gap", () => {
    const page = readProjectFile("../../routes/git/[id=naddr]/issues/+page.svelte")
    const rootHistory = readProjectFile("./repo-root-history.ts")

    expect(page).not.toContain("// Prefetch recent issue edit events")
    expect(rootHistory).toContain('{kinds: [GIT_LABEL, GIT_COVER_LETTER], "#e": roots}')
  })
})
