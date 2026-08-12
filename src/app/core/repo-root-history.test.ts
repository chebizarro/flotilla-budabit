import {describe, expect, it, vi} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import type {FiniteRelayResult} from "./finite-relay-request"
import {
  buildRepoRootGapFilters,
  buildRepoRootPageFilter,
  createRepoRootResolver,
  createRepoRootHistory,
} from "./repo-root-history"

const address = `30617:${"a".repeat(64)}:repo`
const makeEvent = (id: string, createdAt: number): TrustedEvent => ({
  id: id.repeat(64),
  pubkey: "b".repeat(64),
  created_at: createdAt,
  kind: 1621,
  tags: [["a", address]],
  content: id,
  sig: "c".repeat(128),
})
const makeRootEvent = ({
  id,
  kind = 1621,
  addresses = [address],
}: {
  id: string
  kind?: number
  addresses?: string[]
}): TrustedEvent => ({
  ...makeEvent(id, 10),
  kind,
  tags: addresses.map(value => ["a", value]),
})

const result = (
  relay: string,
  outcome: FiniteRelayResult["outcome"],
  events: TrustedEvent[] = [],
): FiniteRelayResult => ({
  relay,
  outcome,
  events,
  queuedAt: 0,
  finishedAt: 1,
})

describe("repository root history", () => {
  it("builds bounded page and complete compatibility filters", () => {
    expect(buildRepoRootPageFilter({addresses: [address], pageSize: 100, until: 50})).toEqual({
      kinds: [1621, 1618],
      "#a": [address],
      limit: 100,
      until: 50,
    })
    const filters = buildRepoRootGapFilters(["root"])
    expect(filters).toEqual(
      expect.arrayContaining([
        {kinds: [1111], "#E": ["root"]},
        {kinds: [1111], "#e": ["root"]},
        {kinds: [1619], "#E": ["root"]},
        expect.objectContaining({"#e": ["root"]}),
        {kinds: [5], "#e": ["root"]},
      ]),
    )
  })

  it("tracks relay cursors independently and exhausts empty EOSE relays", async () => {
    const calls: any[] = []
    const requestFiniteRelay = vi.fn(async (options: any) => {
      calls.push(options)
      if (options.relay === "wss://empty") return result(options.relay, "eose")
      return result(options.relay, "eose", [makeEvent("1", 20), makeEvent("2", 10)])
    })
    const snapshots: any[] = []
    const history = createRepoRootHistory({requestFiniteRelay})({
      relays: ["wss://empty", "wss://full"],
      addresses: [address],
      signal: new AbortController().signal,
      pageSize: 2,
      priority: 100,
      onEvent: vi.fn(),
      onState: snapshot => snapshots.push(snapshot),
    })

    await history.loadRecent()

    const empty = history.getSnapshot().relays.find(item => item.relay === "wss://empty")
    const full = history.getSnapshot().relays.find(item => item.relay === "wss://full")
    expect(empty).toMatchObject({exhausted: true, outcome: "eose"})
    expect(full).toMatchObject({until: 10, exhausted: false})
    expect(history.getSnapshot()).toMatchObject({status: "complete", hasOlder: true})
    expect(calls).toHaveLength(2)
  })

  it("marks non-EOSE relay outcomes partial instead of empty", async () => {
    const history = createRepoRootHistory({
      requestFiniteRelay: vi.fn(async options => result(options.relay, "timeout")),
    })({
      relays: ["wss://slow"],
      addresses: [address],
      signal: new AbortController().signal,
      priority: 100,
      onEvent: vi.fn(),
      onState: vi.fn(),
    })

    await history.loadRecent()

    expect(history.getSnapshot()).toMatchObject({status: "partial", exhausted: false})
  })

  it("keeps the inclusive boundary and marks a saturated timestamp partial", async () => {
    const requestFiniteRelay = vi.fn(async options =>
      result(options.relay, "eose", [makeEvent("1", 10), makeEvent("2", 10)]),
    )
    const history = createRepoRootHistory({requestFiniteRelay})({
      relays: ["wss://same-time"],
      addresses: [address],
      signal: new AbortController().signal,
      pageSize: 2,
      priority: 100,
      onEvent: vi.fn(),
      onState: vi.fn(),
    })

    await history.loadRecent()
    await history.loadOlder()

    expect(requestFiniteRelay.mock.calls[1][0].filters[0].until).toBe(10)
    expect(history.getSnapshot().relays[0]).toMatchObject({
      until: 10,
      boundarySaturated: true,
      status: "partial",
    })
  })
})

