import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"
import {GIT_USER_GRASP_LIST} from "@nostr-git/core/events"
import type {TrustedEvent} from "@welshman/util"
import * as nip19 from "nostr-tools/nip19"
import {getPublicKey} from "nostr-tools/pure"
import {
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  buildCommunityDefinition,
  makeCommunityPointer,
  parseCommunityDefinition,
} from "./community"
import type {ActiveUserCommunityRef} from "./community-membership"
import {
  buildGraspServerRecommendations,
  getGraspServerRecommendationAuthors,
  resolveDefaultCommunityGraspServerFallback,
  selectEffectiveGraspServerRecommendations,
} from "./grasp"

const communityId = getPublicKey(new Uint8Array(32).fill(42))
const communityIds = new Map([
  ["community", communityId],
  ["first", getPublicKey(new Uint8Array(32).fill(43))],
  ["second", getPublicKey(new Uint8Array(32).fill(44))],
  ["shared-id", getPublicKey(new Uint8Array(32).fill(45))],
])
const communityPointer = (ownerPubkey: string) => makeCommunityPointer({ownerPubkey, communityId})!

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: overrides.id || `${overrides.kind || 1}-${overrides.pubkey || ""}`.padStart(64, "0"),
    pubkey: overrides.pubkey || "a".repeat(64),
    created_at: overrides.created_at || 1,
    kind: overrides.kind || 1,
    tags: overrides.tags || [],
    content: overrides.content || "",
    sig: "0".repeat(128),
  }) as TrustedEvent

const makeCommunityRef = ({
  communityPubkey,
  moderatorPubkey,
  relay = "wss://community.relay.example",
  graspServers = [],
  identifier = "community",
}: {
  communityPubkey: string
  moderatorPubkey: string
  relay?: string
  graspServers?: string[]
  identifier?: string
}): ActiveUserCommunityRef => {
  const communityId = communityIds.get(identifier)!
  const listAddress = `${PROFILE_LIST_KIND}:${moderatorPubkey}:${communityId}-repositories`

  const definition = parseCommunityDefinition(
    makeEvent({
      pubkey: communityPubkey,
      created_at: 1,
      kind: COMMUNITY_DEFINITION_KIND,
      tags: buildCommunityDefinition({
        communityId,
        name: identifier,
        relays: [relay],
        graspServers: graspServers.map(url => url.replace(/\/$/, "")),
        sections: [
          {
            name: "Repositories",
            kinds: [{kind: 30617}],
            profileLists: [{address: listAddress, relay}],
          },
        ],
      }).tags,
    }),
  )!

  return {
    community: definition.pointer,
    relayHints: [relay],
    roles: ["member"],
    writableSections: ["Repositories"],
    definition,
  }
}

const makeProfileList = ({
  pubkey,
  members = [],
  community = "community",
}: {
  pubkey: string
  members?: string[]
  community?: string
}) =>
  makeEvent({
    id: `${pubkey.slice(0, 8)}-profile-list`,
    pubkey,
    kind: PROFILE_LIST_KIND,
    tags: [
      ["d", `${communityIds.get(community)!}-repositories`],
      ...members.map(member => ["p", member]),
    ],
  })

const makeGraspList = ({
  pubkey,
  urls,
  created_at = 1,
}: {
  pubkey: string
  urls: string[]
  created_at?: number
}) =>
  makeEvent({
    id: `${pubkey.slice(0, 8)}-${created_at}`,
    pubkey,
    kind: GIT_USER_GRASP_LIST,
    created_at,
    tags: urls.map(url => ["g", url]),
  })

