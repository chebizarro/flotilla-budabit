import {deleteDB, openDB, type IDBPDatabase} from "idb"
import {verifyEvent} from "nostr-tools/pure"
import {
  Address,
  COMMENT,
  DELETE,
  GIT_ISSUE,
  GIT_STATUS_CLOSED,
  GIT_STATUS_COMPLETE,
  GIT_STATUS_DRAFT,
  GIT_STATUS_OPEN,
  REPORT,
  isRelayUrl,
  normalizeRelayUrl,
  type TrustedEvent,
} from "@welshman/util"
import {repository, tracker} from "@welshman/app"
import {
  GIT_LABEL,
  GIT_PULL_REQUEST,
  GIT_PULL_REQUEST_UPDATE,
  GIT_REPO_ANNOUNCEMENT,
  GIT_REPO_STATE,
} from "@nostr-git/core/events"
import {getRepoPublicationAddress} from "@app/core/repo-publication"
import {userRepoWatch, type RepoWatchItem} from "@app/core/repo-watch"

export const REPO_CACHE_DB_NAME = "budabit-repository-cache"
export const REPO_CACHE_DB_VERSION = 1
export const REPO_CACHE_EVENT_STORE = "repositoryEvents"
export const REPO_CACHE_REPOSITORY_STORE = "repositories"
export const REPO_CACHE_ROUTE_HYDRATION_BUDGET_MS = 250

const GIT_COVER_LETTER = 1624
const MAX_RELAY_PROVENANCE = 6

export type RepositoryCachePolicy = {
  maxRecentRepositories: number
  maxRecentAgeMs: number
  maxWatchedRepositories: number
  maxEventsPerRepository: number
  maxBytesPerRepository: number
  maxEvents: number
  maxBytes: number
  maxRecordBytes: number
  maxRelaysPerEvent: number
}

export const REPO_CACHE_POLICY: RepositoryCachePolicy = {
  maxRecentRepositories: 16,
  maxRecentAgeMs: 30 * 24 * 60 * 60 * 1000,
  maxWatchedRepositories: 50,
  maxEventsPerRepository: 2_000,
  maxBytesPerRepository: 4 * 1024 * 1024,
  maxEvents: 8_000,
  maxBytes: 16 * 1024 * 1024,
  maxRecordBytes: 512 * 1024,
  maxRelaysPerEvent: MAX_RELAY_PROVENANCE,
}

export type RepositoryCacheEventClass = "authority" | "root" | "activity" | "delete"

export type CachedRepositoryEvent = {
  key: string
  repositoryAddress: string
  event: TrustedEvent
  relays: string[]
  eventClass: RepositoryCacheEventClass
  targetIds: string[]
  cachedAt: number
  lastAccessedAt: number
  bytes: number
}

export type CachedRepository = {
  address: string
  watched: boolean
  lastAccessedAt: number
  eventCount: number
  bytes: number
}

export type RepositoryCacheState = {
  repositories: CachedRepository[]
  events: CachedRepositoryEvent[]
}

export type RepositoryCacheChanges = {
  putRepositories: CachedRepository[]
  deleteRepositories: string[]
  putEvents: CachedRepositoryEvent[]
  deleteEvents: string[]
}

export type RepositoryCacheStorage = {
  load: () => Promise<RepositoryCacheState>
  apply: (changes: RepositoryCacheChanges) => Promise<void>
  clear: () => Promise<void>
  close: () => void
}

type RepositoryCacheDependencies = {
  storage: RepositoryCacheStorage
  now?: () => number
  policy?: RepositoryCachePolicy
  verify?: (event: TrustedEvent) => boolean
  getEvent?: (idOrAddress: string) => TrustedEvent | undefined
  getEventsForRepository?: (address: string) => TrustedEvent[]
  getRelays?: (eventId: string) => string[]
  publish?: (event: TrustedEvent) => void
  addRelay?: (eventId: string, relay: string) => void
}

const supportedActivityKinds = new Set([
  COMMENT,
  GIT_PULL_REQUEST_UPDATE,
  GIT_LABEL,
  GIT_COVER_LETTER,
  GIT_STATUS_OPEN,
  GIT_STATUS_DRAFT,
  GIT_STATUS_CLOSED,
  GIT_STATUS_COMPLETE,
  REPORT,
])

