import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  buildCommunityDefinition,
  normalizeRelays,
  parseCommunityDefinition,
} from "./community"
import {getPublicKey} from "nostr-tools/pure"
import type {ActiveUserCommunityRef} from "./community-membership"
import {
  CASHU_MINT_LIST_KIND,
  buildCashuMintRecommendations,
  getCashuMintRecommendationAuthors,
  normalizeCashuMintUrl,
} from "./cashu-mint-recommendations"

const testPubkey = (value: number) => getPublicKey(new Uint8Array(32).fill(value))

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: overrides.id || "e".repeat(64),
    pubkey: overrides.pubkey || "a".repeat(64),
    created_at: overrides.created_at || 1,
    kind: overrides.kind || 1,
    tags: overrides.tags || [],
    content: overrides.content || "",
    sig: overrides.sig || "sig",
  }) as TrustedEvent

const communityIds = new Map<string, string>(
  ["community", "first", "second", "shared-id"].map((id, index) => [
    id,
    getPublicKey(new Uint8Array(32).fill(42 + index)),
  ]),
)
const fallbackProfileListOwner = getPublicKey(new Uint8Array(32).fill(60))

const makeDefinition = ({
  communityPubkey,
  mintUrl,
  listAddresses = [],
  identifier = "community",
}: {
  communityPubkey: string
  mintUrl?: string
  listAddresses?: string[]
  identifier?: string
}) =>
  parseCommunityDefinition(
    makeEvent({
      id: communityPubkey.slice(0, 8),
      pubkey: communityPubkey,
      kind: COMMUNITY_DEFINITION_KIND,
      tags: buildCommunityDefinition({
        communityId: communityIds.get(identifier)!,
        name: identifier,
        relays: ["wss://relay.example.com"],
        mints: mintUrl ? [{url: mintUrl.replace(/\/$/, ""), type: "cashu"}] : [],
        sections: [
          {
            name: "Repositories",
            kinds: [{kind: 30617}],
            profileLists: (listAddresses.length
              ? listAddresses
              : [`${PROFILE_LIST_KIND}:${fallbackProfileListOwner}:Repositories`]
            ).map(address => ({address})),
          },
        ],
      }).tags,
    }),
  )!

const makeProfileList = ({
  pubkey,
  identifier = "Repositories",
  members = [],
}: {
  pubkey: string
  identifier?: string
  members?: Array<string | [string, string]>
}) =>
  makeEvent({
    id: `${pubkey.slice(0, 8)}-${identifier}`,
    pubkey,
    kind: PROFILE_LIST_KIND,
    tags: [
      ["d", identifier],
      ...members.map(member =>
        Array.isArray(member) ? ["p", member[0], member[1]] : ["p", member],
      ),
    ],
  })

const makeCommunityRef = (
  definition: ReturnType<typeof makeDefinition>,
  roles: ActiveUserCommunityRef["roles"] = ["member"],
): ActiveUserCommunityRef => ({
  community: definition.pointer,
  definition,
  relayHints: definition.relays,
  roles,
  writableSections: ["Repositories"],
})

const makeMintList = ({
  pubkey,
  mints,
  created_at = 1,
}: {
  pubkey: string
  mints: string[]
  created_at?: number
}) =>
  makeEvent({
    id: `${pubkey.slice(0, 8)}-${created_at}`,
    pubkey,
    kind: CASHU_MINT_LIST_KIND,
    created_at,
    tags: mints.map(mint => ["mint", mint, "sat"]),
  })