describe("grasp recommendations", () => {
  it("keeps the exact default naddr for the fallback definition lookup", () => {
    const source = readFileSync(new URL("./grasp.ts", import.meta.url), "utf8")

    expect(source).toContain("communityInput: defaultCommunityPointer.naddr")
    expect(source).not.toContain("communityInput: defaultCommunity,")
  })

  it("orders recommendation authors community-first with default community before moderators", () => {
    const viewer = "1".repeat(64)
    const community = "2".repeat(64)
    const moderator = "3".repeat(64)
    const member = "4".repeat(64)
    const follow = "5".repeat(64)
    const starred = getPublicKey(new Uint8Array(32).fill(6))
    const defaultCommunity = "7".repeat(64)
    const communityRef = makeCommunityRef({communityPubkey: community, moderatorPubkey: moderator})
    const profileList = makeProfileList({pubkey: moderator, members: [viewer, member]})

    expect(
      getGraspServerRecommendationAuthors({
        viewerPubkey: viewer,
        follows: [follow],
        communityRefs: [communityRef],
        profileListEvents: [profileList],
        starredCommunities: [communityPointer(starred)],
        defaultCommunityPubkey: defaultCommunity,
      }).slice(0, 7),
    ).toEqual([viewer, community, defaultCommunity, moderator, member, starred, follow])
  })

  it("does not treat a owner's personal kind 10317 list as community infrastructure", () => {
    const viewer = "1".repeat(64)
    const community = "2".repeat(64)
    const moderator = "3".repeat(64)
    const member = "4".repeat(64)
    const starred = getPublicKey(new Uint8Array(32).fill(5))
    const follow = "6".repeat(64)
    const mutedFollow = "7".repeat(64)
    const communityRef = makeCommunityRef({communityPubkey: community, moderatorPubkey: moderator})
    const profileList = makeProfileList({pubkey: moderator, members: [viewer, member]})
    const recommendations = buildGraspServerRecommendations({
      viewerPubkey: viewer,
      communityRefs: [communityRef],
      profileListEvents: [profileList],
      follows: [follow, mutedFollow],
      mutes: [mutedFollow],
      starredCommunities: [communityPointer(starred)],
      userGraspListEvents: [
        makeGraspList({pubkey: community, urls: ["wss://community.grasp.example"]}),
        makeGraspList({pubkey: moderator, urls: ["wss://moderator.grasp.example"]}),
        makeGraspList({pubkey: member, urls: ["wss://member.grasp.example"]}),
        makeGraspList({pubkey: starred, urls: ["wss://starred.grasp.example"]}),
        makeGraspList({pubkey: follow, urls: ["wss://follow.grasp.example"]}),
        makeGraspList({pubkey: mutedFollow, urls: ["wss://muted.grasp.example"]}),
      ],
    })

    expect(recommendations.map(recommendation => recommendation.url)).toEqual([
      "wss://moderator.grasp.example",
      "wss://member.grasp.example",
      "wss://starred.grasp.example",
      "wss://follow.grasp.example",
    ])
    expect(recommendations.map(recommendation => recommendation.evidence[0].source)).toEqual([
      "moderator_grasp",
      "member_grasp",
      "starred_community_grasp",
      "follow_grasp",
    ])
  })

  it("keeps same-ID starred branches as independent GRASP evidence", () => {
    const controllerA = getPublicKey(new Uint8Array(32).fill(8))
    const controllerB = getPublicKey(new Uint8Array(32).fill(9))
    const first = communityPointer(controllerA)
    const second = communityPointer(controllerB)

    const recommendations = buildGraspServerRecommendations({
      starredCommunities: [first, second],
      userGraspListEvents: [
        makeGraspList({pubkey: controllerA, urls: ["wss://shared.grasp.example"]}),
        makeGraspList({pubkey: controllerB, urls: ["wss://shared.grasp.example"]}),
      ],
    })

    expect(recommendations[0].communityAddresses).toEqual([first.address, second.address])
    expect(recommendations[0].evidence).toHaveLength(2)
  })

  it("keeps same-owner sibling infrastructure and recommendations branch-local", () => {
    const owner = getPublicKey(new Uint8Array(32).fill(10))
    const moderatorA = getPublicKey(new Uint8Array(32).fill(11))
    const moderatorB = getPublicKey(new Uint8Array(32).fill(12))
    const first = makeCommunityRef({
      communityPubkey: owner,
      moderatorPubkey: moderatorA,
      identifier: "first",
      graspServers: ["wss://first.infrastructure.example"],
    })
    const second = makeCommunityRef({
      communityPubkey: owner,
      moderatorPubkey: moderatorB,
      identifier: "second",
      graspServers: ["wss://second.infrastructure.example"],
    })
    const recommendations = buildGraspServerRecommendations({
      communityRefs: [first, second],
      userGraspListEvents: [
        makeGraspList({pubkey: owner, urls: ["wss://owner.recommendation.example"]}),
      ],
    })

    expect(recommendations.map(item => item.url)).toEqual(
      expect.arrayContaining([
        "wss://first.infrastructure.example",
        "wss://second.infrastructure.example",
      ]),
    )
    expect(recommendations.some(item => item.url.includes("owner.recommendation"))).toBe(false)
  })

  it("uses definition servers without importing the owner's personal list", () => {
    const viewer = "1".repeat(64)
    const community = "2".repeat(64)
    const moderator = "3".repeat(64)
    const communityRef = makeCommunityRef({
      communityPubkey: community,
      moderatorPubkey: moderator,
      graspServers: ["wss://declared.grasp.example/"],
    })
    const profileList = makeProfileList({pubkey: moderator, members: [viewer]})
    const recommendations = buildGraspServerRecommendations({
      viewerPubkey: viewer,
      communityRefs: [communityRef],
      profileListEvents: [profileList],
      userGraspListEvents: [
        makeGraspList({
          pubkey: community,
          urls: ["wss://declared.grasp.example", "wss://root-list-only.example"],
        }),
      ],
    })

    expect(recommendations.map(recommendation => recommendation.url)).toEqual([
      "wss://declared.grasp.example",
    ])
    expect(recommendations[0].evidence.map(evidence => evidence.source)).toEqual([
      "community_definition_grasp",
    ])
  })

  it("excludes renounced community GRASP evidence", () => {
    const viewer = "1".repeat(64)
    const community = "2".repeat(64)
    const moderator = "3".repeat(64)
    const communityRef = makeCommunityRef({
      communityPubkey: community,
      moderatorPubkey: moderator,
      graspServers: ["wss://declared.grasp.example"],
    })

    expect(
      buildGraspServerRecommendations({
        viewerPubkey: viewer,
        communityRefs: [communityRef],
        excludedCommunityAddresses: [communityRef.community.address],
      }),
    ).toEqual([])
  })

  it("keeps community recommendations visible when the personal GRASP list is empty", () => {
    const viewer = "1".repeat(64)
    const community = "2".repeat(64)
    const moderator = "3".repeat(64)
    const communityRef = makeCommunityRef({
      communityPubkey: community,
      moderatorPubkey: moderator,
      graspServers: ["wss://declared.grasp.example"],
    })
    const recommendations = buildGraspServerRecommendations({
      viewerPubkey: viewer,
      communityRefs: [communityRef],
      userGraspListEvents: [makeGraspList({pubkey: viewer, urls: []})],
    })

    expect(recommendations.map(recommendation => recommendation.url)).toEqual([
      "wss://declared.grasp.example",
    ])
    expect(recommendations[0].evidence[0].source).toBe("community_definition_grasp")
  })

  it("uses default community fallback only when no normal recommendation exists", () => {
    const defaultCommunity = "8".repeat(64)
    const follow = "9".repeat(64)
    const fallbackOnly = buildGraspServerRecommendations({
      defaultCommunityPubkey: defaultCommunity,
      userGraspListEvents: [
        makeGraspList({pubkey: defaultCommunity, urls: ["wss://default.grasp.example"]}),
      ],
    })
    const withFollow = buildGraspServerRecommendations({
      defaultCommunityPubkey: defaultCommunity,
      follows: [follow],
      userGraspListEvents: [
        makeGraspList({pubkey: defaultCommunity, urls: ["wss://default.grasp.example"]}),
        makeGraspList({pubkey: follow, urls: ["wss://follow.grasp.example"]}),
      ],
    })

    expect(selectEffectiveGraspServerRecommendations(fallbackOnly).map(item => item.url)).toEqual([
      "wss://default.grasp.example",
    ])
    expect(selectEffectiveGraspServerRecommendations(withFollow).map(item => item.url)).toEqual([
      "wss://follow.grasp.example",
    ])
  })

  it("resolves default community fallback through definition relays", async () => {
    const defaultCommunity = "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f"
    const communityInput = nip19.naddrEncode({
      kind: 32222,
      pubkey: defaultCommunity,
      identifier: "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
      relays: ["wss://hint.example"],
    })
    const loaded: {authors: string[]; relays: string[]}[] = []
    const result = await resolveDefaultCommunityGraspServerFallback({
      communityInput,
      indexerRelays: ["wss://index.example"],
      loadDefinition: async () => ({relays: ["wss://community.example"]}) as any,
      loadEvents: async (authors, relays) => {
        loaded.push({authors, relays})
        return []
      },
      queryEvents: () => [
        makeGraspList({pubkey: defaultCommunity, urls: ["wss://default.grasp.example/"]}),
      ],
    })

    expect(result.urls).toEqual(["wss://default.grasp.example"])
    expect(loaded[0].authors).toEqual([defaultCommunity])
    expect(loaded[0].relays).toEqual(
      expect.arrayContaining(["wss://index.example/", "wss://community.example/"]),
    )
  })

  it("uses a default community definition before its personal GRASP list", async () => {
    const defaultCommunity = "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f"
    const communityInput = nip19.naddrEncode({
      kind: 32222,
      pubkey: defaultCommunity,
      identifier: "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
    })
    let listLoads = 0
    const result = await resolveDefaultCommunityGraspServerFallback({
      communityInput,
      indexerRelays: ["wss://index.example"],
      loadDefinition: async () =>
        ({
          relays: ["wss://community.example"],
          graspServers: ["wss://declared.grasp.example/"],
        }) as any,
      loadEvents: async () => {
        listLoads += 1
        return []
      },
      queryEvents: () => [
        makeGraspList({pubkey: defaultCommunity, urls: ["wss://personal.example"]}),
      ],
    })

    expect(result.urls).toEqual(["wss://declared.grasp.example"])
    expect(listLoads).toBe(0)
  })

  it("rejects legacy default-community person identifiers", async () => {
    expect(
      await resolveDefaultCommunityGraspServerFallback({
        communityInput: nip19.npubEncode(
          "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f",
        ),
      }),
    ).toEqual({pubkey: "", urls: [], relays: []})
  })
})