const textEncoder = new TextEncoder()

export const canonicalizeRepoCacheAddress = (value: string) => {
  try {
    const address = Address.from(String(value || "").trim())
    if (address.kind !== GIT_REPO_ANNOUNCEMENT || !address.pubkey || !address.identifier) {
      return ""
    }
    return address.toString()
  } catch {
    return ""
  }
}

const toPlainEvent = (event: TrustedEvent): TrustedEvent =>
  ({
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags.map(tag => [...tag]),
    content: event.content,
    sig: event.sig,
  }) as TrustedEvent

export const verifyPlainRepositoryEvent = (event: TrustedEvent) => {
  if (!event?.sig) return false
  try {
    return verifyEvent(toPlainEvent(event) as Parameters<typeof verifyEvent>[0])
  } catch {
    return false
  }
}

const normalizeProvenance = (relays: Iterable<string>, limit: number) =>
  Array.from(
    new Set(
      Array.from(relays)
        .map(relay => {
          try {
            const normalized = normalizeRelayUrl(relay)
            return isRelayUrl(normalized) ? normalized : ""
          } catch {
            return ""
          }
        })
        .filter(Boolean),
    ),
  )
    .sort()
    .slice(0, limit)

const getDirectRepositoryAddress = (event: TrustedEvent) => {
  try {
    return {address: getRepoPublicationAddress(event), invalid: false}
  } catch {
    return {address: "", invalid: true}
  }
}

const getReferenceIds = (event: TrustedEvent) =>
  Array.from(
    new Set(
      event.tags
        .filter(tag => tag[0] === "E" || tag[0] === "e")
        .map(tag => tag[1])
        .filter(Boolean),
    ),
  ).sort()

const classifyRepositoryEvent = (event: TrustedEvent): RepositoryCacheEventClass | undefined => {
  if (event.kind === GIT_REPO_ANNOUNCEMENT || event.kind === GIT_REPO_STATE) return "authority"
  if (event.kind === GIT_ISSUE || event.kind === GIT_PULL_REQUEST) return "root"
  if (event.kind === DELETE) return "delete"
  if (supportedActivityKinds.has(event.kind)) return "activity"
  return undefined
}

const getSerializedRecordBytes = (record: Omit<CachedRepositoryEvent, "bytes">) => {
  let bytes = 0
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const next = textEncoder.encode(JSON.stringify({...record, bytes})).byteLength
    if (next === bytes) return bytes
    bytes = next
  }
  return bytes
}

const getEventRecordKey = (address: string, eventId: string) => `${address}\u0000${eventId}`

const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

const byRecentAccess = (left: CachedRepository, right: CachedRepository) =>
  right.lastAccessedAt - left.lastAccessedAt || left.address.localeCompare(right.address)

const eventClassEvictionRank: Record<RepositoryCacheEventClass, number> = {
  activity: 0,
  delete: 0,
  root: 1,
  authority: 2,
}

class IndexedDbRepositoryCacheStorage implements RepositoryCacheStorage {
  private connection?: Promise<IDBPDatabase>

