import {describe, expect, it, vi} from "vitest"
import {finalizeEvent, getPublicKey} from "nostr-tools/pure"
import * as nip19 from "nostr-tools/nip19"
import {
  classifyCommunitySearchQuery,
  getCommunitySearchAutoSubmitDelay,
  rankCommunitySearchDefinitions,
  searchCommunities,
} from "./community-discovery-search"
import {parseCommunityDefinition} from "./community"

const secret = new Uint8Array(32).fill(1)
const owner = getPublicKey(secret)
const otherSecret = new Uint8Array(32).fill(2)
const otherController = getPublicKey(otherSecret)

const makeDefinition = ({
  name,
  communityId,
  signingKey = secret,
  createdAt = 1,
}: {
  name: string
  communityId: string
  signingKey?: Uint8Array
  createdAt?: number
}) =>
  finalizeEvent(
    {
      kind: 32222,
      created_at: createdAt,
      content: "",
      tags: [
        ["d", communityId],
        ["name", name],
        ["r", "wss://bootstrap.example"],
        ["content", "General"],
        ["k", "1111"],
        ["a", `30000:${getPublicKey(signingKey)}:${communityId}-members`],
      ],
    },
    signingKey,
  )

const first = makeDefinition({
  name: "Buda Builders",
  communityId: getPublicKey(new Uint8Array(32).fill(3)),
})
const second = makeDefinition({
  name: "Buda Builders Europe",
  communityId: getPublicKey(new Uint8Array(32).fill(4)),
  signingKey: otherSecret,
})

describe("community discovery search", () => {
  it("classifies exact links, owners, NIP-05 and names", () => {
    const definition = parseCommunityDefinition(first)!
    expect(classifyCommunitySearchQuery(definition.pointer.naddr).type).toBe("exact")
    expect(classifyCommunitySearchQuery(owner).type).toBe("owner")
    expect(classifyCommunitySearchQuery("alice@example.com")).toEqual({
      type: "nip05",
      identifier: "alice@example.com",
    })
    expect(classifyCommunitySearchQuery("alice@example")).toEqual({
      type: "name",
      text: "alice@example",
    })
    expect(classifyCommunitySearchQuery("Buda Builders")).toEqual({
      type: "name",
      text: "Buda Builders",
    })
    expect(getCommunitySearchAutoSubmitDelay(definition.pointer.naddr)).toBe(250)
    expect(getCommunitySearchAutoSubmitDelay(nip19.npubEncode(owner))).toBe(250)
    expect(getCommunitySearchAutoSubmitDelay("alice@example.com")).toBe(250)
    expect(getCommunitySearchAutoSubmitDelay("Buda Builders")).toBe(400)
    expect(getCommunitySearchAutoSubmitDelay("   ")).toBe(0)
  })

  it("ranks preferred exact-name matches before weaker matches", () => {
    const definitions = [parseCommunityDefinition(second)!, parseCommunityDefinition(first)!]
    const ranked = rankCommunitySearchDefinitions({
      definitions,
      query: "Buda Builders",
      preferredAddresses: [definitions[1].pointer.address],
    })
    expect(ranked.map(result => result.definition.metadata.name)).toEqual([
      "Buda Builders",
      "Buda Builders Europe",
    ])
  })

  it("uses community-first owner evidence to order equally relevant names", () => {
    const other = makeDefinition({
      name: "Builders",
      communityId: getPublicKey(new Uint8Array(32).fill(5)),
      signingKey: otherSecret,
    })
    const local = makeDefinition({
      name: "Builders",
      communityId: getPublicKey(new Uint8Array(32).fill(6)),
    })
    const ranked = rankCommunitySearchDefinitions({
      definitions: [parseCommunityDefinition(local)!, parseCommunityDefinition(other)!],
      query: "Builders",
      candidateOwnerPubkeys: [otherController, owner],
    })

    expect(ranked.map(result => result.definition.ownerPubkey)).toEqual([otherController, owner])
  })

  it("queries bootstrap and capped candidate outbox relays for names", async () => {
    const loadEvents = vi
      .fn()
      .mockResolvedValueOnce([first])
      .mockResolvedValueOnce([second])
      .mockResolvedValue([])
    const hydrateOutbox = vi.fn().mockResolvedValue(["wss://outbox.example"])
    const result = await searchCommunities("Buda", {
      bootstrapRelays: ["wss://bootstrap.example"],
      peopleCandidates: [otherController],
      localEvents: [],
      loadEvents,
      hydrateOutbox,
    })

    expect(loadEvents.mock.calls[0][0]).toEqual(["wss://bootstrap.example/"])
    expect(
      loadEvents.mock.calls.slice(1).some(call => call[0][0] === "wss://outbox.example/"),
    ).toBe(true)
    expect(result.results.map(item => item.definition.metadata.name)).toEqual([
      "Buda Builders",
      "Buda Builders Europe",
    ])
  })

  it("resolves NIP-05 to a owner without treating it as a community ID", async () => {
    const loadEvents = vi.fn().mockResolvedValue([second])
    const result = await searchCommunities("alice@example.com", {
      bootstrapRelays: ["wss://bootstrap.example"],
      localEvents: [],
      loadEvents,
      hydrateOutbox: vi.fn().mockResolvedValue([]),
      resolveNip05: vi.fn().mockResolvedValue({pubkey: otherController}),
    })

    expect(loadEvents.mock.calls[0][1][0].authors).toEqual([otherController])
    expect(result.results[0]?.definition.ownerPubkey).toBe(otherController)
  })
})
