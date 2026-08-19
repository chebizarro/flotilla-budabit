import {describe, expect, it} from "vitest"
import * as nip19 from "nostr-tools/nip19"
import {ParsedType, type ParsedLink} from "@welshman/content"
import {
  findCommunityLinkStart,
  getCommunityLinkAtStart,
  isCommunityLinkToken,
  parseCommunityLink,
  replaceCommunityLinks,
} from "./community-links"

const owner = "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f"
const communityId = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9"
const naddr = nip19.naddrEncode({
  kind: 32222,
  pubkey: owner,
  identifier: communityId,
  relays: ["wss://relay.example"],
})

describe("community link helpers", () => {
  it("parses strict community definition naddrs with an optional nostr prefix", () => {
    expect(parseCommunityLink(naddr)).toMatchObject({
      ownerPubkey: owner,
      communityId,
      relayHints: ["wss://relay.example"],
    })
    expect(parseCommunityLink(`nostr:${naddr}`)?.address).toBe(`32222:${owner}:${communityId}`)
  })

  it("rejects wrong-kind naddrs and legacy community inputs", () => {
    const wrongKind = nip19.naddrEncode({kind: 30023, pubkey: owner, identifier: communityId})

    expect(parseCommunityLink(wrongKind)).toBeUndefined()
    expect(parseCommunityLink(`ncommunity://${communityId}`)).toBeUndefined()
    expect(parseCommunityLink(nip19.npubEncode(owner))).toBeUndefined()
    expect(parseCommunityLink(owner)).toBeUndefined()
  })

  it("finds standalone exact community links", () => {
    expect(findCommunityLinkStart(`share ${naddr}`)).toBe(6)
    expect(findCommunityLinkStart(`https://example.com/${naddr}`)).toBe(-1)
  })

  it("tokenizes exact community links at the current parser position", () => {
    expect(getCommunityLinkAtStart(`${naddr}.`)).toMatchObject({
      type: "community",
      raw: naddr,
      value: {ownerPubkey: owner, communityId},
    })
  })

  it("replaces parsed links with exact community tokens", () => {
    const parsedLink: ParsedLink = {
      type: ParsedType.Link,
      raw: naddr,
      value: {url: new URL(`nostr:${naddr}`), meta: {}},
    }

    const [token] = replaceCommunityLinks([parsedLink])

    expect(isCommunityLinkToken(token)).toBe(true)
    expect(token).toMatchObject({value: {ownerPubkey: owner, communityId}})
  })
})
