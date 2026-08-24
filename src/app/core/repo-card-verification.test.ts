import {describe, expect, it, vi} from "vitest"
import {
  GIT_PULL_REQUEST,
  GIT_REPO_ANNOUNCEMENT,
  GIT_STATUS_APPLIED,
  type RepoAnnouncementEvent,
} from "@nostr-git/core/events"
import type {TrustedEvent} from "@welshman/util"
import {
  REPO_CARD_VERIFICATION_MAX_REPOS,
  REPO_CARD_VERIFICATION_CONCURRENCY,
  buildRepoCardVerificationPlan,
  loadRepoCardVerification,
} from "./repo-card-verification"

const owner = "a".repeat(64)
const maintainer = "b".repeat(64)
const relay = "wss://relay.example"

const makeRepo = (identifier = "demo", extraMaintainers = [maintainer]) =>
  ({
    id: identifier.padEnd(64, "0").slice(0, 64),
    pubkey: owner,
    created_at: 1,
    kind: GIT_REPO_ANNOUNCEMENT,
    tags: [["d", identifier], ...extraMaintainers.map(pubkey => ["maintainers", pubkey])],
    content: "",
    sig: "c".repeat(128),
  }) as RepoAnnouncementEvent

const makePr = (repo: RepoAnnouncementEvent) =>
  ({
    id: "d".repeat(64),
    pubkey: maintainer,
    created_at: 2,
    kind: GIT_PULL_REQUEST,
    tags: [["a", `${repo.kind}:${repo.pubkey}:${repo.tags.find(tag => tag[0] === "d")?.[1]}`]],
    content: "",
    sig: "e".repeat(128),
  }) as TrustedEvent

const makeStatus = (pr: TrustedEvent) =>
  ({
    id: "f".repeat(64),
    pubkey: owner,
    created_at: 3,
    kind: GIT_STATUS_APPLIED,
    tags: [["e", pr.id, "", "root"]],
    content: "",
    sig: "1".repeat(128),
  }) as TrustedEvent