  private connect() {
    this.connection ||= openDB(REPO_CACHE_DB_NAME, REPO_CACHE_DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(REPO_CACHE_EVENT_STORE)) {
          database.createObjectStore(REPO_CACHE_EVENT_STORE, {keyPath: "key"})
        }
        if (!database.objectStoreNames.contains(REPO_CACHE_REPOSITORY_STORE)) {
          database.createObjectStore(REPO_CACHE_REPOSITORY_STORE, {keyPath: "address"})
        }
      },
      blocking: () => this.close(),
      terminated: () => {
        this.connection = undefined
      },
    })
    return this.connection
  }

  async load(): Promise<RepositoryCacheState> {
    const database = await this.connect()
    const transaction = database.transaction(
      [REPO_CACHE_REPOSITORY_STORE, REPO_CACHE_EVENT_STORE],
      "readonly",
    )
    const [repositories, events] = await Promise.all([
      transaction.objectStore(REPO_CACHE_REPOSITORY_STORE).getAll(),
      transaction.objectStore(REPO_CACHE_EVENT_STORE).getAll(),
    ])
    await transaction.done
    return {
      repositories: repositories as CachedRepository[],
      events: events as CachedRepositoryEvent[],
    }
  }

  async apply(changes: RepositoryCacheChanges) {
    if (
      changes.putRepositories.length === 0 &&
      changes.deleteRepositories.length === 0 &&
      changes.putEvents.length === 0 &&
      changes.deleteEvents.length === 0
    ) {
      return
    }

    const database = await this.connect()
    const transaction = database.transaction(
      [REPO_CACHE_REPOSITORY_STORE, REPO_CACHE_EVENT_STORE],
      "readwrite",
    )
    const repositories = transaction.objectStore(REPO_CACHE_REPOSITORY_STORE)
    const events = transaction.objectStore(REPO_CACHE_EVENT_STORE)
    await Promise.all([
      ...changes.putRepositories.map(item => repositories.put(item)),
      ...changes.deleteRepositories.map(address => repositories.delete(address)),
      ...changes.putEvents.map(item => events.put(item)),
      ...changes.deleteEvents.map(key => events.delete(key)),
    ])
    await transaction.done
  }

  async clear() {
    this.close()
    if (typeof indexedDB === "undefined") return
    await deleteDB(REPO_CACHE_DB_NAME, {blocked: () => this.close()})
  }

  close() {
    const connection = this.connection
    this.connection = undefined
    void connection?.then(database => database.close()).catch(() => {})
  }
}

export class RepositoryCache {
  private readonly storage: RepositoryCacheStorage
  private readonly now: () => number
  private readonly policy: RepositoryCachePolicy
  private readonly verify: (event: TrustedEvent) => boolean
  private readonly getEvent?: (idOrAddress: string) => TrustedEvent | undefined
  private readonly getEventsForRepository?: (address: string) => TrustedEvent[]
  private readonly getRelays?: (eventId: string) => string[]
  private readonly publish?: (event: TrustedEvent) => void
  private readonly addRelay?: (eventId: string, relay: string) => void
  private readonly repositories = new Map<string, CachedRepository>()
  private readonly events = new Map<string, CachedRepositoryEvent>()
  private operation = Promise.resolve<unknown>(undefined)
  private loaded = false

  constructor(dependencies: RepositoryCacheDependencies) {
    this.storage = dependencies.storage
    this.now = dependencies.now || Date.now
    this.policy = dependencies.policy || REPO_CACHE_POLICY
    this.verify = dependencies.verify || verifyPlainRepositoryEvent
    this.getEvent = dependencies.getEvent
    this.getEventsForRepository = dependencies.getEventsForRepository
    this.getRelays = dependencies.getRelays
    this.publish = dependencies.publish
    this.addRelay = dependencies.addRelay
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operation.then(operation, operation)
    this.operation = next.catch(() => undefined)
    return next
  }

  private async ensureLoaded() {
    if (this.loaded) return
    const state = await this.storage.load()
    this.repositories.clear()
    this.events.clear()
    for (const item of state.repositories || []) {
      const address = canonicalizeRepoCacheAddress(item.address)
      if (address) this.repositories.set(address, {...item, address})
    }
    for (const item of state.events || []) {
      const address = canonicalizeRepoCacheAddress(item.repositoryAddress)
      if (!address || !item.event?.id) continue
      this.events.set(getEventRecordKey(address, item.event.id), {
        ...item,
        key: getEventRecordKey(address, item.event.id),
        repositoryAddress: address,
      })
    }
    this.loaded = true
  }

  private getCachedEvent(idOrAddress: string) {
    for (const record of this.events.values()) {
      if (record.event.id === idOrAddress) return record.event
      try {
        if (Address.fromEvent(record.event).toString() === idOrAddress) return record.event
      } catch {
        continue
      }
    }
    return undefined
  }

