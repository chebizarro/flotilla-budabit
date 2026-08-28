import {describe, expect, it, vi} from "vitest"
import {
  buildRepoDeletePlan,
  buildGraspRepoDeleteRequest,
  buildRepoDeleteTags,
  buildRepoOwnedDeleteFilters,
  canDeleteLocalRepoAfterRemoteResults,
  createRetainedRepoDeleteOperation,
  getGraspRepoDeleteTarget,
  getMetadataDeleteRelays,
  getRepoDeleteAddresses,
  getRepoDeleteIdentifiers,
  matchesRepoDeleteEvent,
} from "./repo-delete"
import {nip19} from "nostr-tools"

describe("repo delete helpers", () => {
  it("deduplicates repo delete addresses and keeps fallback", () => {
    expect(
      getRepoDeleteAddresses(
        ["30617:alice:repo", "30617:alice:repo", "30617:alice:repo-renamed"],
        "30617:alice:repo",
      ),
    ).toEqual(["30617:alice:repo", "30617:alice:repo-renamed"])
  })

  it("matches delete events against any effective repo address", () => {
    const event = {
      tags: [["repo", "30617:alice:repo-renamed"]],
    }

    expect(matchesRepoDeleteEvent(event, ["30617:alice:repo-renamed"], "30617:alice:repo")).toBe(
      true,
    )
    expect(matchesRepoDeleteEvent(event, ["30617:alice:repo-other"], "30617:alice:repo")).toBe(
      false,
    )
  })

  it("builds repo-owned delete filters across all effective addresses", () => {
    const filters = buildRepoOwnedDeleteFilters({
      pubkey: "a".repeat(64),
      repoName: "repo",
      repoAddresses: ["30617:alice:repo", "30617:alice:repo-renamed"],
    })

    expect(filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({"#d": ["repo"]}),
        expect.objectContaining({"#a": ["30617:alice:repo", "30617:alice:repo-renamed"]}),
      ]),
    )
  })

  it("derives an owner-matched GRASP relay from a clone URL", () => {
    const ownerPubkey = "a".repeat(64)
    const ownerNpub = nip19.npubEncode(ownerPubkey)

    expect(
      getGraspRepoDeleteTarget({
        cloneUrl: `https://grasp.example/${ownerNpub}/repo.git`,
        ownerPubkey,
        identifier: "repo",
      }),
    ).toEqual({
      relay: "wss://grasp.example/",
      ownerNpub,
      identifier: "repo",
    })
  })

  it("requires clone bases to match relay hints and preserves deployment paths", () => {
    const ownerPubkey = "a".repeat(64)
    const ownerNpub = nip19.npubEncode(ownerPubkey)

    expect(
      getGraspRepoDeleteTarget({
        cloneUrl: `https://grasp.example/git/${ownerNpub}/repo.git`,
        ownerPubkey,
        identifier: "repo",
        relayHints: ["wss://grasp.example/git/"],
      }),
    ).toEqual({relay: "wss://grasp.example/git/", ownerNpub, identifier: "repo"})
    expect(
      getGraspRepoDeleteTarget({
        cloneUrl: `https://grasp.example/${ownerNpub}/repo.git`,
        ownerPubkey,
        identifier: "repo",
        relayHints: ["wss://other.example"],
      }),
    ).toBeNull()
  })

  it("rejects GRASP clone URLs for another owner or repository", () => {
    const ownerPubkey = "a".repeat(64)
    const ownerNpub = nip19.npubEncode(ownerPubkey)

    expect(
      getGraspRepoDeleteTarget({
        cloneUrl: `https://grasp.example/${ownerNpub}/other.git`,
        ownerPubkey,
        identifier: "repo",
      }),
    ).toBeNull()
    expect(
      getGraspRepoDeleteTarget({
        cloneUrl: `https://grasp.example/${nip19.npubEncode("b".repeat(64))}/repo.git`,
        ownerPubkey,
        identifier: "repo",
      }),
    ).toBeNull()
  })

  it("builds a coordinate-only GRASP repository deletion request", () => {
    const ownerPubkey = "a".repeat(64)
    const request = buildGraspRepoDeleteRequest({
      event: {
        kind: 30617,
        pubkey: ownerPubkey,
        created_at: 110,
        tags: [["d", "repo"]],
      },
      ownerPubkey,
      now: 100,
    })

    expect(request).toEqual({
      createdAt: 111,
      coordinate: `30617:${ownerPubkey}:repo`,
      tags: [
        ["a", `30617:${ownerPubkey}:repo`],
        ["k", "30617"],
        ["repo", `30617:${ownerPubkey}:repo`],
      ],
    })
    expect(request.tags.some(tag => tag[0] === "e")).toBe(false)
  })

  it("uses coordinates for replaceable metadata and ids for regular events", () => {
    const ownerPubkey = "a".repeat(64)
    const tags = buildRepoDeleteTags([
      {
        id: "announcement-id",
        kind: 30617,
        pubkey: ownerPubkey,
        created_at: 100,
        tags: [["d", "repo"]],
      } as any,
      {
        id: "issue-id",
        kind: 1621,
        pubkey: ownerPubkey,
        created_at: 100,
        tags: [],
      } as any,
    ])

    expect(tags).toContainEqual(["a", `30617:${ownerPubkey}:repo`])
    expect(tags).toContainEqual(["e", "issue-id"])
    expect(tags).not.toContainEqual(["e", "announcement-id"])
  })

  it("only excludes the exact canonical GRASP relay from metadata deletion", () => {
    expect(
      getMetadataDeleteRelays({
        relays: [
          "WSS://GRASP.EXAMPLE/GRASP?tenant=a",
          "wss://grasp.example/GRASP?tenant=b",
          "wss://grasp.example/community",
          "wss://metadata.example",
        ],
        remoteTargets: [
          {
            vendor: "grasp",
            url: "https://grasp.example/GRASP/npub1invalid/repo.git",
            graspRelay: "wss://grasp.example/GRASP?tenant=a",
          },
        ],
      }),
    ).toEqual([
      "wss://grasp.example/GRASP?tenant=b",
      "wss://grasp.example/community",
      "wss://metadata.example/",
    ])
  })

  it("preserves relay hint identity and rejects credentials for GRASP deletion", () => {
    const ownerPubkey = "a".repeat(64)
    const ownerNpub = nip19.npubEncode(ownerPubkey)
    const cloneUrl = `https://grasp.example/git/${ownerNpub}/repo.git`

    expect(
      getGraspRepoDeleteTarget({
        cloneUrl,
        ownerPubkey,
        identifier: "repo",
        relayHints: ["WSS://GRASP.EXAMPLE/git/?token=AbC%2F123"],
      }),
    ).toEqual({
      relay: "wss://grasp.example/git/?token=AbC%2F123",
      ownerNpub,
      identifier: "repo",
    })
    expect(
      getGraspRepoDeleteTarget({
        cloneUrl,
        ownerPubkey,
        identifier: "repo",
        relayHints: ["wss://user:secret@grasp.example/git"],
      }),
    ).toBeNull()
  })

  it("preserves the local clone after partial metadata or selected remote failure", () => {
    const base = {
      inventoryAccepted: true,
      rootAcknowledged: true,
      selectedRemoteIds: new Set(["grasp:a"]),
      remoteResults: [{id: "grasp:a", status: "accepted"}],
    }

    expect(canDeleteLocalRepoAfterRemoteResults(base)).toBe(true)
    expect(
      canDeleteLocalRepoAfterRemoteResults({
        ...base,
        remoteResults: [{id: "grasp:a", status: "failed"}],
      }),
    ).toBe(false)
    expect(canDeleteLocalRepoAfterRemoteResults({...base, inventoryError: "relay timeout"})).toBe(
      false,
    )
    expect(canDeleteLocalRepoAfterRemoteResults({...base, inventoryAccepted: false})).toBe(false)
    expect(canDeleteLocalRepoAfterRemoteResults({...base, rootAcknowledged: false})).toBe(false)
  })

  it("derives only validated identifiers from owner repository addresses", () => {
    const owner = "a".repeat(64)

    expect(
      getRepoDeleteIdentifiers(owner, [
        `30617:${owner}:zeta`,
        `30617:${owner}:alpha`,
        `30617:${owner}:alpha`,
        `30618:${owner}:state-is-not-an-announcement-address`,
        `30617:${"b".repeat(64)}:foreign`,
        "not-an-address",
      ]),
    ).toEqual(["alpha", "zeta"])
  })

  it("builds deterministic bounded mixed-target units with the supplied root alone and final", () => {
    const owner = "a".repeat(64)
    const address = `30617:${owner}:repo`
    const root = {
      id: "root-id",
      kind: 30617,
      pubkey: owner,
      created_at: 100,
      tags: [["d", "repo"]],
    } as any
    const events = [
      {
        id: "regular-b",
        kind: 1621,
        pubkey: owner,
        created_at: 130,
        tags: [["a", address]],
      },
      {
        id: "unsafe",
        kind: 30410,
        pubkey: owner,
        created_at: 140,
        tags: [
          ["d", "repo"],
          ["a", address],
        ],
      },
      {
        id: "state",
        kind: 30618,
        pubkey: owner,
        created_at: 120,
        tags: [["d", "repo"]],
      },
      {
        id: "regular-a",
        kind: 1618,
        pubkey: owner,
        created_at: 110,
        tags: [["a", address]],
      },
    ] as any[]

    const first = buildRepoDeletePlan({root, events, now: 50, maxTargets: 2})
    const second = buildRepoDeletePlan({
      root,
      events: [...events].reverse(),
      now: 50,
      maxTargets: 2,
    })

    expect(second).toEqual(first)
    expect(first.excludedUnsafeKinds).toEqual([30410])
    expect(first.units.map(unit => unit.id)).toEqual([
      "regular-000",
      "repository-history-001",
      "root-final",
    ])
    expect(first.units.at(-1)?.targets).toEqual([
      expect.objectContaining({key: `a:${address}`, policy: "required"}),
    ])
    expect(first.units.at(-1)?.createdAt).toBe(101)
    for (const unit of first.units) {
      expect(unit.targets.length).toBeLessThanOrEqual(2)
      expect(unit.createdAt).toBeGreaterThan(
        Math.max(...unit.targets.map(target => target.createdAt)),
      )
      expect(unit.tags[0]).toEqual(["repo", address])
      expect(unit.tags.slice(1).every(tag => tag[3] && Number.isFinite(Number(tag[3])))).toBe(true)
    }
  })

  it("dates the final address tombstone after the newest current announcement version", () => {
    const owner = "a".repeat(64)
    const root = {
      id: "old-root",
      kind: 30617,
      pubkey: owner,
      created_at: 100,
      tags: [["d", "repo"]],
    } as any
    const newer = {...root, id: "new-root", created_at: 250}

    const plan = buildRepoDeletePlan({root, events: [newer], now: 50})

    expect(plan.units).toHaveLength(1)
    expect(plan.units[0]).toMatchObject({id: "root-final", createdAt: 251})
  })

  it("enforces serialized-byte bounds and always emits a root-final unit", () => {
    const owner = "a".repeat(64)
    const root = {
      id: "root-id",
      kind: 30617,
      pubkey: owner,
      created_at: 100,
      tags: [["d", "repo"]],
    } as any
    const rootOnly = buildRepoDeletePlan({root, events: [], maxSerializedBytes: 1_000})

    expect(rootOnly.units.map(unit => unit.id)).toEqual(["root-final"])
    expect(() => buildRepoDeletePlan({root, maxSerializedBytes: 10})).toThrow(
      "root exceeds the serialized-byte bound",
    )
  })

  it("keeps a large repository inventory deterministically count-bounded", () => {
    const owner = "a".repeat(64)
    const address = `30617:${owner}:repo`
    const root = {
      id: "f".repeat(64),
      kind: 30617,
      pubkey: owner,
      created_at: 100,
      tags: [["d", "repo"]],
    } as any
    const events = Array.from({length: 250}, (_, index) => ({
      id: index.toString(16).padStart(64, "0"),
      kind: 1621,
      pubkey: owner,
      created_at: index + 1,
      tags: [["a", address]],
    })) as any[]

    const plan = buildRepoDeletePlan({root, events, maxTargets: 40})

    expect(plan.units.at(-1)?.id).toBe("root-final")
    expect(plan.units.slice(0, -1).every(unit => unit.targets.length <= 40)).toBe(true)
    expect(plan.units.flatMap(unit => unit.targets)).toHaveLength(251)
  })

  it("accepts planner-classified direct-root metadata without a repository tag", () => {
    const owner = "a".repeat(64)
    const root = {
      id: "root-id",
      kind: 30617,
      pubkey: owner,
      created_at: 100,
      tags: [["d", "repo"]],
    } as any
    const comment = {
      id: "comment-id",
      kind: 1111,
      pubkey: owner,
      created_at: 90,
      tags: [["E", "issue-id"]],
    } as any

    expect(buildRepoDeletePlan({root, events: [comment]}).units).toHaveLength(1)
    expect(
      buildRepoDeletePlan({root, events: [comment], classifiedEvents: [comment]}).units[0].targets,
    ).toEqual([expect.objectContaining({key: "e:comment-id"})])
  })

  it("retains the exact signed unit for retry and supports cancellation", async () => {
    const owner = "a".repeat(64)
    const plan = buildRepoDeletePlan({
      root: {
        id: "root-id",
        kind: 30617,
        pubkey: owner,
        created_at: 100,
        tags: [["d", "repo"]],
      } as any,
    })
    const signed = {id: "signed-root"}
    let attempts = 0
    const sign = vi.fn(async () => signed)
    const publish = vi.fn(async (event: typeof signed) => {
      expect(event).toBe(signed)
      attempts += 1
      return {
        outcomes: [
          {relay: "wss://one", status: attempts > 1 ? ("accepted" as const) : ("timeout" as const)},
        ],
      }
    })
    const operation = createRetainedRepoDeleteOperation({
      plan,
      relays: ["wss://one"],
      sign,
      publish,
    })

    expect((await operation.run()).rootAcknowledged).toBe(false)
    expect((await operation.retry()).rootAcknowledged).toBe(true)
    expect(sign).toHaveBeenCalledTimes(1)
    operation.cancel()
  })

  it("can place physical deletion between best-effort and root publication", async () => {
    const owner = "a".repeat(64)
    const address = `30617:${owner}:repo`
    const plan = buildRepoDeletePlan({
      root: {
        id: "root-id",
        kind: 30617,
        pubkey: owner,
        created_at: 100,
        tags: [["d", "repo"]],
      } as any,
      events: [
        {
          id: "issue-id",
          kind: 1621,
          pubkey: owner,
          created_at: 90,
          tags: [["a", address]],
        },
      ] as any[],
    })
    const published: string[] = []
    const operation = createRetainedRepoDeleteOperation({
      plan,
      relays: ["wss://one"],
      sign: async unit => ({id: unit.id}),
      publish: async (_signed, unit) => {
        published.push(unit.id)
        return {outcomes: [{relay: "wss://one", status: "accepted"}]}
      },
    })

    await operation.runBestEffort()
    published.push("physical")
    await operation.runRoot()

    expect(published).toEqual(["regular-000", "physical", "root-final"])
  })

  it("retains and reports rejected best-effort publication before continuing", async () => {
    const owner = "a".repeat(64)
    const address = `30617:${owner}:repo`
    const plan = buildRepoDeletePlan({
      root: {
        id: "root-id",
        kind: 30617,
        pubkey: owner,
        created_at: 100,
        tags: [["d", "repo"]],
      } as any,
      events: [
        {
          id: "issue-id",
          kind: 1621,
          pubkey: owner,
          created_at: 90,
          tags: [["a", address]],
        },
      ] as any[],
    })
    const errors: string[] = []
    const operation = createRetainedRepoDeleteOperation({
      plan,
      relays: ["wss://one"],
      sign: async unit => ({id: unit.id}),
      publish: async (_signed, unit) => {
        if (unit.policy === "best-effort") throw new Error("transport failed")
        return {outcomes: [{relay: "wss://one", status: "accepted"}]}
      },
      onError: (_unit, error) => errors.push(String(error)),
    })

    const result = await operation.run()

    expect(result.rootAcknowledged).toBe(true)
    expect(result.complete).toBe(false)
    expect(errors).toEqual(["Error: transport failed"])
  })

  it("retains per-relay outcomes and does not republish an acknowledged unit", async () => {
    const owner = "a".repeat(64)
    const plan = buildRepoDeletePlan({
      root: {
        id: "root-id",
        kind: 30617,
        pubkey: owner,
        created_at: 100,
        tags: [["d", "repo"]],
      } as any,
    })
    const attempts: string[][] = []
    let round = 0
    const operation = createRetainedRepoDeleteOperation({
      plan,
      relays: ["wss://one", "wss://two"],
      sign: async () => ({id: "signed"}),
      publish: async (_signed, _unit, relays) => {
        attempts.push(relays)
        round += 1
        return {
          outcomes: relays.map(relay => ({
            relay,
            status:
              relay === "wss://one" || round > 1 ? ("accepted" as const) : ("timeout" as const),
          })),
        }
      },
    })

    const first = await operation.run()
    expect(first.rootAcknowledged).toBe(true)
    expect(first.units[0].outcomes).toHaveLength(2)
    await operation.retry()
    expect(attempts).toEqual([["wss://one", "wss://two"]])
  })

  it("accepts bounded readback without requiring a publish ACK", async () => {
    const owner = "a".repeat(64)
    const plan = buildRepoDeletePlan({
      root: {
        id: "root-id",
        kind: 30617,
        pubkey: owner,
        created_at: 100,
        tags: [["d", "repo"]],
      } as any,
    })
    const committed = vi.fn()
    const operation = createRetainedRepoDeleteOperation({
      plan,
      relays: ["wss://one"],
      sign: async () => ({id: "signed"}),
      publish: async () => ({outcomes: [{relay: "wss://one", status: "timeout"}]}),
      waitForReadback: async () => ["wss://one"],
      onAcknowledged: committed,
    })

    expect((await operation.run()).rootAcknowledged).toBe(true)
    expect(committed).toHaveBeenCalledTimes(1)
  })

  it("ignores acknowledgements and readbacks outside the validated relay scope", async () => {
    const owner = "a".repeat(64)
    const plan = buildRepoDeletePlan({
      root: {
        id: "root-id",
        kind: 30617,
        pubkey: owner,
        created_at: 100,
        tags: [["d", "repo"]],
      } as any,
    })
    const operation = createRetainedRepoDeleteOperation({
      plan,
      relays: ["wss://authority"],
      sign: async () => ({id: "signed"}),
      publish: async () => ({outcomes: [{relay: "wss://other", status: "accepted"}]}),
      getReadbackRelays: () => ["wss://other"],
    })

    expect((await operation.run()).rootAcknowledged).toBe(false)
  })

  it("rejects unauthorized and far-future GRASP deletion requests", () => {
    const ownerPubkey = "a".repeat(64)
    const event = {
      kind: 30617,
      pubkey: ownerPubkey,
      created_at: 1_000,
      tags: [["d", "repo"]],
    }

    expect(() =>
      buildGraspRepoDeleteRequest({event, ownerPubkey: "b".repeat(64), now: 1_000}),
    ).toThrow("Only the repository announcement author")
    expect(() => buildGraspRepoDeleteRequest({event, ownerPubkey, now: 600})).toThrow(
      "timestamp is too far in the future",
    )
  })

  it("rejects malformed percent-encoding in GRASP clone URLs", () => {
    expect(
      getGraspRepoDeleteTarget({
        cloneUrl: "https://grasp.example/%E0%A4%A/repo.git",
        ownerPubkey: "a".repeat(64),
        identifier: "repo",
      }),
    ).toBeNull()
  })
})
