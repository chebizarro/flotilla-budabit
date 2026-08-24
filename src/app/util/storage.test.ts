import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {repository, tracker} from "@welshman/app"
import {REACTION, type TrustedEvent} from "@welshman/util"
import type {IDBTable} from "@lib/indexeddb"
import {
  eventsAdapter,
  mergePersistedEvents,
  mergePersistedRelayProvenance,
  trackerAdapter,
  type TrackerItem,
} from "./storage"

const pubkey = "1".repeat(64)
const communityIdA = "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f"
const communityIdB = "4d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766"
const makeEvent = ({
  id,
  createdAt,
  content,
  kind = 0,
  tags = [],
}: {
  id: string
  createdAt: number
  content: string
  kind?: number
  tags?: string[][]
}) =>
  ({
    id,
    pubkey,
    created_at: createdAt,
    kind,
    tags,
    content,
    sig: "2".repeat(128),
  }) as TrustedEvent

const makeTable = <T>(initial: T[] = []) =>
  ({
    getAll: vi.fn().mockResolvedValue(initial),
    bulkPut: vi.fn().mockResolvedValue(undefined),
    bulkDelete: vi.fn().mockResolvedValue(undefined),
  }) as unknown as IDBTable<T>

describe("storage hydration", () => {
  beforeEach(() => {
    repository.load([])
    tracker.clear()
  })

  afterEach(() => {
    repository.load([])
    tracker.clear()
    vi.useRealTimers()
  })

  it("keeps newer in-memory replaceable events during late hydration", () => {
    const cached = makeEvent({id: "a".repeat(64), createdAt: 10, content: "cached"})
    const live = makeEvent({id: "b".repeat(64), createdAt: 20, content: "live"})
    repository.publish(live)

    mergePersistedEvents([cached])

    expect(repository.getEvent(`0:${pubkey}:`)).toBe(live)
    expect(repository.getEvent(cached.id)).toBeUndefined()
  })

  it("notifies repository subscribers once for a persisted batch", () => {
    const first = makeEvent({id: "3".repeat(64), createdAt: 10, content: "first"})
    const second = makeEvent({id: "4".repeat(64), createdAt: 10, content: "second", kind: 1})
    const emit = vi.spyOn(repository, "emit")

    mergePersistedEvents([first, second])

    expect(emit.mock.calls.filter(call => call[0] === "update")).toHaveLength(1)
  })

  it("merges persisted provenance with relays learned after startup", () => {
    tracker.addRelay("event", "wss://live.example")

    mergePersistedRelayProvenance([
      {id: "event", relays: ["wss://cached.example", "wss://live.example"]},
    ])

    expect(Array.from(tracker.getRelays("event")).sort()).toEqual([
      "wss://cached.example",
      "wss://live.example",
    ])
  })

  it("loads persisted provenance as one tracker update", () => {
    const load = vi.spyOn(tracker, "load")

    mergePersistedRelayProvenance([
      {id: "first", relays: ["wss://one.example"]},
      {id: "second", relays: ["wss://two.example"]},
    ])

    expect(load).toHaveBeenCalledTimes(1)
  })

  it("persists provenance after the eligible event becomes observable", async () => {
    vi.useFakeTimers()
    const event = makeEvent({id: "c".repeat(64), createdAt: 30, content: "profile"})
    const eventTable = makeTable<TrustedEvent>()
    const trackerTable = makeTable<TrackerItem>()
    const stopEvents = await eventsAdapter.init(eventTable)
    const stopTracker = await trackerAdapter.init(trackerTable)

    try {
      tracker.addRelay(event.id, "wss://repo.example")
      repository.publish(event)
      await vi.advanceTimersByTimeAsync(3000)

      expect(trackerTable.bulkPut).toHaveBeenCalledWith([
        {id: event.id, relays: ["wss://repo.example"]},
      ])
    } finally {
      stopTracker()
      stopEvents()
    }
  })

  it("caches kind 32222 sibling definitions by exact d coordinate, not legacy definitions", async () => {
    vi.useFakeTimers()
    const first = makeEvent({
      id: "d".repeat(64),
      createdAt: 30,
      content: "",
      kind: 32222,
      tags: [["d", communityIdA]],
    })
    const second = makeEvent({
      id: "e".repeat(64),
      createdAt: 31,
      content: "",
      kind: 32222,
      tags: [["d", communityIdB]],
    })
    const legacy = makeEvent({
      id: "f".repeat(64),
      createdAt: 32,
      content: "",
      kind: 10222,
    })
    const eventTable = makeTable<TrustedEvent>()
    const stopEvents = await eventsAdapter.init(eventTable)

    try {
      repository.publish(first)
      repository.publish(second)
      repository.publish(legacy)
      await vi.advanceTimersByTimeAsync(3000)

      expect(
        vi.mocked(eventTable.bulkPut).mock.calls.flatMap(([events]) => Array.from(events)),
      ).toEqual([first, second])
      expect(repository.getEvent(`0:${communityIdA}:`)).toBeUndefined()
      expect(repository.getEvent(`0:${communityIdB}:`)).toBeUndefined()
    } finally {
      stopEvents()
    }
  })

  it("caches community stars only when they target kind 32222", async () => {
    vi.useFakeTimers()
    const current = makeEvent({
      id: "7".repeat(64),
      createdAt: 40,
      content: "+",
      kind: REACTION,
      tags: [["k", "32222"]],
    })
    const legacy = makeEvent({
      id: "8".repeat(64),
      createdAt: 41,
      content: "+",
      kind: REACTION,
      tags: [["k", "10222"]],
    })
    const eventTable = makeTable<TrustedEvent>()
    const stopEvents = await eventsAdapter.init(eventTable)

    try {
      repository.publish(current)
      repository.publish(legacy)
      await vi.advanceTimersByTimeAsync(3000)

      expect(
        vi.mocked(eventTable.bulkPut).mock.calls.flatMap(([events]) => Array.from(events)),
      ).toEqual([current])
    } finally {
      stopEvents()
    }
  })
})