  private eventBelongsToRepository(
    event: TrustedEvent,
    address: string,
    visited = new Set<string>(),
  ): boolean {
    const eventClass = classifyRepositoryEvent(event)
    if (!eventClass || visited.has(event.id)) return false
    visited.add(event.id)

    const direct = getDirectRepositoryAddress(event)
    if (direct.invalid) return false
    if (direct.address) return canonicalizeRepoCacheAddress(direct.address) === address
    if (eventClass === "authority" || eventClass === "root") return false

    for (const reference of getReferenceIds(event)) {
      const target = this.getCachedEvent(reference) || this.getEvent?.(reference)
      if (
        target &&
        this.verify(target) &&
        this.eventBelongsToRepository(target, address, new Set(visited))
      ) {
        return true
      }
    }
    return false
  }

  private getEligibleAddresses(now: number) {
    const watchedCandidates = Array.from(this.repositories.values())
      .filter(item => item.watched)
      .sort(byRecentAccess)
    const watched = watchedCandidates.slice(0, this.policy.maxWatchedRepositories)
    const watchedAddresses = new Set(watched.map(item => item.address))
    for (const item of watchedCandidates.slice(this.policy.maxWatchedRepositories)) {
      this.repositories.set(item.address, {...item, watched: false})
    }
    const recent = Array.from(this.repositories.values())
      .filter(
        item =>
          !watchedAddresses.has(item.address) &&
          item.lastAccessedAt >= now - this.policy.maxRecentAgeMs,
      )
      .sort(byRecentAccess)
      .slice(0, this.policy.maxRecentRepositories)
    return new Set([...watchedAddresses, ...recent.map(item => item.address)])
  }

  private recalculateRepository(address: string) {
    const metadata = this.repositories.get(address)
    if (!metadata) return
    const records = Array.from(this.events.values()).filter(
      item => item.repositoryAddress === address,
    )
    this.repositories.set(address, {
      ...metadata,
      eventCount: records.length,
      bytes: records.reduce((total, item) => total + item.bytes, 0),
    })
  }

  private removeEvent(key: string) {
    const record = this.events.get(key)
    if (!record) return
    this.events.delete(key)
    this.recalculateRepository(record.repositoryAddress)
  }

  private getEvictionCandidates(records: CachedRepositoryEvent[]) {
    const retainedIds = new Set(records.map(item => item.event.id))
    return records
      .filter(
        record =>
          record.eventClass !== "delete" ||
          !record.targetIds.some(targetId => retainedIds.has(targetId)),
      )
      .sort(
        (left, right) =>
          eventClassEvictionRank[left.eventClass] - eventClassEvictionRank[right.eventClass] ||
          left.event.created_at - right.event.created_at ||
          left.key.localeCompare(right.key),
      )
  }

  private prune(now: number) {
    const eligible = this.getEligibleAddresses(now)
    for (const address of Array.from(this.repositories.keys())) {
      if (eligible.has(address)) continue
      this.repositories.delete(address)
      for (const [key, record] of this.events) {
        if (record.repositoryAddress === address) this.events.delete(key)
      }
    }

    for (const address of eligible) {
      this.recalculateRepository(address)
      while (true) {
        const metadata = this.repositories.get(address)
        if (
          !metadata ||
          (metadata.eventCount <= this.policy.maxEventsPerRepository &&
            metadata.bytes <= this.policy.maxBytesPerRepository)
        ) {
          break
        }
        const records = Array.from(this.events.values()).filter(
          item => item.repositoryAddress === address,
        )
        const candidate = this.getEvictionCandidates(records)[0]
        if (!candidate) break
        this.removeEvent(candidate.key)
      }
    }

    while (true) {
      const records = Array.from(this.events.values())
      const bytes = records.reduce((total, item) => total + item.bytes, 0)
      if (records.length <= this.policy.maxEvents && bytes <= this.policy.maxBytes) break
      const candidate = this.getEvictionCandidates(records).sort((left, right) => {
        const leftRepo = this.repositories.get(left.repositoryAddress)
        const rightRepo = this.repositories.get(right.repositoryAddress)
        return (
          Number(Boolean(leftRepo?.watched)) - Number(Boolean(rightRepo?.watched)) ||
          eventClassEvictionRank[left.eventClass] - eventClassEvictionRank[right.eventClass] ||
          left.event.created_at - right.event.created_at ||
          left.key.localeCompare(right.key)
        )
      })[0]
      if (!candidate) break
      this.removeEvent(candidate.key)
    }
  }

