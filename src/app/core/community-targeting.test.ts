import {describe, expect, it} from "vitest"
import {getPublicKey} from "nostr-tools/pure"
import {EVENT_DATE, EVENT_TIME, type TrustedEvent} from "@welshman/util"
import {
  TARGETED_PUBLICATION_KIND_V2,
  buildTargetedPublicationV2,
  makeCommunityPointer,
  parseTargetedPublicationV2,
} from "./community"
import {
  getPublicationTargetingId,
  makeAddressablePublicationRef,
  makeEventPublicationRef,
  makeTargetedPublicationForCommunityV2,
  removeCommunityTarget,
  shouldTargetPublicationKind,
  upsertCommunityTarget,
  withPublicationTargetingId,
} from "./community-targeting"

const secret = (value: number) => new Uint8Array(32).fill(value)
const authorPubkey = getPublicKey(secret(21))
const first = makeCommunityPointer({
  controllerPubkey: getPublicKey(secret(22)),
  communityId: getPublicKey(secret(23)),
  relayHints: ["wss://first.example"],
})!
const second = makeCommunityPointer({
  controllerPubkey: getPublicKey(secret(24)),
  communityId: first.communityId,
  relayHints: ["wss://second.example"],
})!

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "1".repeat(64),
    pubkey: authorPubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "f".repeat(128),
    ...overrides,
  }) as TrustedEvent

describe("community targeting helpers", () => {
  it("knows which kinds are targeted publications", () => {
    expect(shouldTargetPublicationKind(EVENT_TIME)).toBe(true)
    expect(shouldTargetPublicationKind(EVENT_DATE)).toBe(true)
    expect(shouldTargetPublicationKind(9041)).toBe(true)
    expect(shouldTargetPublicationKind(30617)).toBe(false)
    expect(shouldTargetPublicationKind(1623)).toBe(true)
    expect(shouldTargetPublicationKind(30033)).toBe(true)
    expect(shouldTargetPublicationKind(11)).toBe(false)
  })

  it("adds stable h targeting ids to original publication templates", () => {
    const template = withPublicationTargetingId(
      {
        content: "Event",
        tags: [
          ["h", "old"],
          ["title", "Demo"],
        ],
      },
      "target-id",
    )

    expect(template).toEqual({
      content: "Event",
      tags: [
        ["h", "target-id"],
        ["title", "Demo"],
      ],
      targetingId: "target-id",
    })
    expect(getPublicationTargetingId(template)).toBe("target-id")
  })

  it("builds marked publication source refs", () => {
    expect(
      makeAddressablePublicationRef({
        kind: EVENT_TIME,
        pubkey: authorPubkey,
        identifier: "calendar-1",
        relay: "wss://relay.example",
      }),
    ).toEqual({
      type: "a",
      value: `${EVENT_TIME}:${authorPubkey}:calendar-1`,
      relay: "wss://relay.example",
    })
    expect(makeEventPublicationRef({id: "2".repeat(64), relay: "wss://relay.example"})).toEqual({
      type: "e",
      value: "2".repeat(64),
      relay: "wss://relay.example",
      pubkey: undefined,
    })
  })

  it("builds one exact targeting pair without a community p tag", () => {
    const template = makeTargetedPublicationForCommunityV2({
      targetingId: "target-id",
      originalKind: EVENT_TIME,
      originalRef: makeAddressablePublicationRef({
        kind: EVENT_TIME,
        pubkey: authorPubkey,
        identifier: "calendar-1",
      }),
      community: first,
    })

    expect(template).toEqual({
      kind: TARGETED_PUBLICATION_KIND_V2,
      content: "",
      tags: [
        ["d", "target-id"],
        ["a", `${EVENT_TIME}:${authorPubkey}:calendar-1`, "", "source"],
        ["k", String(EVENT_TIME)],
        ["h", first.communityId],
        ["a", first.address, "wss://first.example", "community"],
      ],
    })
    expect(template.tags.some(tag => tag[0] === "p")).toBe(false)
  })

  it("upserts and removes same-ID branches by exact address while preserving extensions", () => {
    const targetingEvent = makeEvent({
      kind: TARGETED_PUBLICATION_KIND_V2,
      tags: [
        ...buildTargetedPublicationV2({
          id: "target-id",
          kind: 9041,
          source: {type: "e", value: "3".repeat(64)},
          communities: [first],
        }).tags,
        ["x-extension", "preserve"],
      ],
    })

    const upserted = upsertCommunityTarget(targetingEvent, second)!
    const parsedUpserted = parseTargetedPublicationV2(
      makeEvent({kind: TARGETED_PUBLICATION_KIND_V2, tags: upserted.tags}),
    )!
    expect(parsedUpserted.communities.map(item => item.address)).toEqual([
      first.address,
      second.address,
    ])
    expect(upserted.tags).toContainEqual(["x-extension", "preserve"])

    const removed = removeCommunityTarget(
      makeEvent({kind: TARGETED_PUBLICATION_KIND_V2, tags: upserted.tags}),
      first.address,
    )!
    const parsedRemoved = parseTargetedPublicationV2(
      makeEvent({kind: TARGETED_PUBLICATION_KIND_V2, tags: removed.tags}),
    )!
    expect(parsedRemoved.communities.map(item => item.address)).toEqual([second.address])
    expect(removed.tags).toContainEqual(["x-extension", "preserve"])
  })
})
