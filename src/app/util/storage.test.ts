import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {repository, tracker} from "@welshman/app"
import type {TrustedEvent} from "@welshman/util"
import type {IDBTable} from "@lib/indexeddb"
import {
  eventsAdapter,
  mergePersistedEvents,
  mergePersistedRelayProvenance,
  trackerAdapter,
  type TrackerItem,
} from "./storage"

const pubkey = "1".repeat(64)
const makeEvent = ({id, createdAt, content}: {id: string; createdAt: number; content: string}) =>
  ({
    id,
    pubkey,
    created_at: createdAt,
    kind: 0,
    tags: [],
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
})