  private async persistMutation<T>(mutation: () => T | Promise<T>) {
    await this.ensureLoaded()
    const beforeRepositories = new Map(this.repositories)
    const beforeEvents = new Map(this.events)
    const value = await mutation()
    this.prune(this.now())

    const changes: RepositoryCacheChanges = {
      putRepositories: Array.from(this.repositories.values()).filter(
        item => !sameValue(beforeRepositories.get(item.address), item),
      ),
      deleteRepositories: Array.from(beforeRepositories.keys()).filter(
        address => !this.repositories.has(address),
      ),
      putEvents: Array.from(this.events.values()).filter(
        item => !sameValue(beforeEvents.get(item.key), item),
      ),
      deleteEvents: Array.from(beforeEvents.keys()).filter(key => !this.events.has(key)),
    }
    await this.storage.apply(changes)
    return value
  }

  private storeVerifiedEvent(address: string, event: TrustedEvent, relays: Iterable<string>) {
    const canonicalAddress = canonicalizeRepoCacheAddress(address)
    const metadata = this.repositories.get(canonicalAddress)
    const eventClass = classifyRepositoryEvent(event)
    if (
      !canonicalAddress ||
      !metadata ||
      !eventClass ||
      !this.verify(event) ||
      !this.eventBelongsToRepository(event, canonicalAddress)
    ) {
      return false
    }

    const plainEvent = toPlainEvent(event)
    const key = getEventRecordKey(canonicalAddress, plainEvent.id)
    const existing = this.events.get(key)
    const now = this.now()
    const recordWithoutBytes: Omit<CachedRepositoryEvent, "bytes"> = {
      key,
      repositoryAddress: canonicalAddress,
      event: plainEvent,
      relays: normalizeProvenance(
        [...(existing?.relays || []), ...Array.from(relays)],
        this.policy.maxRelaysPerEvent,
      ),
      eventClass,
      targetIds: eventClass === "delete" ? getReferenceIds(plainEvent) : [],
      cachedAt: existing?.cachedAt || now,
      lastAccessedAt: metadata.lastAccessedAt,
    }
    const bytes = getSerializedRecordBytes(recordWithoutBytes)
    if (bytes > this.policy.maxRecordBytes) return false

    this.events.set(key, {...recordWithoutBytes, bytes})
    this.recalculateRepository(canonicalAddress)
    return true
  }

  initialize() {
    return this.run(() => this.persistMutation(() => undefined))
  }

  accessRepository(address: string) {
    return this.run(() =>
      this.persistMutation(async () => {
        const canonicalAddress = canonicalizeRepoCacheAddress(address)
        if (!canonicalAddress) return false
        const existing = this.repositories.get(canonicalAddress)
        this.repositories.set(canonicalAddress, {
          address: canonicalAddress,
          watched: existing?.watched || false,
          lastAccessedAt: this.now(),
          eventCount: existing?.eventCount || 0,
          bytes: existing?.bytes || 0,
        })

        for (const event of this.getEventsForRepository?.(canonicalAddress) || []) {
          this.storeVerifiedEvent(canonicalAddress, event, this.getRelays?.(event.id) || [])
        }
        return true
      }),
    )
  }

  reconcileWatched(addresses: Iterable<string>) {
    return this.run(() =>
      this.persistMutation(async () => {
        const watched = new Set(
          Array.from(addresses).map(canonicalizeRepoCacheAddress).filter(Boolean),
        )
        for (const metadata of this.repositories.values()) {
          this.repositories.set(metadata.address, {
            ...metadata,
            watched: watched.has(metadata.address),
          })
        }
        for (const address of watched) {
          const existing = this.repositories.get(address)
          this.repositories.set(address, {
            address,
            watched: true,
            lastAccessedAt: existing?.lastAccessedAt || 0,
            eventCount: existing?.eventCount || 0,
            bytes: existing?.bytes || 0,
          })
          for (const event of this.getEventsForRepository?.(address) || []) {
            this.storeVerifiedEvent(address, event, this.getRelays?.(event.id) || [])
          }
        }
      }),
    )
  }

