import {describe, expect, it} from "vitest"
import {getPublicKey} from "nostr-tools/pure"
import type {TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND_V2,
  TARGETED_PUBLICATION_KIND_V2,
  buildCommunityDefinitionV2,
  buildTargetedPublicationV2,
  communityPointersEqual,
  makeCommunityPointer,
  parseCommunityDefinitionV2,
  parseCommunityAuthorityV2,
  makeCommunityChildIdentifier,
  makeCommunityProfileListIdentifier,
  parseCommunityProfileListIdentifier,
  makeCommunityAuthorityTagsV2,
  makeCommunityScopeTagsV2,
  parseCommunityId,
  parseCommunityNaddr,
  parseTargetedPublicationV2,
  removeTargetedCommunityV2,
  selectCurrentAddressableEvent,
  selectCurrentCommunityDefinitionV2,
  selectCurrentTargetedPublicationEventsV2,
  updateCommunityDefinitionV2,
} from "./community"

const secret = (value: number) => new Uint8Array(32).fill(value)
const controller = getPublicKey(secret(1))
const otherController = getPublicKey(secret(2))
const communityId = getPublicKey(secret(3))
const otherCommunityId = getPublicKey(secret(4))
const listController = getPublicKey(secret(5))
const servicePubkey = getPublicKey(secret(7))

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "a".repeat(64),
    pubkey: controller,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "b".repeat(128),
    ...overrides,
  }) as TrustedEvent

const section = {
  name: "General",
  kinds: [{kind: 1111}],
  profileLists: [{address: `30000:${listController}:${communityId}-general`}],
}

describe("Communikeys V2 identity", () => {
  it("accepts only lowercase liftable x-only community IDs", () => {
    expect(parseCommunityId(communityId)).toBe(communityId)
    expect(parseCommunityId(communityId.toUpperCase())).toBeUndefined()
    expect(parseCommunityId("f".repeat(64))).toBeUndefined()
    expect(parseCommunityId("0".repeat(64))).toBeUndefined()
    expect(parseCommunityId("abc")).toBeUndefined()
  })

  it("derives coherent pointers and ignores relay hints for equality", () => {
    const first = makeCommunityPointer({
      controllerPubkey: controller,
      communityId,
      relayHints: [
        "wss://one.example",
        "wss://two.example/",
        "wss://one.example/",
        "wss://three.example",
        "wss://four.example",
      ],
    })!
    const second = makeCommunityPointer({
      controllerPubkey: controller,
      communityId,
      relayHints: ["wss://elsewhere.example"],
    })!

    expect(first.address).toBe(`${COMMUNITY_DEFINITION_KIND_V2}:${controller}:${communityId}`)
    expect(first.relayHints).toEqual([
      "wss://one.example",
      "wss://two.example",
      "wss://three.example",
    ])
    expect(first.cacheKey).toBe(first.address)
    expect(communityPointersEqual(first, second)).toBe(true)
    expect(parseCommunityNaddr(first.naddr)).toMatchObject({
      address: first.address,
      controllerPubkey: controller,
      communityId,
    })
    expect(
      communityPointersEqual(
        first,
        makeCommunityPointer({controllerPubkey: otherController, communityId})!,
      ),
    ).toBe(false)
  })

  it("rejects non-community and incoherent naddrs", async () => {
    const {naddrEncode} = await import("nostr-tools/nip19")
    const wrongKind = naddrEncode({kind: 30023, pubkey: controller, identifier: communityId})
    const malformedId = naddrEncode({
      kind: COMMUNITY_DEFINITION_KIND_V2,
      pubkey: controller,
      identifier: "not-a-community-id",
    })

    expect(parseCommunityNaddr(wrongKind)).toBeUndefined()
    expect(parseCommunityNaddr(malformedId)).toBeUndefined()
  })

  it("parses a fixed external community naddr vector", () => {
    const vector =
      "naddr1qvzqqqramcpzqxuyc4t8kynygzv460k442aq2ewhrcvrgczgr8lec9l4a82a6pu0qyfhwumn8ghj7un9d3shjtn90psk6urvv5qyqe3exvcrscfsxyunydfcvvenzvp58yengdrx8q6kvwpevs6nyv3evg6nxvtr8q6r2wpnxenrjwtzxqurvvp3vccnzvmzvdjnqvekvcusayrxs5"

    expect(parseCommunityNaddr(vector)).toMatchObject({
      controllerPubkey: controller,
      communityId: "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
      relayHints: ["wss://relay.example"],
    })
  })
})

