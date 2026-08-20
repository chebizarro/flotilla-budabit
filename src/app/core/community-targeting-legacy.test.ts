import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {TARGETED_PUBLICATION_KIND} from "./community"
import {
  makeLegacyCommunityTargetingFilter,
  makeLegacyTargetedPublicationOriginalFilterPlan,
  parseLegacyTargetedPublication,
  selectCurrentLegacyTargetedPublicationEvents,
} from "./community-targeting-legacy"
import {makeTargetedPublicationOriginalFilterPlan} from "./community-feeds"

const makeEvent = (overrides: Partial<TrustedEvent> = {}): TrustedEvent =>
  ({
    id: "1".repeat(64),
    pubkey: "2".repeat(64),
    created_at: 1,
    kind: TARGETED_PUBLICATION_KIND,
    tags: [
      ["d", "target-id"],
      ["a", `31923:${"2".repeat(64)}:event-id`, "wss://relay.example/"],
      ["k", "31923"],
      ["p", "3".repeat(64)],
      ["r", "wss://community.example/"],
    ],
    content: "",
    sig: "4".repeat(128),
    ...overrides,
  }) as TrustedEvent

describe("legacy community targeting reads", () => {
  it("queries the previously shipped p-scoped wrappers", () => {
    expect(makeLegacyCommunityTargetingFilter("community", [9041, 31923])).toEqual({
      kinds: [TARGETED_PUBLICATION_KIND],
      "#p": ["community"],
      "#k": ["9041", "31923"],
    })
  })

  it("parses an old address-targeted wrapper without weakening the V2 parser", () => {
    expect(parseLegacyTargetedPublication(makeEvent())).toEqual({
      id: "target-id",
      kind: 31923,
      communityPubkey: "3".repeat(64),
      source: {
        type: "a",
        value: `31923:${"2".repeat(64)}:event-id`,
        relay: "wss://relay.example/",
      },
    })
  })

  it("selects the newest replacement deterministically", () => {
    const older = makeEvent({id: "5".repeat(64), created_at: 1})
    const newer = makeEvent({id: "6".repeat(64), created_at: 2})

    expect(selectCurrentLegacyTargetedPublicationEvents([newer, older])).toEqual([newer])
  })

  it("resolves the original publication from an admitted legacy wrapper", () => {
    expect(makeTargetedPublicationOriginalFilterPlan([makeEvent()])).toEqual({
      relayFilters: [],
      localFilters: [],
    })
    expect(makeLegacyTargetedPublicationOriginalFilterPlan([makeEvent()])).toEqual({
      relayFilters: [
        {
          kinds: [31923],
          authors: ["2".repeat(64)],
          "#d": ["event-id"],
          limit: 1,
        },
      ],
      localFilters: [
        {
          kinds: [31923],
          authors: ["2".repeat(64)],
          "#d": ["event-id"],
          limit: 1,
        },
      ],
    })
  })
})
