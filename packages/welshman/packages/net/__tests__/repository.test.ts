import {describe, it, vi, expect, beforeEach} from "vitest"
import {now, choice, range} from "@welshman/lib"
import {getAddress, makeEvent, TrustedEvent, DELETE, MUTES} from "@welshman/util"
import {Repository, setRepositoryUpdateTimingListener} from "../src/repository"

const randomHex = () =>
  Array.from(range(0, 64))
    .map(() => choice(Array.from("0123456789abcdef")))
    .join("")

const createEvent = (kind: number, extra = {}) => ({
  ...makeEvent(kind),
  pubkey: randomHex(),
  id: randomHex(),
  sig: "fake",
  ...extra,
})

describe("Repository", () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    setRepositoryUpdateTimingListener(undefined)
  })

  describe("basic operations", () => {
    let repo: Repository

    beforeEach(() => {
      repo = new Repository()
    })

    it("should publish and retrieve events", () => {
      const event = createEvent(1)
      expect(repo.publish(event)).toBe(true)
      expect(repo.getEvent(event.id)).toEqual(event)
    })

    it("should not publish invalid events", () => {
      const invalidEvent = {} as TrustedEvent
      const result = repo.publish(invalidEvent)
      expect(result).toBe(false)
    })

    it("should handle duplicate events", () => {
      const event = createEvent(1)
      expect(repo.publish(event)).toBe(true)
      expect(repo.publish(event)).toBe(false)
    })

    it("should check if events exist", () => {
      const event = createEvent(1)
      repo.publish(event)
      expect(repo.hasEvent(event)).toBe(true)
    })

    it("should emit one merged update for a nested batch", () => {
      const first = createEvent(1)
      const second = createEvent(1)
      const updateHandler = vi.fn()
      repo.on("update", updateHandler)

      repo.batch(() => {
        repo.publish(first)
        repo.batch(() => repo.publish(second))
      })

      expect(updateHandler).toHaveBeenCalledTimes(1)
      expect(updateHandler).toHaveBeenCalledWith({added: [first, second], removed: new Set()})
    })

    it("should flush a batch when its callback throws", () => {
      const event = createEvent(1)
      const updateHandler = vi.fn()
      repo.on("update", updateHandler)

      expect(() =>
        repo.batch(() => {
          repo.publish(event)
          throw new Error("stop")
        }),
      ).toThrow("stop")
      expect(updateHandler).toHaveBeenCalledTimes(1)
      expect(repo.publish(createEvent(1))).toBe(true)
      expect(updateHandler).toHaveBeenCalledTimes(2)
    })

    it("reports aggregate synchronous subscriber timing only while observed", () => {
      const timing = vi.fn()
      const stop = setRepositoryUpdateTimingListener(timing)
      const event = createEvent(1)
      const unsubscribe = repo.onUpdate(
        {name: "test-subscriber", filters: [{keys: ["kinds"], kinds: [1]}]},
        () => undefined,
      )

      repo.publish(event)

      expect(timing).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: "repository",
          added: 1,
          removed: 0,
          kinds: [1],
          listeners: 1,
          subscribers: [
            expect.objectContaining({
              id: 1,
              name: "test-subscriber",
              filters: [{keys: ["kinds"], kinds: [1]}],
              durationMs: expect.any(Number),
            }),
          ],
        }),
      )
      unsubscribe()
      repo.publish(createEvent(2))
      expect(timing).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({listeners: 0, subscribers: []}),
      )
      stop()
      repo.publish(createEvent(3))
      expect(timing).toHaveBeenCalledTimes(2)
    })

    it("finishes reporting when a subscriber removes the timing listener", () => {
      const timing = vi.fn()
      setRepositoryUpdateTimingListener(timing)
      repo.on("update", () => setRepositoryUpdateTimingListener(undefined))

      expect(() => repo.publish(createEvent(1))).not.toThrow()
      expect(timing).toHaveBeenCalledTimes(1)
    })

    it("reports the listener count from the start of an update", () => {
      const timing = vi.fn()
      setRepositoryUpdateTimingListener(timing)
      let unsubscribe = () => undefined
      unsubscribe = repo.onUpdate({name: "self-removing"}, () => unsubscribe())

      repo.publish(createEvent(1))

      expect(timing).toHaveBeenCalledWith(
        expect.objectContaining({
          listeners: 1,
          subscribers: [expect.objectContaining({name: "self-removing"})],
        }),
      )
    })

    it("reports identified subscriber timing when a listener throws", () => {
      const timing = vi.fn()
      setRepositoryUpdateTimingListener(timing)
      repo.onUpdate({name: "failing-subscriber"}, () => {
        throw new Error("listener failed")
      })

      expect(() => repo.publish(createEvent(1))).toThrow("listener failed")
      expect(timing).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          listeners: 1,
          subscribers: [expect.objectContaining({name: "failing-subscriber"})],
        }),
      )
    })

    it("routes updates by affected kind while preserving fallback listener order", () => {
      const received: string[] = []
      repo.on("update", () => received.push("raw-before"))
      repo.onRoutedUpdate({name: "kind-1"}, {kinds: [1]}, () => received.push("kind-1"))
      repo.onRoutedUpdate({name: "kind-2"}, {kinds: [2]}, () => received.push("kind-2"))
      repo.onUpdate({name: "fallback"}, () => received.push("fallback"))
      repo.on("update", () => received.push("raw-after"))

      repo.publish(createEvent(1))

      expect(received).toEqual(["raw-before", "kind-1", "fallback", "raw-after"])
    })

    it("keeps diagnostic filter summaries separate from routing behavior", () => {
      const listener = vi.fn()
      repo.onUpdate({name: "diagnostic-only", filters: [{keys: ["kinds"], kinds: [1]}]}, listener)

      repo.publish(createEvent(2))

      expect(listener).toHaveBeenCalledTimes(1)
    })

    it("reports shadow routing and only times invoked subscribers", () => {
      const timing = vi.fn()
      setRepositoryUpdateTimingListener(timing)
      repo.onRoutedUpdate({name: "matching"}, {kinds: [1]}, () => undefined)
      repo.onRoutedUpdate({name: "unrelated"}, {kinds: [2]}, () => undefined)
      repo.onUpdate({name: "fallback"}, () => undefined)

      repo.publish(createEvent(1))

      expect(timing).toHaveBeenCalledWith(
        expect.objectContaining({
          listeners: 3,
          registeredListeners: 3,
          candidateListeners: 2,
          invokedListeners: 2,
          fallbackListeners: 1,
          routedListeners: 2,
          routingStatus: "known",
          subscribers: [
            expect.objectContaining({name: "matching"}),
            expect.objectContaining({name: "fallback"}),
          ],
        }),
      )
    })

    it("does not invoke a routed-out throwing listener", () => {
      const matching = vi.fn()
      repo.onRoutedUpdate({name: "unrelated"}, {kinds: [2]}, () => {
        throw new Error("should not run")
      })
      repo.onRoutedUpdate({name: "matching"}, {kinds: [1]}, matching)

      expect(() => repo.publish(createEvent(1))).not.toThrow()
      expect(matching).toHaveBeenCalledTimes(1)
    })

    it("unions affected kinds across a nested batch", () => {
      const kind1 = vi.fn()
      const kind2 = vi.fn()
      const kind3 = vi.fn()
      repo.onRoutedUpdate({name: "kind-1"}, {kinds: [1]}, kind1)
      repo.onRoutedUpdate({name: "kind-2"}, {kinds: [2]}, kind2)
      repo.onRoutedUpdate({name: "kind-3"}, {kinds: [3]}, kind3)

      repo.batch(() => {
        repo.publish(createEvent(1))
        repo.batch(() => repo.publish(createEvent(2)))
      })

      expect(kind1).toHaveBeenCalledTimes(1)
      expect(kind2).toHaveBeenCalledTimes(1)
      expect(kind3).not.toHaveBeenCalled()
    })

    it("publishes deferred events once per burst", () => {
      vi.useFakeTimers()
      const first = createEvent(1)
      const second = createEvent(2)
      const updateHandler = vi.fn()
      repo.on("update", updateHandler)

      repo.publish(first, {deferMs: 16})
      repo.publish(second, {deferMs: 16})

      expect(repo.getEvent(first.id)).toBeUndefined()
      expect(repo.getEvent(second.id)).toBeUndefined()
      expect(updateHandler).not.toHaveBeenCalled()
      vi.advanceTimersByTime(16)
      expect(repo.getEvent(first.id)).toBe(first)
      expect(repo.getEvent(second.id)).toBe(second)
      expect(updateHandler).toHaveBeenCalledTimes(1)
      expect(updateHandler).toHaveBeenCalledWith({added: [first, second], removed: new Set()})
      vi.useRealTimers()
    })

    it("routes a deferred merged burst by every affected kind", () => {
      vi.useFakeTimers()
      const kind1 = vi.fn()
      const kind2 = vi.fn()
      const kind3 = vi.fn()
      repo.onRoutedUpdate({name: "kind-1"}, {kinds: [1]}, kind1)
      repo.onRoutedUpdate({name: "kind-2"}, {kinds: [2]}, kind2)
      repo.onRoutedUpdate({name: "kind-3"}, {kinds: [3]}, kind3)

      repo.publish(createEvent(1), {deferMs: 16})
      repo.publish(createEvent(2), {deferMs: 16})
      vi.advanceTimersByTime(16)

      expect(kind1).toHaveBeenCalledTimes(1)
      expect(kind2).toHaveBeenCalledTimes(1)
      expect(kind3).not.toHaveBeenCalled()
      vi.useRealTimers()
    })

    it("yields between bounded deferred event batches", () => {
      vi.useFakeTimers()
      const first = createEvent(1)
      const second = createEvent(2)
      const third = createEvent(3)
      const updateHandler = vi.fn()
      repo.on("update", updateHandler)

      for (const event of [first, second, third]) {
        repo.publish(event, {deferMs: 16, maxBatchSize: 2})
      }

      vi.advanceTimersByTime(16)
      expect(repo.getEvent(first.id)).toBe(first)
      expect(repo.getEvent(second.id)).toBe(second)
      expect(repo.getEvent(third.id)).toBeUndefined()
      expect(updateHandler).toHaveBeenCalledTimes(1)
      expect(updateHandler).toHaveBeenLastCalledWith({
        added: [first, second],
        removed: new Set(),
      })

      vi.advanceTimersByTime(16)
      expect(repo.getEvent(third.id)).toBe(third)
      expect(updateHandler).toHaveBeenCalledTimes(2)
      expect(updateHandler).toHaveBeenLastCalledWith({added: [third], removed: new Set()})
      vi.useRealTimers()
    })

    it("does not drain a deferred backlog for a synchronous notification", () => {
      vi.useFakeTimers()
      const deferred = createEvent(1)
      const immediate = createEvent(2)
      const updateHandler = vi.fn()
      repo.on("update", updateHandler)

      repo.publish(deferred, {deferMs: 16})
      repo.publish(immediate)

      expect(updateHandler).toHaveBeenNthCalledWith(1, {
        added: [immediate],
        removed: new Set(),
      })
      expect(repo.getEvent(deferred.id)).toBeUndefined()
      vi.advanceTimersByTime(16)
      expect(updateHandler).toHaveBeenNthCalledWith(2, {
        added: [deferred],
        removed: new Set(),
      })
      expect(updateHandler).toHaveBeenCalledTimes(2)
      vi.useRealTimers()
    })

    it("publishes silent events synchronously without notifying", () => {
      vi.useFakeTimers()
      const event = createEvent(1)
      const updateHandler = vi.fn()
      repo.on("update", updateHandler)

      repo.publish(event, {deferMs: 16, shouldNotify: false})

      expect(repo.getEvent(event.id)).toBe(event)
      expect(updateHandler).not.toHaveBeenCalled()
      vi.runAllTimers()
      expect(updateHandler).not.toHaveBeenCalled()
      vi.useRealTimers()
    })

    it("reschedules a deferred flush for a shorter requested delay", () => {
      vi.useFakeTimers()
      const first = createEvent(1)
      const second = createEvent(2)

      repo.publish(first, {deferMs: 1_000})
      vi.advanceTimersByTime(100)
      repo.publish(second, {deferMs: 0})
      vi.advanceTimersByTime(0)

      expect(repo.getEvent(first.id)).toBe(first)
      expect(repo.getEvent(second.id)).toBe(second)
      vi.useRealTimers()
    })

    it("serializes updates published reentrantly by a listener", () => {
      const first = createEvent(1)
      const nested = createEvent(2)
      const received: string[][] = []
      repo.on("update", update => {
        if (update.added[0]?.id === first.id) repo.publish(nested)
      })
      repo.on("update", update => received.push(update.added.map(event => event.id)))

      repo.publish(first)

      expect(received).toEqual([[first.id], [nested.id]])
    })

    it("preserves kind routing for serialized reentrant updates", () => {
      const first = createEvent(1)
      const nested = createEvent(2)
      const received: string[] = []
      repo.onRoutedUpdate({name: "publisher"}, {kinds: [1]}, () => {
        received.push("kind-1")
        repo.publish(nested)
      })
      repo.onRoutedUpdate({name: "nested"}, {kinds: [2]}, () => received.push("kind-2"))
      repo.on("update", update => received.push(`raw-${update.added[0]?.kind}`))

      repo.publish(first)

      expect(received).toEqual(["kind-1", "raw-1", "kind-2", "raw-2"])
    })

    it("yields during a long reentrant update chain", () => {
      vi.useFakeTimers()
      const events = Array.from({length: 20}, (_, kind) => createEvent(kind + 1))
      const received: string[] = []
      repo.on("update", update => {
        const index = events.findIndex(event => event.id === update.added[0]?.id)
        if (index >= 0 && events[index + 1]) repo.publish(events[index + 1])
      })
      repo.on("update", update => received.push(update.added[0]?.id))

      repo.publish(events[0])

      expect(received).toEqual(events.slice(0, 16).map(event => event.id))
      vi.runAllTimers()
      expect(received).toEqual(events.map(event => event.id))
      vi.useRealTimers()
    })

    it("retains reentrant updates when a listener throws", () => {
      vi.useFakeTimers()
      const first = createEvent(1)
      const nested = createEvent(2)
      const received: string[] = []
      repo.on("update", update => {
        if (update.added[0]?.id === first.id) {
          repo.publish(nested)
          throw new Error("listener failed")
        }
      })
      repo.on("update", update => received.push(update.added[0]?.id))

      expect(() => repo.publish(first)).toThrow("listener failed")
      vi.runAllTimers()

      expect(received).toEqual([nested.id])
      vi.useRealTimers()
    })

    it("absorbs deferred events into an atomic repository load", () => {
      vi.useFakeTimers()
      const persisted = createEvent(1)
      const deferred = createEvent(2)
      const updateHandler = vi.fn()
      repo.on("update", updateHandler)

      repo.publish(deferred, {deferMs: 16})
      repo.load([persisted])

      expect(repo.getEvent(persisted.id)).toBe(persisted)
      expect(repo.getEvent(deferred.id)).toBe(deferred)
      expect(updateHandler).toHaveBeenCalledTimes(1)
      expect(updateHandler).toHaveBeenCalledWith({
        added: [persisted, deferred],
        removed: new Set(),
      })
      vi.runAllTimers()
      expect(updateHandler).toHaveBeenCalledTimes(1)
      vi.useRealTimers()
    })

    it("emits only the final added state from an atomic repository load", () => {
      const pubkey = randomHex()
      const first = createEvent(MUTES, {pubkey, created_at: now() - 10})
      const replacement = createEvent(MUTES, {pubkey, created_at: now()})
      const updateHandler = vi.fn()
      repo.on("update", updateHandler)

      repo.load([first, replacement])

      expect(updateHandler).toHaveBeenCalledWith({
        added: [replacement],
        removed: new Set([first.id]),
      })
    })

    it("routes an atomic load by added and stale removed kinds", () => {
      const stale = createEvent(1)
      const added = createEvent(2)
      repo.publish(stale)
      const kind1 = vi.fn()
      const kind2 = vi.fn()
      const kind3 = vi.fn()
      repo.onRoutedUpdate({name: "kind-1"}, {kinds: [1]}, kind1)
      repo.onRoutedUpdate({name: "kind-2"}, {kinds: [2]}, kind2)
      repo.onRoutedUpdate({name: "kind-3"}, {kinds: [3]}, kind3)

      repo.load([added])

      expect(kind1).toHaveBeenCalledWith({added: [added], removed: new Set([stale.id])})
      expect(kind2).toHaveBeenCalledWith({added: [added], removed: new Set([stale.id])})
      expect(kind3).not.toHaveBeenCalled()
    })

    it("reports the final delta when an event is deleted in the same burst", () => {
      vi.useFakeTimers()
      const event = createEvent(1, {created_at: now() - 10})
      const deletion = createEvent(DELETE, {
        pubkey: event.pubkey,
        created_at: now(),
        tags: [["e", event.id]],
      })
      const updateHandler = vi.fn()
      repo.on("update", updateHandler)

      repo.publish(event, {deferMs: 16})
      repo.publish(deletion, {deferMs: 16})
      vi.advanceTimersByTime(16)

      expect(updateHandler).toHaveBeenCalledWith({
        added: [deletion],
        removed: new Set([event.id]),
      })
      vi.useRealTimers()
    })

    it("routes a deletion update by both delete and removed target kinds", () => {
      const event = createEvent(1, {created_at: now() - 10})
      const deletion = createEvent(DELETE, {
        pubkey: event.pubkey,
        created_at: now(),
        tags: [["e", event.id]],
      })
      repo.publish(event)
      const targetListener = vi.fn()
      const deleteListener = vi.fn()
      const unrelatedListener = vi.fn()
      repo.onRoutedUpdate({name: "target"}, {kinds: [1]}, targetListener)
      repo.onRoutedUpdate({name: "delete"}, {kinds: [DELETE]}, deleteListener)
      repo.onRoutedUpdate({name: "unrelated"}, {kinds: [2]}, unrelatedListener)

      repo.publish(deletion)

      const expected = {added: [deletion], removed: new Set([event.id])}
      expect(targetListener).toHaveBeenCalledWith(expected)
      expect(deleteListener).toHaveBeenCalledWith(expected)
      expect(unrelatedListener).not.toHaveBeenCalled()
    })

    it("reports the final delta when a replaceable is superseded in the same burst", () => {
      vi.useFakeTimers()
      const pubkey = randomHex()
      const first = createEvent(MUTES, {pubkey, created_at: now() - 10})
      const replacement = createEvent(MUTES, {pubkey, created_at: now()})
      const updateHandler = vi.fn()
      repo.on("update", updateHandler)

      repo.publish(first, {deferMs: 16})
      repo.publish(replacement, {deferMs: 16})
      vi.advanceTimersByTime(16)

      expect(updateHandler).toHaveBeenCalledWith({
        added: [replacement],
        removed: new Set([first.id]),
      })
      vi.useRealTimers()
    })
  })

  describe("replaceable events", () => {
    let repo: Repository

    beforeEach(() => {
      repo = new Repository()
    })

    it("should handle replaceable events", () => {
      const pubkey = randomHex()
      const event1 = createEvent(MUTES, {created_at: now() - 100, pubkey})
      const event2 = createEvent(MUTES, {created_at: now(), pubkey})

      const address1 = getAddress(event1)
      const address2 = getAddress(event2)

      repo.publish(event1)
      repo.publish(event2)

      expect(repo.getEvent(event1.id)).toEqual(event1)
      expect(repo.getEvent(address1)).toEqual(event2)
      expect(repo.getEvent(event2.id)).toEqual(event2)
      expect(repo.getEvent(address2)).toEqual(event2)

      const event3 = createEvent(MUTES, {created_at: now() - 50, pubkey})

      repo.publish(event3)

      expect(repo.getEvent(event3.id)).toBeUndefined()
    })

    it("should not replace with older events", () => {
      const event1 = createEvent(MUTES, {created_at: now()})
      const event2 = createEvent(MUTES, {created_at: now() - 100})

      repo.publish(event1)
      repo.publish(event2)

      expect(repo.getEvent(event1.id)).toEqual(event1)
    })
  })

  describe("delete events", () => {
    let repo: Repository

    beforeEach(() => {
      repo = new Repository()
    })

    it("should handle delete events", () => {
      const pubkey = randomHex()
      const event = createEvent(1, {pubkey})
      const deleteEvent = createEvent(DELETE, {
        pubkey,
        tags: [["e", event.id]],
        created_at: now() + 100,
      })

      repo.publish(event)
      repo.publish(deleteEvent)

      expect(repo.isDeleted(event)).toBe(true)
    })

    it("should handle delete by address", () => {
      const pubkey = randomHex()
      const event = createEvent(MUTES, {pubkey})
      const deleteEvent = createEvent(DELETE, {
        pubkey,
        tags: [["a", `10000:${event.pubkey}:`]],
        created_at: now() + 100,
      })

      repo.publish(event)
      repo.publish(deleteEvent)

      expect(repo.isDeletedByAddress(event)).toBe(true)
    })

    it("should ignore delete by id for replaceable events", () => {
      const pubkey = randomHex()
      const event = createEvent(MUTES, {pubkey})
      const deleteEvent = createEvent(DELETE, {
        pubkey,
        tags: [["e", event.id]],
        created_at: now() + 100,
      })

      repo.publish(event)
      repo.publish(deleteEvent)

      expect(repo.isDeleted(event)).toBe(false)
    })

    it("should keep replaced events suppressed", () => {
      const pubkey = randomHex()
      const original = createEvent(MUTES, {pubkey, created_at: now()})
      const replacement = createEvent(MUTES, {pubkey, created_at: original.created_at + 1})

      repo.publish(original)
      repo.publish(replacement)

      expect(repo.isDeleted(original)).toBe(true)
      expect(repo.isDeleted(replacement)).toBe(false)
    })

    it("should not delete events with mismatched pubkeys", () => {
      const event = createEvent(1)
      const deleteEvent = createEvent(DELETE, {tags: [["e", event.id]], created_at: now() + 1})

      repo.publish(event)
      repo.publish(deleteEvent)

      expect(repo.isDeleted(event)).toBe(false)
    })
  })

  describe("expire events", () => {
    let repo: Repository

    beforeEach(() => {
      repo = new Repository()
    })

    it("should handle expiring events", () => {
      const event1 = createEvent(1, {tags: [["expiration", String(now() - 100)]]})
      const event2 = createEvent(1, {tags: [["expiration", String(now() + 100)]]})
      const event3 = createEvent(1)

      repo.publish(event1)
      repo.publish(event2)
      repo.publish(event3)

      expect(repo.isExpired(event1)).toBe(true)
      expect(repo.isExpired(event2)).toBe(false)
      expect(repo.isExpired(event3)).toBe(false)
    })
  })

  describe("query operations", () => {
    let repo: Repository

    beforeEach(() => {
      repo = new Repository()
    })

    it("should query by ids", () => {
      const event = createEvent(1)
      repo.publish(event)

      const results = repo.query([{ids: [event.id]}])
      expect(results).toContain(event)
    })

    it("should query by authors", () => {
      const event = createEvent(1)
      repo.publish(event)

      const results = repo.query([{authors: [event.pubkey]}])
      expect(results).toContain(event)
    })

    it("should query by kinds", () => {
      const event = createEvent(1)
      repo.publish(event)

      const results = repo.query([{kinds: [1]}])
      expect(results).toContain(event)
    })

    it("should query by tags", () => {
      const pubkey = randomHex()
      const event = createEvent(1, {tags: [["p", pubkey]]})

      repo.publish(event)

      const results = repo.query([{"#p": [pubkey]}])
      expect(results).toContain(event)
    })

    it("should query by time range", () => {
      const event = createEvent(1)
      repo.publish(event)

      const results = repo.query([
        {
          since: now() - 3600,
          until: now() + 3600,
        },
      ])
      expect(results).toContain(event)
    })

    it("should handle multiple filters", () => {
      const event = createEvent(1)
      repo.publish(event)

      const results = repo.query([{kinds: [1]}, {authors: [event.pubkey]}])
      expect(results).toHaveLength(1)
      expect(results).toContain(event)
    })

    it("should respect limit parameter", () => {
      const events = [
        createEvent(1, {created_at: now()}),
        createEvent(1, {created_at: now() - 100}),
      ]

      events.forEach(e => repo.publish(e))

      const results = repo.query([{limit: 1}])
      expect(results).toHaveLength(1)
      expect(results[0]).toEqual(events[0]) // Most recent event
    })

    it("should not return deleted events", () => {
      const pubkey = randomHex()
      const event = createEvent(1, {pubkey})
      const deleteEvent = createEvent(DELETE, {
        pubkey,
        tags: [["e", event.id]],
        created_at: now() + 1,
      })

      repo.publish(event)
      repo.publish(deleteEvent)

      const results = repo.query([{kinds: [1]}])
      expect(results).not.toContain(event)
    })
  })

  describe("dump and load", () => {
    let repo: Repository

    beforeEach(() => {
      repo = new Repository()
    })

    it("should dump all events", () => {
      const event = createEvent(1)
      repo.publish(event)

      const dumped = repo.dump()
      expect(dumped).toContain(event)
    })

    it("should load events", () => {
      const event = createEvent(1)
      repo.load([event])

      expect(repo.getEvent(event.id)).toEqual(event)
    })

    it("should handle chunked loading", () => {
      const events = Array.from({length: 1500}, (_, i) => createEvent(1))

      repo.load(events, 500)
      expect(repo.dump()).toHaveLength(1500)
    })

    it("should emit update events", () => {
      const event = createEvent(1)
      const updateHandler = vi.fn()

      repo.on("update", updateHandler)
      repo.load([event])

      expect(updateHandler).toHaveBeenCalledWith({
        added: [event],
        removed: new Set(),
      })
    })
  })

  describe("event removal", () => {
    let repo: Repository

    beforeEach(() => {
      repo = new Repository()
    })

    it("should remove events", () => {
      const event = createEvent(1)
      repo.publish(event)
      repo.removeEvent(event.id)

      expect(repo.getEvent(event.id)).toBeUndefined()
    })

    it("should emit update on removal", () => {
      const event = createEvent(1)
      const updateHandler = vi.fn()

      repo.on("update", updateHandler)
      repo.publish(event)
      repo.removeEvent(event.id)

      expect(updateHandler).toHaveBeenLastCalledWith({
        added: [],
        removed: new Set([event.id]),
      })
    })

    it("routes explicit removal by the target kind", () => {
      const event = createEvent(1)
      repo.publish(event)
      const matching = vi.fn()
      const unrelated = vi.fn()
      repo.onRoutedUpdate({name: "matching"}, {kinds: [1]}, matching)
      repo.onRoutedUpdate({name: "unrelated"}, {kinds: [2]}, unrelated)

      repo.removeEvent(event.id)

      expect(matching).toHaveBeenCalledWith({added: [], removed: new Set([event.id])})
      expect(unrelated).not.toHaveBeenCalled()
    })
  })
})
