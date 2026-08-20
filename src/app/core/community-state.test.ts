import {describe, expect, it} from "vitest"
import {getPublicKey} from "nostr-tools/pure"
import type {TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  buildCommunityDefinition,
  makeCommunityPointer,
  parseCommunityDefinition,
} from "./community"
import {
  COMMUNITY_DISCOVERY_RELAYS,
  getCommunityBlossomServers,
  getCommunityBootstrapKey,
  getCommunityBootstrapRelays,
  getCommunityDefinitionRelayHints,
  makeCommunityAdmissionFormFilters,
  makeCommunityProfileListFilters,
  makeExactCommunitySession,
} from "./community-state"

const key = (value: number) => getPublicKey(new Uint8Array(32).fill(value))
const ownerPubkey = key(21)
const communityId = key(22)
const listPubkey = key(23)
const pointer = makeCommunityPointer({
  ownerPubkey,
  communityId,
  relayHints: ["wss://hint.example"],
})!

const template = buildCommunityDefinition({
  communityId,
  name: "Community",
  relays: ["wss://relay.example.com"],
  blossomServers: ["https://blossom.example.com"],
  sections: [
    {
      name: "General",
      kinds: [{kind: 1111}],
      profileLists: [{address: `${PROFILE_LIST_KIND}:${listPubkey}:${communityId}-general`}],
    },
  ],
})
const definition = parseCommunityDefinition({
  id: "definition",
  pubkey: ownerPubkey,
  created_at: 1,
  kind: COMMUNITY_DEFINITION_KIND,
  tags: template.tags,
  content: "",
  sig: "sig",
} as TrustedEvent)!

describe("community state helpers", () => {
  it("keys bootstraps by exact address, not hints", () => {
    const first = makeExactCommunitySession(pointer)
    const second = makeExactCommunitySession(
      makeCommunityPointer({ownerPubkey, communityId, relayHints: ["wss://other.example"]})!,
    )

    expect(getCommunityBootstrapKey(first, listPubkey)).toBe(
      getCommunityBootstrapKey(second, listPubkey),
    )
    expect(getCommunityBootstrapKey(first, listPubkey)).toContain(pointer.address)
  })

  it("builds relay sets from explicit hints", () => {
    expect(getCommunityBootstrapRelays(["wss://relay.example.com", "bad-relay"])).toEqual([
      "wss://relay.example.com/",
      ...COMMUNITY_DISCOVERY_RELAYS,
    ])
    expect(getCommunityDefinitionRelayHints(definition)).toContain("wss://relay.example.com/")
  })

  it("reads definition infrastructure", () => {
    expect(getCommunityBlossomServers(definition)).toEqual(["https://blossom.example.com"])
    expect(makeCommunityProfileListFilters(definition)).toContainEqual({
      kinds: [PROFILE_LIST_KIND],
      "#d": [`${communityId}-general`],
      limit: 200,
    })
    expect(makeCommunityProfileListFilters(definition)).toContainEqual({
      kinds: [5],
      "#a": [`${PROFILE_LIST_KIND}:${listPubkey}:${communityId}-general`],
      limit: 200,
    })
    expect(makeCommunityAdmissionFormFilters(definition)[0]).toMatchObject({
      "#a": [pointer.address],
    })
  })
})