describe("Communikeys V2 definitions", () => {
  it("builds and strictly parses definition-native metadata", () => {
    const template = buildCommunityDefinitionV2({
      communityId,
      name: "Buda Builders",
      description: "A builder community",
      picture: "https://media.example/picture.png",
      relays: ["wss://relay.example"],
      sections: [section],
    })
    const definition = parseCommunityDefinitionV2(
      makeEvent({kind: COMMUNITY_DEFINITION_KIND_V2, tags: template.tags}),
    )!

    expect(template.kind).toBe(COMMUNITY_DEFINITION_KIND_V2)
    expect(template.tags[0]).toEqual(["d", communityId])
    expect(definition.communityId).toBe(communityId)
    expect(definition.controllerPubkey).toBe(controller)
    expect(definition.pointer.address).toBe(
      `${COMMUNITY_DEFINITION_KIND_V2}:${controller}:${communityId}`,
    )
    expect(definition.metadata).toEqual({
      name: "Buda Builders",
      description: "A builder community",
      picture: "https://media.example/picture.png",
    })
    expect(definition.relays).toEqual(["wss://relay.example"])
  })

  it("round-trips typed mint, terms, and service declarations", () => {
    const template = buildCommunityDefinitionV2({
      communityId,
      name: "Buda Builders",
      relays: ["wss://relay.example"],
      mints: [{url: "https://mint.example", type: "cashu"}],
      terms: {reference: "c".repeat(64), relay: "wss://terms.example"},
      services: [
        {
          name: "community-alerts",
          pubkey: servicePubkey,
          requestRelay: "wss://requests.example",
          handlerAddress: `31990:${servicePubkey}:alerts`,
          handlerRelay: "wss://handlers.example",
        },
      ],
      sections: [section],
    })
    const parsed = parseCommunityDefinitionV2(
      makeEvent({kind: COMMUNITY_DEFINITION_KIND_V2, tags: template.tags}),
    )!

    expect(parsed.mints).toEqual([{url: "https://mint.example", type: "cashu"}])
    expect(parsed.terms).toEqual({reference: "c".repeat(64), relay: "wss://terms.example"})
    expect(parsed.services).toEqual([
      {
        name: "community-alerts",
        pubkey: servicePubkey,
        requestRelay: "wss://requests.example",
        handlerAddress: `31990:${servicePubkey}:alerts`,
        handlerRelay: "wss://handlers.example",
      },
    ])
  })

  it("rejects missing, duplicate, uppercase, and malformed definition d tags", () => {
    const validTags = buildCommunityDefinitionV2({
      communityId,
      name: "Builders",
      relays: ["wss://relay.example"],
      sections: [section],
    }).tags

    expect(
      parseCommunityDefinitionV2(
        makeEvent({kind: COMMUNITY_DEFINITION_KIND_V2, tags: validTags.slice(1)}),
      ),
    ).toBeUndefined()
    expect(
      parseCommunityDefinitionV2(
        makeEvent({
          kind: COMMUNITY_DEFINITION_KIND_V2,
          tags: [...validTags, ["d", otherCommunityId]],
        }),
      ),
    ).toBeUndefined()
    expect(
      parseCommunityDefinitionV2(
        makeEvent({
          kind: COMMUNITY_DEFINITION_KIND_V2,
          tags: validTags.map(tag => (tag[0] === "d" ? ["d", communityId.toUpperCase()] : tag)),
        }),
      ),
    ).toBeUndefined()
    expect(
      parseCommunityDefinitionV2(
        makeEvent({kind: COMMUNITY_DEFINITION_KIND_V2, tags: [...validTags, ["h", communityId]]}),
      ),
    ).toBeUndefined()
  })

  it("rejects malformed recognized tags and invalid section structure", () => {
    const validTags = buildCommunityDefinitionV2({
      communityId,
      name: "Builders",
      relays: ["wss://relay.example"],
      sections: [section],
    }).tags
    const malformedCases = [
      validTags.map(tag => (tag[0] === "name" ? ["name", "Builders", "extra"] : tag)),
      validTags.map(tag => (tag[0] === "r" ? ["r", "ws://relay.example"] : tag)),
      validTags.map(tag => (tag[0] === "k" ? ["k", "01111"] : tag)),
      validTags.map(tag => (tag[0] === "k" ? ["k", "1111", ""] : tag)),
      validTags.map(tag => (tag[0] === "a" ? ["a", `30009:${listController}:badge`] : tag)),
      [
        ["d", communityId],
        ["name", "Builders"],
        ["r", "wss://relay.example"],
        ["k", "1111"],
        ["content", "General"],
        ["a", section.profileLists[0].address],
      ],
      validTags.filter(tag => tag[0] !== "content" && tag[0] !== "k" && tag[0] !== "a"),
      [...validTags, ["mint", "http://mint.example", "cashu"]],
      [...validTags, ["tos", "not-an-event-or-address"]],
      [
        ...validTags,
        [
          "service",
          "Invalid Service",
          servicePubkey,
          "wss://requests.example",
          `31990:${servicePubkey}:alerts`,
          "wss://handlers.example",
        ],
      ],
      [
        ...validTags.slice(0, 3),
        [
          "service",
          "community-alerts",
          servicePubkey,
          "wss://requests.example",
          `1:${servicePubkey}:not-addressable`,
          "wss://handlers.example",
        ],
        ...validTags.slice(3),
      ],
    ]

    for (const tags of malformedCases) {
      expect(
        parseCommunityDefinitionV2(makeEvent({kind: COMMUNITY_DEFINITION_KIND_V2, tags})),
      ).toBeUndefined()
    }
  })

  it("rejects builder inputs that its parser would reject", () => {
    expect(() =>
      buildCommunityDefinitionV2({
        communityId,
        name: "Builders",
        relays: ["wss://relay.example"],
        sections: [],
      }),
    ).toThrow()
    expect(() =>
      buildCommunityDefinitionV2({
        communityId,
        name: "Builders",
        relays: ["wss://relay.example"],
        sections: [section, {...section, name: "general"}],
      }),
    ).toThrow()
    expect(() =>
      buildCommunityDefinitionV2({
        communityId,
        name: "Builders",
        relays: Array.from({length: 21}, (_, index) => `wss://relay-${index}.example`),
        sections: [section],
      }),
    ).toThrow()
  })

  it("uses the complete community ID in generated child coordinates", () => {
    const sharedPrefix = communityId.slice(0, 16)
    const siblingId = getPublicKey(secret(6))
    expect(siblingId.slice(0, 16)).not.toBe(sharedPrefix)

    expect(makeCommunityProfileListIdentifier(communityId, "general-writers")).toBe(
      `${communityId}-general-writers`,
    )
    expect(makeCommunityProfileListIdentifier(communityId, "General Writers")).toBeUndefined()
    expect(parseCommunityProfileListIdentifier(communityId, `${communityId}-general-2`)).toEqual({
      purpose: "general-2",
    })
    expect(parseCommunityProfileListIdentifier(communityId, `${communityId}-general-2.2`)).toEqual({
      purpose: "general-2",
      shard: 2,
    })
    expect(
      parseCommunityProfileListIdentifier(communityId, `${communityId.slice(0, 32)}-general`),
    ).toBeUndefined()
    expect(makeCommunityChildIdentifier(communityId, "form", "---")).toBe(
      `budabit-${communityId}-form`,
    )
    expect(makeCommunityChildIdentifier(communityId, "Invalid Purpose", "general")).toBeUndefined()
  })

  it("preserves unknown top-level and section tags through edits", () => {
    const base = parseCommunityDefinitionV2(
      makeEvent({
        kind: COMMUNITY_DEFINITION_KIND_V2,
        tags: [
          ["d", communityId],
          ["name", "Before"],
          ["x-top", "one"],
          ["r", "wss://relay.example"],
          ["content", "General"],
          ["k", "1111"],
          ["x-section", "two"],
          ["a", section.profileLists[0].address],
        ],
      }),
    )!
    const updated = updateCommunityDefinitionV2(base, {name: "After"})

    expect(updated.tags).toContainEqual(["x-top", "one"])
    expect(updated.tags).toContainEqual(["x-section", "two"])
    expect(updated.tags).toContainEqual(["name", "After"])
    expect(
      parseCommunityDefinitionV2(
        makeEvent({kind: COMMUNITY_DEFINITION_KIND_V2, tags: updated.tags}),
      ),
    ).toBeTruthy()
  })

  it("losslessly rebuilds known fields while preserving the exact address and renamed-section extensions", () => {
    const base = parseCommunityDefinitionV2(
      makeEvent({
        kind: COMMUNITY_DEFINITION_KIND_V2,
        tags: [
          ["d", communityId],
          ["name", "Before"],
          ["x-top", "one"],
          ["r", "wss://relay.example"],
          ["content", "General"],
          ["k", "1111"],
          ["x-section", "two"],
          ["a", section.profileLists[0].address],
        ],
      }),
    )!
    const rebuilt = buildCommunityDefinitionV2({
      communityId: base.communityId,
      name: "After",
      relays: ["wss://relay.example", "wss://relay-two.example"],
      sections: [{...section, name: "Renamed"}],
    })
    const updated = updateCommunityDefinitionV2(
      base,
      {name: "After"},
      {replacement: rebuilt, originalSectionNames: {renamed: "general"}},
    )
    const parsed = parseCommunityDefinitionV2(
      makeEvent({kind: COMMUNITY_DEFINITION_KIND_V2, tags: updated.tags}),
    )!

    expect(parsed.pointer.address).toBe(base.pointer.address)
    expect(parsed.communityId).toBe(base.communityId)
    expect(parsed.relays).toEqual(["wss://relay.example", "wss://relay-two.example"])
    expect(parsed.sections[0].name).toBe("Renamed")
    expect(updated.tags).toContainEqual(["x-top", "one"])
    expect(updated.tags).toContainEqual(["x-section", "two"])
  })

  it("preserves geohash on name edits and rejects invalid metadata edits", () => {
    const template = buildCommunityDefinitionV2({
      communityId,
      name: "Before",
      geohash: "u173z",
      relays: ["wss://relay.example"],
      sections: [section],
    })
    const definition = parseCommunityDefinitionV2(
      makeEvent({kind: COMMUNITY_DEFINITION_KIND_V2, tags: template.tags}),
    )!

    expect(updateCommunityDefinitionV2(definition, {name: "After"}).tags).toContainEqual([
      "g",
      "u173z",
    ])
    expect(() => updateCommunityDefinitionV2(definition, {picture: "javascript:alert(1)"})).toThrow(
      "Invalid picture",
    )
  })

  it("selects replacements deterministically by timestamp then lowest event ID", () => {
    const tags = buildCommunityDefinitionV2({
      communityId,
      name: "Builders",
      relays: ["wss://relay.example"],
      sections: [section],
    }).tags
    const highId = makeEvent({id: "f".repeat(64), kind: COMMUNITY_DEFINITION_KIND_V2, tags})
    const lowId = makeEvent({id: "1".repeat(64), kind: COMMUNITY_DEFINITION_KIND_V2, tags})
    const otherAddress = makeEvent({
      id: "0".repeat(64),
      kind: COMMUNITY_DEFINITION_KIND_V2,
      tags: buildCommunityDefinitionV2({
        communityId: otherCommunityId,
        name: "Other",
        relays: ["wss://relay.example"],
        sections: [{...section, profileLists: [{address: `30000:${listController}:other`}]}],
      }).tags,
    })

    expect(
      selectCurrentAddressableEvent(
        [highId, otherAddress, lowId],
        `${COMMUNITY_DEFINITION_KIND_V2}:${controller}:${communityId}`,
      )?.id,
    ).toBe(lowId.id)
  })

  it("applies same-author address tombstones before selecting authority state", () => {
    const address = `30000:${controller}:writers`
    const oldList = makeEvent({
      id: "1".repeat(64),
      kind: 30000,
      created_at: 10,
      tags: [["d", "writers"]],
    })
    const deletion = makeEvent({
      id: "2".repeat(64),
      kind: 5,
      created_at: 10,
      tags: [["a", address]],
    })
    const recreated = makeEvent({
      id: "3".repeat(64),
      kind: 30000,
      created_at: 11,
      tags: [["d", "writers"]],
    })
    const foreignDeletion = makeEvent({
      id: "4".repeat(64),
      pubkey: otherController,
      kind: 5,
      created_at: 20,
      tags: [["a", address]],
    })

    expect(selectCurrentAddressableEvent([oldList, deletion], address)).toBeUndefined()
    expect(selectCurrentAddressableEvent([oldList, deletion, recreated], address)?.id).toBe(
      recreated.id,
    )
    expect(selectCurrentAddressableEvent([oldList, foreignDeletion], address)?.id).toBe(oldList.id)

    const multiAddressDeletion = makeEvent({
      id: "5".repeat(64),
      kind: 5,
      created_at: 20,
      tags: [
        ["a", `30000:${controller}:other`],
        ["a", address],
      ],
    })
    expect(selectCurrentAddressableEvent([oldList, multiAddressDeletion], address)).toBeUndefined()
  })

  it("ignores invalid newer definitions and exact-event-deleted authority versions", () => {
    const valid = makeEvent({
      id: "1".repeat(64),
      created_at: 10,
      kind: COMMUNITY_DEFINITION_KIND_V2,
      tags: buildCommunityDefinitionV2({
        communityId,
        name: "Valid",
        relays: ["wss://relay.example"],
        sections: [section],
      }).tags,
    })
    const invalid = makeEvent({
      id: "2".repeat(64),
      created_at: 11,
      kind: COMMUNITY_DEFINITION_KIND_V2,
      tags: [["d", communityId]],
    })
    const address = `${COMMUNITY_DEFINITION_KIND_V2}:${controller}:${communityId}`
    expect(selectCurrentCommunityDefinitionV2([valid, invalid], address)?.id).toBe(valid.id)

    const listAddress = `30000:${controller}:writers`
    const older = makeEvent({
      id: "3".repeat(64),
      created_at: 9,
      kind: 30000,
      tags: [["d", "writers"]],
    })
    const newer = makeEvent({
      id: "4".repeat(64),
      created_at: 10,
      kind: 30000,
      tags: [["d", "writers"]],
    })
    const deletion = makeEvent({
      id: "5".repeat(64),
      created_at: 11,
      kind: 5,
      tags: [["e", newer.id]],
    })
    expect(selectCurrentAddressableEvent([older, newer, deletion], listAddress)).toBeUndefined()
  })

  it("requires a single exact a tag for definition address tombstones", () => {
    const definition = makeEvent({
      id: "1".repeat(64),
      created_at: 10,
      kind: COMMUNITY_DEFINITION_KIND_V2,
      tags: buildCommunityDefinitionV2({
        communityId,
        name: "Still active",
        relays: ["wss://relay.example"],
        sections: [section],
      }).tags,
    })
    const deletion = makeEvent({
      id: "2".repeat(64),
      created_at: 11,
      kind: 5,
      tags: [
        ["a", `${COMMUNITY_DEFINITION_KIND_V2}:${controller}:${communityId}`],
        ["a", `30000:${controller}:other`],
      ],
    })

    expect(
      selectCurrentCommunityDefinitionV2(
        [definition, deletion],
        `${COMMUNITY_DEFINITION_KIND_V2}:${controller}:${communityId}`,
      )?.id,
    ).toBe(definition.id)
  })
})

