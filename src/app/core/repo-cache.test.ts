import {finalizeEvent} from "nostr-tools/pure"
import {describe, expect, it, vi} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {
  REPO_CACHE_POLICY,
  RepositoryCache,
  canonicalizeRepoCacheAddress,
  verifyPlainRepositoryEvent,
  type CachedRepositoryEvent,
  type RepositoryCacheChanges,
  type RepositoryCachePolicy,
  type RepositoryCacheState,
  type RepositoryCacheStorage,
} from "./repo-cache"

const secretKey = new Uint8Array(32).fill(7)
const owner = finalizeEvent({kind: 1, created_at: 1, tags: [], content: "owner"}, secretKey).pubkey
const address = `30617:${owner}:repo`
const otherAddress = `30617:${owner}:other`

const signEvent = (
  kind: number,
  tags: string[][],
  content = "event",
  createdAt = 10,
): TrustedEvent =>
  finalizeEvent({kind, tags, content, created_at: createdAt}, secretKey) as unknown as TrustedEvent

const announcement = (repoAddress = address, createdAt = 1) => {
  const [, , identifier] = repoAddress.split(":")
  return signEvent(30617, [["d", identifier]], "repo", createdAt)
}

const issue = (createdAt = 10, repoAddress = address) =>
  signEvent(1621, [["a", repoAddress]], `issue-${createdAt}`, createdAt)

class MemoryStorage implements RepositoryCacheStorage {
  state: RepositoryCacheState
  applyCount = 0

  constructor(state: RepositoryCacheState = {repositories: [], events: []}) {
    this.state = structuredClone(state)
  }

  async load() {
    return structuredClone(this.state)
  }

  async apply(changes: RepositoryCacheChanges) {
    this.applyCount += 1
    const repositories = new Map(this.state.repositories.map(item => [item.address, item]))
    const events = new Map(this.state.events.map(item => [item.key, item]))
    for (const address of changes.deleteRepositories) repositories.delete(address)
    for (const item of changes.putRepositories)
      repositories.set(item.address, structuredClone(item))
    for (const key of changes.deleteEvents) events.delete(key)
    for (const item of changes.putEvents) events.set(item.key, structuredClone(item))
    this.state = {
      repositories: Array.from(repositories.values()),
      events: Array.from(events.values()),
    }
  }

  async clear() {
    this.state = {repositories: [], events: []}
  }

  close() {}
}

const policy = (overrides: Partial<RepositoryCachePolicy> = {}): RepositoryCachePolicy => ({
  ...REPO_CACHE_POLICY,
  ...overrides,
})

const makeCache = ({
  storage = new MemoryStorage(),
  now = () => 1_000,
  cachePolicy,
  verify,
  getEvent,
  publish,
  addRelay,
}: {
  storage?: MemoryStorage
  now?: () => number
  cachePolicy?: RepositoryCachePolicy
  verify?: (event: TrustedEvent) => boolean
  getEvent?: (id: string) => TrustedEvent | undefined
  publish?: (event: TrustedEvent) => void
  addRelay?: (eventId: string, relay: string) => void
} = {}) => ({
  cache: new RepositoryCache({
    storage,
    now,
    policy: cachePolicy,
    verify,
    getEvent,
    publish,
    addRelay,
  }),
  storage,
})