describe("cashu mint recommendations", () => {
  it("normalizes mint URLs for dedupe", () => {
    expect(normalizeCashuMintUrl("https://MINT.example.com/path/?x=1#frag")).toBe(
      "https://mint.example.com/path",
    )
  })

  it("scores community mints above personal 10019 and direct follows", () => {
    const viewer = testPubkey(1)
    const community = testPubkey(2)
    const listOwner = testPubkey(3)
    const recommender = testPubkey(4)
    const followed = testPubkey(5)
    const listAddress = `${PROFILE_LIST_KIND}:${listOwner}:Repositories`
    const definition = makeDefinition({
      communityPubkey: community,
      mintUrl: "https://community.example.com/",
      listAddresses: [listAddress],
    })
    const profileList = makeProfileList({pubkey: listOwner, members: [viewer, recommender]})
    const recommendations = buildCashuMintRecommendations({
      viewerPubkey: viewer,
      communityRefs: [makeCommunityRef(definition)],
      profileListEvents: [profileList],
      follows: [followed],
      mintListEvents: [
        makeMintList({pubkey: viewer, mints: ["https://own.example.com"]}),
        makeMintList({pubkey: recommender, mints: ["https://member.example.com"]}),
        makeMintList({pubkey: followed, mints: ["https://follow.example.com"]}),
      ],
    })

    expect(recommendations.map(item => item.mintUrl)).toEqual([
      "https://community.example.com",
      "https://own.example.com",
      "https://member.example.com",
      "https://follow.example.com",
    ])
    expect(recommendations[0].counts.communities).toBe(1)
    expect(recommendations[0].evidence[0]).toEqual(
      expect.objectContaining({
        source: "32222",
        pubkey: definition.ownerPubkey,
        communityPubkey: definition.ownerPubkey,
        communityAddress: definition.pointer.address,
      }),
    )
    expect(recommendations[0].evidence[0].pubkey).not.toBe(definition.communityId)
    expect(recommendations[1].counts.ownNutzap).toBe(1)
    expect(recommendations[2].counts.members).toBe(1)
    expect(recommendations[3].counts.follows).toBe(1)
  })

  it("attaches relay hints for recommendation evidence profiles", () => {
    const viewer = testPubkey(1)
    const community = testPubkey(2)
    const listOwner = testPubkey(3)
    const recommender = testPubkey(4)
    const listAddress = `${PROFILE_LIST_KIND}:${listOwner}:Repositories`
    const definition = makeDefinition({
      communityPubkey: community,
      mintUrl: "https://community.example.com/",
      listAddresses: [listAddress],
    })
    const profileList = makeProfileList({
      pubkey: listOwner,
      members: [viewer, [recommender, "wss://member-profile.example.com"]],
    })

    const recommendations = buildCashuMintRecommendations({
      viewerPubkey: viewer,
      communityRefs: [makeCommunityRef(definition)],
      profileListEvents: [profileList],
      mintListEvents: [makeMintList({pubkey: recommender, mints: ["https://member.example.com"]})],
    })
    const communityEvidence = recommendations
      .find(item => item.mintUrl === "https://community.example.com")
      ?.evidence.find(evidence => evidence.kind === "community")
    const memberEvidence = recommendations
      .find(item => item.mintUrl === "https://member.example.com")
      ?.evidence.find(evidence => evidence.kind === "member")

    expect(communityEvidence?.relayHints).toEqual(normalizeRelays(["wss://relay.example.com"]))
    expect(memberEvidence?.communityRelayHints).toEqual(
      normalizeRelays(["wss://relay.example.com"]),
    )
    expect(memberEvidence?.relayHints).toEqual(
      expect.arrayContaining(
        normalizeRelays(["wss://relay.example.com", "wss://member-profile.example.com"]),
      ),
    )
  })

  it("orders direct 32222 community mints before owner-owned 10019 mints", () => {
    const viewer = testPubkey(1)
    const community = testPubkey(2)
    const listOwner = testPubkey(3)
    const listAddress = `${PROFILE_LIST_KIND}:${listOwner}:Repositories`
    const definition = makeDefinition({
      communityPubkey: community,
      mintUrl: "https://zzz-community.example.com/",
      listAddresses: [listAddress],
    })
    const recommendations = buildCashuMintRecommendations({
      viewerPubkey: viewer,
      communityRefs: [makeCommunityRef(definition)],
      profileListEvents: [makeProfileList({pubkey: listOwner, members: [viewer]})],
      mintListEvents: [makeMintList({pubkey: community, mints: ["https://aaa-10019.example.com"]})],
    })

    expect(recommendations.map(item => item.mintUrl)).toEqual([
      "https://zzz-community.example.com",
      "https://aaa-10019.example.com",
    ])
    expect(recommendations[0].evidence.some(evidence => evidence.source === "32222")).toBe(true)
    expect(recommendations[1].evidence.every(evidence => evidence.source === "10019")).toBe(true)
  })

  it("dedupes mints and excludes already trusted mints", () => {
    const viewer = getPublicKey(new Uint8Array(32).fill(61))
    const community = viewer
    const definition = makeDefinition({
      communityPubkey: community,
      mintUrl: "https://trusted.example.com/",
    })
    const recommendations = buildCashuMintRecommendations({
      viewerPubkey: viewer,
      trustedMints: ["https://trusted.example.com"],
      communityRefs: [makeCommunityRef(definition, ["admin"])],
      mintListEvents: [
        makeMintList({
          pubkey: viewer,
          mints: ["https://trusted.example.com", "https://new.example.com/"],
        }),
      ],
    })

    expect(recommendations.map(item => item.mintUrl)).toEqual(["https://new.example.com"])
  })

  it("does not count muted direct follows as follow evidence", () => {
    const viewer = testPubkey(1)
    const followed = testPubkey(2)
    const recommendations = buildCashuMintRecommendations({
      viewerPubkey: viewer,
      follows: [followed],
      mutes: [followed],
      mintListEvents: [makeMintList({pubkey: followed, mints: ["https://muted.example.com"]})],
    })

    expect(recommendations).toEqual([])
  })

  it("prioritizes community and moderator authors before member authors", () => {
    const viewer = testPubkey(1)
    const community = testPubkey(2)
    const moderator = testPubkey(3)
    const member = testPubkey(4)
    const definition = makeDefinition({
      communityPubkey: community,
      listAddresses: [`${PROFILE_LIST_KIND}:${moderator}:Repositories`],
    })
    const authors = getCashuMintRecommendationAuthors({
      viewerPubkey: viewer,
      follows: [testPubkey(5)],
      communityRefs: [makeCommunityRef(definition)],
      profileListEvents: [makeProfileList({pubkey: moderator, members: [viewer, member]})],
    })

    expect(authors.slice(0, 5)).toEqual([viewer, community, moderator, testPubkey(5), member])
  })

  it("keeps same-owner sibling recommendation evidence on exact addresses", () => {
    const viewer = testPubkey(1)
    const owner = testPubkey(2)
    const moderatorA = testPubkey(3)
    const moderatorB = testPubkey(4)
    const recommender = testPubkey(5)
    const first = makeDefinition({
      communityPubkey: owner,
      identifier: "first",
      mintUrl: "https://first.example.com",
      listAddresses: [`${PROFILE_LIST_KIND}:${moderatorA}:Repositories`],
    })
    const second = makeDefinition({
      communityPubkey: owner,
      identifier: "second",
      mintUrl: "https://second.example.com",
      listAddresses: [`${PROFILE_LIST_KIND}:${moderatorB}:Repositories`],
    })
    const recommendations = buildCashuMintRecommendations({
      viewerPubkey: viewer,
      communityRefs: [makeCommunityRef(first), makeCommunityRef(second)],
      profileListEvents: [
        makeProfileList({pubkey: moderatorA, members: [viewer, recommender]}),
        makeProfileList({pubkey: moderatorB, members: [viewer]}),
      ],
      mintListEvents: [
        makeMintList({pubkey: recommender, mints: ["https://recommended.example.com"]}),
      ],
    })

    expect(recommendations.map(item => item.mintUrl)).toEqual(
      expect.arrayContaining(["https://first.example.com", "https://second.example.com"]),
    )
    expect(
      recommendations.find(item => item.mintUrl === "https://recommended.example.com")?.evidence,
    ).toEqual([expect.objectContaining({communityAddress: first.pointer.address})])
    expect(
      recommendations.find(item => item.mintUrl === "https://second.example.com")?.evidence,
    ).toEqual([expect.objectContaining({communityAddress: second.pointer.address})])
  })

  it("keeps same-ID branches distinct by owner address", () => {
    const viewer = testPubkey(1)
    const firstController = testPubkey(2)
    const secondController = testPubkey(3)
    const firstModerator = getPublicKey(new Uint8Array(32).fill(54))
    const secondModerator = getPublicKey(new Uint8Array(32).fill(55))
    const first = makeDefinition({
      communityPubkey: firstController,
      identifier: "shared-id",
      mintUrl: "https://first-id.example.com",
      listAddresses: [`${PROFILE_LIST_KIND}:${firstModerator}:Repositories`],
    })
    const second = makeDefinition({
      communityPubkey: secondController,
      identifier: "shared-id",
      mintUrl: "https://second-id.example.com",
      listAddresses: [`${PROFILE_LIST_KIND}:${secondModerator}:Repositories`],
    })
    const recommendations = buildCashuMintRecommendations({
      viewerPubkey: viewer,
      communityRefs: [makeCommunityRef(first), makeCommunityRef(second)],
      profileListEvents: [
        makeProfileList({pubkey: firstModerator, members: [viewer]}),
        makeProfileList({pubkey: secondModerator, members: [viewer]}),
      ],
    })

    expect(recommendations.map(item => item.evidence[0].communityAddress)).toEqual(
      expect.arrayContaining([first.pointer.address, second.pointer.address]),
    )
  })
})
