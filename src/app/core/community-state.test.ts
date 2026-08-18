import {describe, expect, it} from "vitest"
import {getPublicKey} from "nostr-tools/pure"
import type {TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND_V2,
  PROFILE_LIST_KIND,
  buildCommunityDefinitionV2,
  makeCommunityPointer,
  parseCommunityDefinitionV2,
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
const controllerPubkey = key(21)
const communityId = key(22)
const listPubkey = key(23)
const pointer = makeCommunityPointer({
  controllerPubkey,
  communityId,
  relayHints: ["wss://hint.example"],
})!

const template = buildCommunityDefinitionV2({
  communityId,
  name: "Community",
  relays: ["wss://relay.example.com"],
  blossomServers: ["https://blossom.example.com"],
  sections: [
    {
      name: "General",
      kinds: [{kind: 1111}],
      profileLists: [{address: `${PROFILE_LIST_KIND}:${listPubkey}:General`}],
    },
  ],
})
const definition = parseCommunityDefinitionV2({
  id: "definition",
  pubkey: controllerPubkey,
  created_at: 1,
  kind: COMMUNITY_DEFINITION_KIND_V2,
  tags: template.tags,
  content: "",
  sig: "sig",
} as TrustedEvent)!

describe("community state helpers", () => {
  it("keys bootstraps by exact V2 address, not hints", () => {
    const first = makeExactCommunitySession(pointer)
    const second = makeExactCommunitySession(
      makeCommunityPointer({controllerPubkey, communityId, relayHints: ["wss://other.example"]})!,
    )

    expect(getCommunityBootstrapKey(first, listPubkey)).toBe(
      getCommunityBootstrapKey(second, listPubkey),
    )
    expect(getCommunityBootstrapKey(first, listPubkey)).toContain(pointer.address)
  })

  it("builds relay sets from explicit V2 hints", () => {
    expect(getCommunityBootstrapRelays(["wss://relay.example.com", "bad-relay"])).toEqual([
      "wss://relay.example.com/",
      ...COMMUNITY_DISCOVERY_RELAYS,
    ])
    expect(getCommunityDefinitionRelayHints(definition)).toContain("wss://relay.example.com/")
  })

  it("reads V2 definition infrastructure", () => {
    expect(getCommunityBlossomServers(definition)).toEqual(["https://blossom.example.com"])
    expect(makeCommunityProfileListFilters(definition)).toContainEqual({
      kinds: [PROFILE_LIST_KIND],
      authors: [listPubkey],
      "#d": ["General"],
      limit: 1,
    })
    expect(makeCommunityAdmissionFormFilters(definition)[0]).toMatchObject({
      "#a": [pointer.address],
    })
  })
})