describe("Communikeys V2 targeting", () => {
  it("builds and parses marked source and community pairs without person p tags", () => {
    const target = makeCommunityPointer({controllerPubkey: controller, communityId})!
    const otherTarget = makeCommunityPointer({
      controllerPubkey: otherController,
      communityId: otherCommunityId,
    })!
    const template = buildTargetedPublicationV2({
      id: "target-id",
      kind: 31922,
      source: {type: "a", value: `31922:${controller}:event`, relay: "wss://source.example"},
      communities: [target, otherTarget],
    })

    expect(template.tags).toEqual([
      ["d", "target-id"],
      ["a", `31922:${controller}:event`, "wss://source.example", "source"],
      ["k", "31922"],
      ["h", communityId],
      ["a", target.address, "", "community"],
      ["h", otherCommunityId],
      ["a", otherTarget.address, "", "community"],
    ])
    expect(template.kind).toBe(TARGETED_PUBLICATION_KIND_V2)
    expect(template.tags.some(tag => tag[0] === "p")).toBe(false)
    expect(
      parseTargetedPublicationV2(
        makeEvent({kind: TARGETED_PUBLICATION_KIND_V2, tags: template.tags}),
      )?.communities.map(item => item.address),
    ).toEqual([target.address, otherTarget.address])
  })

  it("rejects mismatched or non-adjacent target pairs", () => {
    const pointer = makeCommunityPointer({controllerPubkey: controller, communityId})!
    const base = [
      ["d", "target-id"],
      ["k", "31922"],
      ["h", otherCommunityId],
      ["a", pointer.address, "", "community"],
    ]
    const separated = [
      ["d", "target-id"],
      ["k", "31922"],
      ["h", communityId],
      ["alt", "separator"],
      ["a", pointer.address, "", "community"],
    ]

    expect(
      parseTargetedPublicationV2(makeEvent({kind: TARGETED_PUBLICATION_KIND_V2, tags: base})),
    ).toBeUndefined()
    expect(
      parseTargetedPublicationV2(makeEvent({kind: TARGETED_PUBLICATION_KIND_V2, tags: separated})),
    ).toBeUndefined()
  })

  it("rejects malformed markers, noncanonical relays, and incoherent pointers", () => {
    const pointer = makeCommunityPointer({controllerPubkey: controller, communityId})!
    const base = buildTargetedPublicationV2({
      id: "target-id",
      kind: 31922,
      communities: [pointer],
    }).tags
    const cases = [
      base.map(tag => (tag[0] === "a" ? ["a", tag[1], "community"] : tag)),
      base.map(tag => (tag[0] === "a" ? ["a", tag[1], "wss://relay.example/", "community"] : tag)),
      base.map(tag => (tag[0] === "h" ? ["h", tag[1], "extra"] : tag)),
    ]
    for (const tags of cases) {
      expect(
        parseTargetedPublicationV2(makeEvent({kind: TARGETED_PUBLICATION_KIND_V2, tags})),
      ).toBeUndefined()
    }

    expect(
      parseTargetedPublicationV2(
        makeEvent({
          kind: TARGETED_PUBLICATION_KIND_V2,
          tags: [...base, ["x-extension", "source", "community"], ["p", communityId]],
        }),
      ),
    ).toBeTruthy()

    expect(() =>
      buildTargetedPublicationV2({
        id: "target-id",
        kind: 31922,
        communities: [{...pointer, address: `${pointer.address}-tampered`}],
      }),
    ).toThrow("Incoherent community target")
  })

  it("removes targets by exact definition address", () => {
    const first = makeCommunityPointer({controllerPubkey: controller, communityId})!
    const sameIdBranch = makeCommunityPointer({controllerPubkey: otherController, communityId})!
    const event = makeEvent({
      kind: TARGETED_PUBLICATION_KIND_V2,
      tags: [
        ...buildTargetedPublicationV2({
          id: "target-id",
          kind: 9041,
          communities: [first, sameIdBranch],
        }).tags,
        ["x-extension", "preserve-me"],
      ],
    })
    const removed = removeTargetedCommunityV2(event, first.address)!
    const parsed = parseTargetedPublicationV2(
      makeEvent({kind: TARGETED_PUBLICATION_KIND_V2, tags: removed.tags}),
    )!

    expect(parsed.communities.map(item => item.address)).toEqual([sameIdBranch.address])
    expect(parsed.communities[0].communityId).toBe(communityId)
    expect(removed.tags).toContainEqual(["x-extension", "preserve-me"])
  })

  it("selects effective wrapper replacements and applies timestamp-aware deletions", () => {
    const first = makeCommunityPointer({controllerPubkey: controller, communityId})!
    const second = makeCommunityPointer({
      controllerPubkey: otherController,
      communityId: otherCommunityId,
    })!
    const address = `${TARGETED_PUBLICATION_KIND_V2}:${controller}:target-id`
    const original = makeEvent({
      id: "1".repeat(64),
      created_at: 10,
      kind: TARGETED_PUBLICATION_KIND_V2,
      tags: buildTargetedPublicationV2({id: "target-id", kind: 9041, communities: [first, second]})
        .tags,
    })
    const replacement = makeEvent({
      id: "2".repeat(64),
      created_at: 20,
      kind: TARGETED_PUBLICATION_KIND_V2,
      tags: removeTargetedCommunityV2(original, first.address)!.tags,
    })
    const staleDeletion = makeEvent({
      id: "3".repeat(64),
      created_at: 19,
      kind: 5,
      tags: [["a", address]],
    })
    const deletion = makeEvent({
      id: "4".repeat(64),
      created_at: 20,
      kind: 5,
      tags: [["e", replacement.id]],
    })
    const recreation = {...replacement, id: "5".repeat(64), created_at: 21}

    expect(
      selectCurrentTargetedPublicationEventsV2([original, replacement, staleDeletion]),
    ).toEqual([replacement])
    expect(selectCurrentTargetedPublicationEventsV2([original, replacement, deletion])).toEqual([])
    expect(
      selectCurrentTargetedPublicationEventsV2([original, replacement, deletion, recreation]),
    ).toEqual([recreation])
  })
})