describe("repository root resolution", () => {
  const relay = "wss://repo"
  const foreignAddress = `30617:${"f".repeat(64)}:foreign`

  const makeResolver = ({
    requestFiniteRelay = vi.fn(async options => result(options.relay, "eose")),
    cached = new Map<string, TrustedEvent>(),
    signal = new AbortController().signal,
    relays = [relay],
    loadGap = vi.fn(async () => [result(relay, "eose")]),
    onEvent = vi.fn(),
  }: {
    requestFiniteRelay?: ReturnType<typeof vi.fn>
    cached?: Map<string, TrustedEvent>
    signal?: AbortSignal
    relays?: string[]
    loadGap?: ReturnType<typeof vi.fn>
    onEvent?: ReturnType<typeof vi.fn>
  } = {}) => ({
    ensureRoot: createRepoRootResolver({requestFiniteRelay})({
      getRelays: () => relays,
      getAddresses: () => [address],
      signal,
      priority: 100,
      getEvent: id => cached.get(id),
      isDeleted: () => false,
      onEvent,
      loadGap,
    }),
    requestFiniteRelay,
    loadGap,
    onEvent,
  })

  it("uses the canonical synchronous fast path and awaits gap-fill", async () => {
    const root = makeRootEvent({id: "3"})
    const harness = makeResolver({cached: new Map([[root.id, root]])})

    await expect(harness.ensureRoot(root.id)).resolves.toEqual({
      status: "complete",
      requestedId: root.id,
      rootId: root.id,
      rootKind: 1621,
    })
    expect(harness.requestFiniteRelay).not.toHaveBeenCalled()
    expect(harness.loadGap).toHaveBeenCalledWith(root.id)
  })

  it("rejects foreign and conflicting exact roots before projection", async () => {
    const foreign = makeRootEvent({id: "4", addresses: [foreignAddress]})
    const conflicting = makeRootEvent({id: "5", addresses: [address, foreignAddress]})
    const requestFiniteRelay = vi
      .fn()
      .mockResolvedValueOnce(result(relay, "eose", [foreign]))
      .mockResolvedValueOnce(result(relay, "eose", [conflicting]))
    const harness = makeResolver({requestFiniteRelay})

    await expect(harness.ensureRoot(foreign.id)).resolves.toEqual({
      status: "complete",
      requestedId: foreign.id,
    })
    await expect(harness.ensureRoot(conflicting.id)).resolves.toEqual({
      status: "complete",
      requestedId: conflicting.id,
    })
    expect(harness.onEvent).not.toHaveBeenCalled()
    expect(harness.loadGap).not.toHaveBeenCalled()
  })

  it("resolves an accepted pull request update to its accepted root", async () => {
    const root = makeRootEvent({id: "6", kind: 1618})
    const update = {
      ...makeRootEvent({id: "7", kind: 1619}),
      tags: [
        ["a", address],
        ["e", root.id, "", "root"],
      ],
    }
    const requestFiniteRelay = vi.fn(async options =>
      result(options.relay, "eose", options.filters[0].ids?.[0] === update.id ? [update] : [root]),
    )
    const harness = makeResolver({requestFiniteRelay})

    await expect(harness.ensureRoot(update.id)).resolves.toMatchObject({
      status: "complete",
      requestedId: update.id,
      rootId: root.id,
      rootKind: 1618,
    })
    expect(harness.requestFiniteRelay).toHaveBeenCalledTimes(2)
    expect(harness.loadGap).toHaveBeenCalledWith(root.id)
  })

  it("reports unavailable, partial, failed, and aborted outcomes", async () => {
    const unavailable = makeResolver({relays: []})
    await expect(unavailable.ensureRoot("8".repeat(64))).resolves.toMatchObject({
      status: "unavailable",
    })

    const partial = makeResolver({
      requestFiniteRelay: vi.fn(async options => result(options.relay, "timeout")),
    })
    await expect(partial.ensureRoot("9".repeat(64))).resolves.toMatchObject({status: "partial"})

    const failed = makeResolver({
      requestFiniteRelay: vi.fn(async options => result(options.relay, "error")),
    })
    await expect(failed.ensureRoot("a".repeat(64))).resolves.toMatchObject({status: "failed"})

    const controller = new AbortController()
    controller.abort()
    const aborted = makeResolver({signal: controller.signal})
    await expect(aborted.ensureRoot("b".repeat(64))).resolves.toMatchObject({status: "aborted"})
  })

  it("coalesces concurrent requests without caching retryable results", async () => {
    let resolveRequest: ((value: FiniteRelayResult) => void) | undefined
    let callCount = 0
    const requestFiniteRelay = vi.fn(options => {
      callCount += 1
      if (callCount > 1) return Promise.resolve(result(options.relay, "timeout"))
      return new Promise<FiniteRelayResult>(resolve => {
        resolveRequest = resolve
      })
    })
    const harness = makeResolver({requestFiniteRelay})
    const id = "c".repeat(64)
    const first = harness.ensureRoot(id)
    const second = harness.ensureRoot(id)

    expect(requestFiniteRelay).toHaveBeenCalledTimes(1)
    resolveRequest?.(result(relay, "timeout"))
    await expect(Promise.all([first, second])).resolves.toEqual([
      {status: "partial", requestedId: id},
      {status: "partial", requestedId: id},
    ])

    await harness.ensureRoot(id)
    expect(requestFiniteRelay).toHaveBeenCalledTimes(2)
  })
})