describe("repository card verification", () => {
  it("plans author-scoped bounded PR filters", () => {
    const repo = makeRepo()
    const plan = buildRepoCardVerificationPlan([{event: repo, relays: [relay, relay]}])

    expect(plan.groups).toEqual([
      {
        relays: [`${relay}/`],
        plans: plan.plans,
        pullRequestFilters: [
          {
            kinds: [GIT_PULL_REQUEST],
            authors: [maintainer],
            "#a": [`${repo.kind}:${repo.pubkey}:demo`],
            limit: 24,
          },
        ],
      },
    ])
  })

  it("caps the number of repository targets", () => {
    const targets = Array.from({length: REPO_CARD_VERIFICATION_MAX_REPOS + 4}, (_, index) => ({
      event: makeRepo(`repo-${index}`),
      relays: [relay],
    }))

    expect(buildRepoCardVerificationPlan(targets).plans).toHaveLength(
      REPO_CARD_VERIFICATION_MAX_REPOS,
    )
  })

  it("keeps each repository on its own relay evidence scope", () => {
    const targets = Array.from({length: REPO_CARD_VERIFICATION_MAX_REPOS}, (_, index) => ({
      event: makeRepo(`repo-${index}`),
      relays: [`wss://relay-${index}.example`],
    }))
    const plan = buildRepoCardVerificationPlan(targets)

    expect(plan.groups).toHaveLength(REPO_CARD_VERIFICATION_MAX_REPOS)
    expect(plan.groups.at(-1)?.relays).toEqual([
      `wss://relay-${REPO_CARD_VERIFICATION_MAX_REPOS - 1}.example/`,
    ])
    for (const group of plan.groups) {
      expect(group.pullRequestFilters[0]["#a"]).toEqual([group.plans[0].address])
    }
  })

  it("bounds concurrent repository evidence relay groups", async () => {
    let active = 0
    let maxActive = 0
    const fetchEvents = vi.fn(async options => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await Promise.resolve()
      options.onOutcome?.({timedOut: false, sawEose: true, capped: false})
      active -= 1
      return []
    })
    const targets = Array.from({length: REPO_CARD_VERIFICATION_CONCURRENCY + 2}, (_, index) => ({
      event: makeRepo(`concurrent-${index}`),
      relays: [`wss://concurrent-${index}.example`],
    }))

    await loadRepoCardVerification(targets, undefined, {
      getCachedEvents: () => [],
      fetchEvents: fetchEvents as any,
    })

    expect(maxActive).toBeLessThanOrEqual(REPO_CARD_VERIFICATION_CONCURRENCY)
  })

  it("skips repositories without declared co-maintainers", () => {
    const plan = buildRepoCardVerificationPlan([
      {event: makeRepo("owner-only", []), relays: [relay]},
    ])

    expect(plan.plans).toEqual([])
    expect(plan.groups).toEqual([])
  })

  it("verifies maintainers from isolated PR and owner-status batches", async () => {
    const repo = makeRepo()
    const pr = makePr(repo)
    const status = makeStatus(pr)
    const fetchEvents = vi
      .fn()
      .mockImplementationOnce(async options => {
        options.onOutcome?.({timedOut: false, sawEose: true, capped: false})
        return [pr]
      })
      .mockImplementationOnce(async options => {
        options.onOutcome?.({timedOut: false, sawEose: true, capped: false})
        return [status]
      })

    const result = await loadRepoCardVerification([{event: repo, relays: [relay]}], undefined, {
      getCachedEvents: () => [],
      fetchEvents: fetchEvents as any,
    })

    expect(result.completion).toBe("complete")
    expect(
      Array.from(result.verifiedByAddress.get(`${repo.kind}:${repo.pubkey}:demo`) || []),
    ).toEqual([maintainer])
    expect(fetchEvents).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({isolated: true, maxEvents: 24}),
    )
    expect(fetchEvents).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        filters: [
          expect.objectContaining({
            kinds: [GIT_STATUS_APPLIED],
            authors: [owner],
            "#e": [pr.id],
            limit: 1,
          }),
        ],
      }),
    )
  })

  it("reports a capped evidence search as partial", async () => {
    const repo = makeRepo()
    const fetchEvents = vi.fn(async options => {
      options.onOutcome?.({timedOut: false, sawEose: false, capped: true})
      return []
    })

    const result = await loadRepoCardVerification([{event: repo, relays: [relay]}], undefined, {
      getCachedEvents: () => [],
      fetchEvents: fetchEvents as any,
    })

    expect(result.completion).toBe("partial")
  })

  it("isolates status limits per pull request root", async () => {
    const repo = makeRepo()
    const firstPr = makePr(repo)
    const secondPr = {...makePr(repo), id: "2".repeat(64)} as TrustedEvent
    const fetchEvents = vi
      .fn()
      .mockImplementationOnce(async options => {
        options.onOutcome?.({timedOut: false, sawEose: true, capped: false})
        return [firstPr, secondPr]
      })
      .mockImplementationOnce(async options => {
        options.onOutcome?.({timedOut: false, sawEose: true, capped: false})
        return []
      })

    await loadRepoCardVerification([{event: repo, relays: [relay]}], undefined, {
      getCachedEvents: () => [],
      fetchEvents: fetchEvents as any,
    })

    expect(fetchEvents.mock.calls[1][0].filters).toEqual([
      expect.objectContaining({"#e": [firstPr.id], limit: 1}),
      expect.objectContaining({"#e": [secondPr.id], limit: 1}),
    ])
  })

  it("retains cached positive evidence when no repository relay is available", async () => {
    const repo = makeRepo()
    const pr = makePr(repo)
    const status = makeStatus(pr)
    const getCachedEvents = vi.fn().mockReturnValueOnce([pr]).mockReturnValueOnce([status])
    const fetchEvents = vi.fn()

    const result = await loadRepoCardVerification([{event: repo, relays: []}], undefined, {
      getCachedEvents,
      fetchEvents: fetchEvents as any,
    })

    expect(result.completion).toBe("partial")
    expect(Array.from(result.verifiedByAddress.values())[0]).toEqual(new Set([maintainer]))
    expect(fetchEvents).not.toHaveBeenCalled()
  })

  it("propagates caller cancellation", async () => {
    const repo = makeRepo()
    const controller = new AbortController()
    const fetchEvents = vi.fn(
      options =>
        new Promise<TrustedEvent[]>(resolve => {
          options.signal?.addEventListener("abort", () => resolve([]), {once: true})
        }),
    )
    const pending = loadRepoCardVerification([{event: repo, relays: [relay]}], controller.signal, {
      getCachedEvents: () => [],
      fetchEvents: fetchEvents as any,
    })

    controller.abort()

    await expect(pending).rejects.toMatchObject({name: "AbortError"})
  })
})