describe("repository cache", () => {
  it("canonicalizes repository addresses and independently verifies plain events", () => {
    expect(canonicalizeRepoCacheAddress(address)).toBe(address)
    expect(canonicalizeRepoCacheAddress(`1:${owner}:repo`)).toBe("")
    expect(canonicalizeRepoCacheAddress("not-an-address")).toBe("")

    const event = issue()
    expect(verifyPlainRepositoryEvent(event)).toBe(true)
    expect(verifyPlainRepositoryEvent({...event, content: "tampered"})).toBe(false)
  })

  it("rejects invalid and foreign events before persistence", async () => {
    const {cache, storage} = makeCache()
    await cache.accessRepository(address)
    const valid = issue()

    await expect(cache.storeEvent(address, valid, ["wss://relay.example"])).resolves.toBe(true)
    await expect(
      cache.storeEvent(address, {...valid, content: "tampered"}, ["wss://relay.example"]),
    ).resolves.toBe(false)
    await expect(cache.storeEvent(address, issue(11, otherAddress))).resolves.toBe(false)

    expect(storage.state.events).toHaveLength(1)
    expect(storage.state.events[0].event.id).toBe(valid.id)
  })

  it("keeps writes idempotent and bounds normalized provenance", async () => {
    const {cache, storage} = makeCache()
    await cache.accessRepository(address)
    const event = issue()
    const relays = Array.from({length: 8}, (_, index) => `wss://relay-${index}.example`)

    await cache.storeEvent(address, event, relays.slice(0, 4))
    await cache.storeEvent(address, event, [...relays.slice(3), "invalid"])

    expect(storage.state.events).toHaveLength(1)
    expect(storage.state.events[0].relays).toHaveLength(6)
    expect(storage.state.events[0].relays).toEqual([...storage.state.events[0].relays].sort())
  })

  it("verifies again on hydration and deletes corrupted records", async () => {
    const first = makeCache()
    await first.cache.accessRepository(address)
    await first.cache.storeEvent(address, issue())
    const corruptedState = structuredClone(first.storage.state)
    corruptedState.events[0].event.content = "corrupted after write"
    const storage = new MemoryStorage(corruptedState)
    const publish = vi.fn()
    const second = makeCache({storage, publish})

    await expect(second.cache.hydrateEligible()).resolves.toBe(0)
    expect(publish).not.toHaveBeenCalled()
    expect(storage.state.events).toHaveLength(0)
  })

  it("hydrates into canonical publish and provenance sinks", async () => {
    const first = makeCache()
    await first.cache.accessRepository(address)
    const event = issue()
    await first.cache.storeEvent(address, event, ["wss://one.example", "wss://two.example"])
    const publish = vi.fn()
    const addRelay = vi.fn()
    const second = makeCache({storage: first.storage, publish, addRelay})

    await expect(second.cache.hydrateEligible()).resolves.toBe(1)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({id: event.id}))
    expect(addRelay).toHaveBeenCalledTimes(2)
  })

  it("hydrates only authority records for the repository list", async () => {
    const first = makeCache()
    await first.cache.accessRepository(address)
    const repoAnnouncement = announcement()
    const root = issue()
    await first.cache.storeEvent(address, repoAnnouncement)
    await first.cache.storeEvent(address, root)
    const publish = vi.fn()
    const second = makeCache({storage: first.storage, publish})

    await expect(second.cache.hydrateEligibleAnnouncements()).resolves.toBe(1)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({id: repoAnnouncement.id}))
    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({id: root.id}))
  })

  it("stores pending event batches in one cache mutation", async () => {
    const {cache, storage} = makeCache()
    await cache.accessRepository(address)
    const before = storage.applyCount

    await cache.storeEvents([
      {address, event: issue(1), relays: []},
      {address, event: issue(2), relays: []},
    ])

    expect(storage.applyCount - before).toBe(1)
    expect(storage.state.events).toHaveLength(2)
  })

  it("retains deterministic recent and watched eligibility independently", async () => {
    let currentTime = 10_000
    const cachePolicy = policy({
      maxRecentRepositories: 2,
      maxWatchedRepositories: 2,
      maxRecentAgeMs: 100,
    })
    const {cache, storage} = makeCache({now: () => currentTime, cachePolicy})
    const addresses = ["a", "b", "c", "d", "e", "f"].map(id => `30617:${owner}:${id}`)
    for (const repoAddress of addresses.slice(0, 3)) {
      await cache.accessRepository(repoAddress)
      currentTime += 1
    }
    await cache.reconcileWatched(addresses.slice(3))

    expect(storage.state.repositories.map(item => item.address).sort()).toEqual(
      [addresses[1], addresses[2], addresses[3], addresses[4]].sort(),
    )

    currentTime += 101
    await cache.initialize()
    expect(storage.state.repositories.map(item => item.address).sort()).toEqual(
      addresses.slice(3, 5).sort(),
    )
  })

  it("enforces per-repository and global event limits deterministically", async () => {
    const cachePolicy = policy({
      maxEventsPerRepository: 2,
      maxBytesPerRepository: Number.MAX_SAFE_INTEGER,
      maxEvents: 3,
      maxBytes: Number.MAX_SAFE_INTEGER,
    })
    const {cache, storage} = makeCache({cachePolicy})
    await cache.accessRepository(address)
    await cache.accessRepository(otherAddress)

    for (const event of [issue(3), issue(1), issue(2)]) await cache.storeEvent(address, event)
    await cache.storeEvent(otherAddress, issue(4, otherAddress))
    await cache.storeEvent(otherAddress, issue(5, otherAddress))

    const byAddress = Map.groupBy(storage.state.events, item => item.repositoryAddress)
    expect(
      byAddress
        .get(address)
        ?.map(item => item.event.created_at)
        .sort(),
    ).toEqual([3])
    expect(
      byAddress
        .get(otherAddress)
        ?.map(item => item.event.created_at)
        .sort(),
    ).toEqual([4, 5])
    expect(storage.state.events).toHaveLength(3)
  })

  it("enforces per-repository and global byte limits independent of insertion order", async () => {
    const events = [issue(1), issue(2), issue(3)]
    const measure = makeCache()
    await measure.cache.accessRepository(address)
    for (const event of events) await measure.cache.storeEvent(address, event)
    const retainedBytes = measure.storage.state.events
      .filter(item => item.event.created_at >= 2)
      .reduce((total, item) => total + item.bytes, 0)
    const oneRecordBytes = measure.storage.state.events[0].bytes
    const otherMeasure = makeCache()
    await otherMeasure.cache.accessRepository(otherAddress)
    await otherMeasure.cache.storeEvent(otherAddress, issue(2, otherAddress))
    const globalBytes = Math.max(oneRecordBytes, otherMeasure.storage.state.events[0].bytes)

    const runPerRepository = async (ordered: TrustedEvent[]) => {
      const harness = makeCache({
        cachePolicy: policy({
          maxEventsPerRepository: Number.MAX_SAFE_INTEGER,
          maxBytesPerRepository: retainedBytes,
        }),
      })
      await harness.cache.accessRepository(address)
      for (const event of ordered) await harness.cache.storeEvent(address, event)
      return harness.storage.state.events.map(item => item.event.id).sort()
    }

    expect(await runPerRepository(events)).toEqual(await runPerRepository([...events].reverse()))
    expect(await runPerRepository(events)).toEqual(
      events
        .slice(1)
        .map(event => event.id)
        .sort(),
    )

    const global = makeCache({
      cachePolicy: policy({
        maxBytes: globalBytes,
        maxEvents: Number.MAX_SAFE_INTEGER,
        maxBytesPerRepository: Number.MAX_SAFE_INTEGER,
      }),
    })
    await global.cache.accessRepository(address)
    await global.cache.accessRepository(otherAddress)
    await global.cache.storeEvent(address, issue(1))
    const newest = issue(2, otherAddress)
    await global.cache.storeEvent(otherAddress, newest)

    expect(global.storage.state.events).toHaveLength(1)
    expect(global.storage.state.events[0].event.id).toBe(newest.id)
  })

  it("retains delete evidence while its cached target survives", async () => {
    const cachePolicy = policy({
      maxEventsPerRepository: 2,
      maxBytesPerRepository: Number.MAX_SAFE_INTEGER,
    })
    const root = issue(5)
    const deletion = signEvent(5, [
      ["a", address],
      ["e", root.id],
    ])
    const olderActivity = signEvent(
      1111,
      [
        ["a", address],
        ["e", root.id],
      ],
      "comment",
      1,
    )
    const {cache, storage} = makeCache({cachePolicy})
    await cache.accessRepository(address)
    await cache.storeEvent(address, root)
    await cache.storeEvent(address, deletion)
    await cache.storeEvent(address, olderActivity)

    expect(storage.state.events.map(item => item.event.id)).toContain(root.id)
    expect(storage.state.events.map(item => item.event.id)).toContain(deletion.id)
    expect(storage.state.events.map(item => item.event.id)).not.toContain(olderActivity.id)
  })

  it("retains a multi-target delete while any cached target survives", async () => {
    const firstRoot = issue(5)
    const secondRoot = issue(6)
    const deletion = signEvent(5, [
      ["a", address],
      ["e", firstRoot.id],
      ["e", secondRoot.id],
    ])
    const {cache, storage} = makeCache({
      cachePolicy: policy({
        maxEventsPerRepository: 2,
        maxBytesPerRepository: Number.MAX_SAFE_INTEGER,
      }),
    })
    await cache.accessRepository(address)
    await cache.storeEvent(address, firstRoot)
    await cache.storeEvent(address, secondRoot)
    await cache.storeEvent(address, deletion)

    expect(storage.state.events.map(item => item.event.id)).toContain(deletion.id)
    expect(
      storage.state.events.some(
        item => item.event.id === firstRoot.id || item.event.id === secondRoot.id,
      ),
    ).toBe(true)
  })

  it("rejects oversized records and pruning never invokes an in-memory removal sink", async () => {
    const removeEvent = vi.fn()
    const {cache, storage} = makeCache({
      cachePolicy: policy({maxRecordBytes: 100, maxEventsPerRepository: 1}),
      publish: vi.fn(),
    })
    ;(
      cache as unknown as {removeEventFromRepository?: typeof removeEvent}
    ).removeEventFromRepository = removeEvent
    await cache.accessRepository(address)
    await expect(cache.storeEvent(address, issue(1))).resolves.toBe(false)

    expect(storage.state.events).toHaveLength(0)
    expect(removeEvent).not.toHaveBeenCalled()
  })

  it("stores legacy root activity only when its accepted root is known", async () => {
    const root = issue()
    const comment = signEvent(1111, [["e", root.id]], "legacy comment", 11)
    const knownEvents = new Map([[root.id, root]])
    const {cache, storage} = makeCache({getEvent: id => knownEvents.get(id)})
    await cache.accessRepository(address)

    await expect(cache.storeEvent(address, comment)).resolves.toBe(true)
    expect(storage.state.events[0].event.id).toBe(comment.id)
  })
})
