import {describe, expect, it, vi} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import type {FiniteRelayResult} from "./finite-relay-request"
import {
  buildRepoRootGapFilters,
  buildRepoRootPageFilter,
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