  storeEvent(address: string, event: TrustedEvent, relays: Iterable<string> = []) {
    return this.run(() =>
      this.persistMutation(() => this.storeVerifiedEvent(address, event, relays)),
    )
  }

  storeEventForKnownRepository(event: TrustedEvent, relays: Iterable<string> = []) {
    return this.run(() =>
      this.persistMutation(() => {
        const direct = getDirectRepositoryAddress(event)
        if (direct.invalid) return false
        if (direct.address) return this.storeVerifiedEvent(direct.address, event, relays)

        for (const metadata of this.repositories.values()) {
          if (this.eventBelongsToRepository(event, metadata.address)) {
            return this.storeVerifiedEvent(metadata.address, event, relays)
          }
        }
        return false
      }),
    )
  }

  hydrateEligible() {
    return this.run(() =>
      this.persistMutation(() => {
        const eligible = this.getEligibleAddresses(this.now())
        return this.hydrateAddresses(eligible)
      }),
    )
  }

  hydrateRepository(address: string) {
    return this.run(() =>
      this.persistMutation(() => {
        const canonicalAddress = canonicalizeRepoCacheAddress(address)
        return this.hydrateAddresses(canonicalAddress ? new Set([canonicalAddress]) : new Set())
      }),
    )
  }

  private hydrateAddresses(addresses: Set<string>) {
    const records = Array.from(this.events.values())
      .filter(record => addresses.has(record.repositoryAddress))
      .sort(
        (left, right) =>
          Number(left.eventClass === "delete") - Number(right.eventClass === "delete") ||
          left.event.created_at - right.event.created_at ||
          left.key.localeCompare(right.key),
      )
    let hydrated = 0

    for (const record of records) {
      const eventClass = classifyRepositoryEvent(record.event)
      if (
        !eventClass ||
        !this.verify(record.event) ||
        !this.eventBelongsToRepository(record.event, record.repositoryAddress)
      ) {
        this.removeEvent(record.key)
        continue
      }
      const event = toPlainEvent(record.event)
      const recordWithoutBytes: Omit<CachedRepositoryEvent, "bytes"> = {
        ...record,
        event,
        relays: normalizeProvenance(record.relays, this.policy.maxRelaysPerEvent),
        eventClass,
        targetIds: eventClass === "delete" ? getReferenceIds(event) : [],
      }
      const bytes = getSerializedRecordBytes(recordWithoutBytes)
      if (bytes > this.policy.maxRecordBytes) {
        this.removeEvent(record.key)
        continue
      }
      const sanitizedRecord = {...recordWithoutBytes, bytes}
      this.events.set(record.key, sanitizedRecord)
      this.recalculateRepository(record.repositoryAddress)

      this.publish?.(event)
      for (const relay of sanitizedRecord.relays) {
        this.addRelay?.(record.event.id, relay)
      }
      hydrated += 1
    }
    return hydrated
  }

  getState() {
    return this.run(async () => {
      await this.ensureLoaded()
      return {
        repositories: Array.from(this.repositories.values()),
        events: Array.from(this.events.values()),
      } satisfies RepositoryCacheState
    })
  }

  clear() {
    return this.run(async () => {
      this.repositories.clear()
      this.events.clear()
      this.loaded = true
      await this.storage.clear()
    })
  }

  close() {
    this.storage.close()
  }
}

const getCanonicalRepositoryEvents = (address: string) => {
  const parsed = Address.from(address)
  const coordinateEvents = repository.query(
    [
      {kinds: [GIT_REPO_ANNOUNCEMENT], authors: [parsed.pubkey], "#d": [parsed.identifier]},
      {kinds: [GIT_REPO_STATE], authors: [parsed.pubkey], "#d": [parsed.identifier]},
      {"#a": [address]},
      {"#q": [address]},
    ],
    {shouldSort: false},
  ) as TrustedEvent[]
  const rootIds = coordinateEvents
    .filter(event => event.kind === GIT_ISSUE || event.kind === GIT_PULL_REQUEST)
    .map(event => event.id)
  const rootEvents =
    rootIds.length > 0
      ? (repository.query([{"#E": rootIds}, {"#e": rootIds}], {
          shouldSort: false,
        }) as TrustedEvent[])
      : []
  return Array.from(
    new Map([...coordinateEvents, ...rootEvents].map(event => [event.id, event])).values(),
  )
}

