import {describe, expect, it, vi} from "vitest"
import type {Filter, TrustedEvent} from "@welshman/util"
import type {FiniteRelayResult} from "./finite-relay-request"
import {inventoryGitDeletion} from "./git-deletion-inventory"

const owner = "a".repeat(64)
const repo = `30617:${owner}:project`
const makeEvent = (id: string, kind: number, tags: string[][], pubkey = owner): TrustedEvent => ({
  id: id.repeat(64).slice(0, 64),
  pubkey,
  kind,
  tags,
  created_at: 10,
  content: "",
  sig: "c".repeat(128),
})
const issue = makeEvent("1", 1621, [["a", repo]])
const result = (
  relay: string,
  events: TrustedEvent[],
  outcome: FiniteRelayResult["outcome"] = "eose",
): FiniteRelayResult => ({
  relay,
  events,
  outcome,
  queuedAt: 1,
  startedAt: 2,
  finishedAt: 3,
})

describe("Git deletion inventory", () => {
  it("runs finite per-relay issue rounds, classifies counts, and remains partial for mixed outcomes", async () => {
    const label = makeEvent("2", 1985, [["e", issue.id]])
    const foreign = makeEvent("3", 1111, [["E", issue.id]], "b".repeat(64))
    const reaction = makeEvent("4", 7, [
      ["e", label.id],
      ["k", "1985"],
    ])
    const request = vi.fn(async ({relay, filters}: {relay: string; filters: Filter[]}) => {
      const reactionRound = filters.some(filter => filter.kinds?.includes(7))
      return result(
        relay,
        reactionRound ? [reaction] : [label, foreign],
        relay.includes("partial") ? "timeout" : "eose",
      )
    })
    const outcome = await inventoryGitDeletion({
      context: {rootType: "issue", root: issue, repositoryAddress: repo, ownerPubkey: owner},
      relays: ["wss://complete", "wss://partial"],
      timeoutMs: 1000,
      maxEventsPerRequest: 50,
      request: request as never,
    })
    expect(request).toHaveBeenCalledTimes(4)
    expect(outcome.complete).toBe(false)
    expect(outcome.requests.map(item => [item.round, item.relay, item.transport.outcome])).toEqual([
      [1, "wss://complete", "eose"],
      [1, "wss://partial", "timeout"],
      [2, "wss://complete", "eose"],
      [2, "wss://partial", "timeout"],
    ])
    expect(outcome.targets.map(target => target.relation)).toEqual(["label", "reaction", "root"])
    expect(outcome.excludedByReason["foreign-author"]).toBe(1)
    expect(outcome.requests[0]).toMatchObject({accepted: 1, foreign: 1, unsupported: 0})
  })

  it("seeds an empty repository inventory with the supplied required root", async () => {
    const root = makeEvent("5", 30617, [["d", "project"]])
    const request = vi.fn(async ({relay}: {relay: string}) => result(relay, []))
    const outcome = await inventoryGitDeletion({
      context: {rootType: "repository", root, repositoryAddress: repo, ownerPubkey: owner},
      relays: ["wss://authority"],
      timeoutMs: 1000,
      maxEventsPerRequest: 10,
      request: request as never,
    })
    expect(outcome.complete).toBe(true)
    expect(outcome.targets).toEqual([
      expect.objectContaining({key: `a:${repo}`, policy: "required"}),
    ])
  })

  it("bounds filter chunks, derives repository roots once, and forwards cancellation and caps", async () => {
    const root = makeEvent("5", 30617, [["d", "project"]])
    const pr = makeEvent("6", 1618, [["a", repo]])
    const update = makeEvent("7", 1619, [["E", pr.id]])
    const controller = new AbortController()
    const request = vi.fn(
      async (options: {
        relay: string
        filters: Filter[]
        signal?: AbortSignal
        maxEvents?: number
      }) => {
        expect(options.filters.length).toBeLessThanOrEqual(1)
        expect(options.signal).toBe(controller.signal)
        expect(options.maxEvents).toBe(7)
        if (options.filters.some(filter => filter["#a"])) return result(options.relay, [pr])
        if (options.filters.some(filter => filter["#E"]?.includes(pr.id)))
          return result(options.relay, [update])
        return result(options.relay, [])
      },
    )
    const outcome = await inventoryGitDeletion({
      context: {rootType: "repository", root, repositoryAddress: repo, ownerPubkey: owner},
      relays: ["wss://authority"],
      timeoutMs: 1000,
      maxEventsPerRequest: 7,
      maxFiltersPerRequest: 1,
      maxIdsPerFilter: 1,
      signal: controller.signal,
      request: request as never,
    })
    expect(outcome.requests.some(item => item.round === 2 && item.chunk > 0)).toBe(true)
    expect(outcome.targets.map(target => target.relation)).toEqual(["pr-update", "root", "root"])
    expect(outcome.targets.at(-1)?.policy).toBe("required")
  })

  it("does not turn abort into empty success", async () => {
    const controller = new AbortController()
    controller.abort()
    const request = vi.fn()
    const outcome = await inventoryGitDeletion({
      context: {rootType: "issue", root: issue, repositoryAddress: repo, ownerPubkey: owner},
      relays: ["wss://relay"],
      timeoutMs: 1000,
      maxEventsPerRequest: 10,
      signal: controller.signal,
      request,
    })
    expect(outcome.complete).toBe(false)
    expect(request).not.toHaveBeenCalled()
    expect(outcome.targets).toHaveLength(1)
  })

  it("bounds every repository address and identifier filter", async () => {
    const root = makeEvent("5", 30617, [["d", "project"]])
    const addresses = Array.from({length: 5}, (_, index) => `30617:${owner}:project-${index}`)
    const request = vi.fn(async ({relay, filters}: {relay: string; filters: Filter[]}) => {
      for (const filter of filters) {
        expect(filter["#a"]?.length || 0).toBeLessThanOrEqual(2)
        expect(filter["#q"]?.length || 0).toBeLessThanOrEqual(2)
        expect(filter["#d"]?.length || 0).toBeLessThanOrEqual(2)
      }
      return result(relay, [])
    })

    await inventoryGitDeletion({
      context: {
        rootType: "repository",
        root,
        repositoryAddress: repo,
        repositoryAddresses: addresses,
        ownerPubkey: owner,
      },
      relays: ["wss://authority"],
      timeoutMs: 1000,
      maxEventsPerRequest: 10,
      maxIdsPerFilter: 2,
      request: request as never,
    })

    expect(request.mock.calls.length).toBeGreaterThan(1)
  })
})