describe("Communikeys V2 workflow scope", () => {
  it("builds one stable h while interpreting person tags by position", () => {
    expect(makeCommunityScopeTagsV2(communityId, [["title", "General"]])).toEqual([
      ["h", communityId],
      ["title", "General"],
    ])
    expect(() => makeCommunityScopeTagsV2(communityId, [["h", communityId]])).toThrow()
    expect(makeCommunityScopeTagsV2(communityId, [["p", communityId]])).toEqual([
      ["h", communityId],
      ["p", communityId],
    ])
  })

  it("adds one coherent marked branch authority reference", () => {
    const pointer = makeCommunityPointer({controllerPubkey: controller, communityId})!
    expect(makeCommunityAuthorityTagsV2(pointer, "wss://relay.example")).toEqual([
      ["h", communityId],
      ["a", pointer.address, "wss://relay.example", "community"],
    ])
    expect(() =>
      makeCommunityAuthorityTagsV2(pointer, undefined, [["a", pointer.address, "", "community"]]),
    ).toThrow()
  })

  it("parses only one coherent stable and exact branch authority pair", () => {
    const pointer = makeCommunityPointer({controllerPubkey: controller, communityId})!
    const valid = makeEvent({tags: makeCommunityAuthorityTagsV2(pointer, "wss://relay.example")})

    expect(parseCommunityAuthorityV2(valid)?.address).toBe(pointer.address)
    expect(
      parseCommunityAuthorityV2(
        makeEvent({
          tags: [
            ["h", communityId],
            ["a", pointer.address, "", "community"],
            ["h", communityId],
          ],
        }),
      ),
    ).toBeUndefined()
    expect(
      parseCommunityAuthorityV2(
        makeEvent({
          tags: [
            ["h", otherCommunityId],
            ["a", pointer.address, "", "community"],
          ],
        }),
      ),
    ).toBeUndefined()
    expect(
      parseCommunityAuthorityV2(makeEvent({tags: [...valid.tags, ["p", communityId]]}))?.address,
    ).toBe(pointer.address)
  })
})