export const repositoryCache = new RepositoryCache({
  storage: new IndexedDbRepositoryCacheStorage(),
  getEvent: idOrAddress => repository.getEvent(idOrAddress) as TrustedEvent | undefined,
  getEventsForRepository: getCanonicalRepositoryEvents,
  getRelays: eventId => Array.from(tracker.getRelays(eventId) || []),
  publish: event => {
    if (!repository.hasEvent(event)) repository.publish(event)
  },
  addRelay: (eventId, relay) => {
    if (!tracker.hasRelay(eventId, relay)) tracker.addRelay(eventId, relay)
  },
})

const pendingEvents = new Map<
  string,
  {event: TrustedEvent; relays: Set<string>; address?: string}
>()
let pendingEventTimer: ReturnType<typeof setTimeout> | undefined

const flushPendingEvents = () => {
  pendingEventTimer = undefined
  const pending = Array.from(pendingEvents.values())
  pendingEvents.clear()
  for (const item of pending) {
    const pending = item.address
      ? repositoryCache.storeEvent(item.address, item.event, item.relays)
      : repositoryCache.storeEventForKnownRepository(item.event, item.relays)
    void pending.catch(error => console.warn("[repo-cache] Failed to store event", error))
  }
}

export const receiveRepositoryCacheEvent = (
  event: TrustedEvent,
  relay?: string,
  repositoryAddress?: string,
) => {
  const existing = pendingEvents.get(event.id)
  const relays = existing?.relays || new Set<string>()
  if (relay) relays.add(relay)
  pendingEvents.set(event.id, {
    event,
    relays,
    address: repositoryAddress || existing?.address,
  })
  pendingEventTimer ||= setTimeout(flushPendingEvents, 100)
}

const getWatchedAddresses = (item?: RepoWatchItem) => Object.keys(item?.values.repos || {})

export const setupRepositoryCache = () => {
  let stopped = false
  const unsubscribeWatch = userRepoWatch.subscribe(item => {
    if (!item || stopped) return
    void repositoryCache
      .reconcileWatched(getWatchedAddresses(item))
      .then(() => repositoryCache.hydrateEligible())
      .catch(error => console.warn("[repo-cache] Failed to reconcile watched repositories", error))
  })
  const onRepositoryUpdate = (update: {added: Set<TrustedEvent>}) => {
    for (const event of update.added || []) {
      receiveRepositoryCacheEvent(event, Array.from(tracker.getRelays(event.id) || [])[0])
    }
  }
  repository.on("update", onRepositoryUpdate)

  const startupTimer = setTimeout(() => {
    if (!stopped) {
      void repositoryCache
        .hydrateEligible()
        .catch(error => console.warn("[repo-cache] Failed to hydrate eligible repositories", error))
    }
  }, 0)

  return () => {
    stopped = true
    clearTimeout(startupTimer)
    unsubscribeWatch()
    repository.off("update", onRepositoryUpdate)
    if (pendingEventTimer) clearTimeout(pendingEventTimer)
    pendingEventTimer = undefined
    pendingEvents.clear()
    repositoryCache.close()
  }
}

export const accessRepositoryCache = async (address: string) => {
  const hydration = repositoryCache.hydrateRepository(address)
  let timedOut = false
  const hydrated = await Promise.race([
    hydration,
    new Promise<undefined>(resolve =>
      setTimeout(() => {
        timedOut = true
        resolve(undefined)
      }, REPO_CACHE_ROUTE_HYDRATION_BUDGET_MS),
    ),
  ])
  void repositoryCache
    .accessRepository(address)
    .catch(error => console.warn("[repo-cache] Failed to record repository access", error))
  return {hydrated: hydrated ?? 0, timedOut, completion: hydration}
}

export const clearRepositoryCache = () => repositoryCache.clear()
