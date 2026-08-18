import {describe, expect, it} from "vitest"
import {getPublicKey} from "nostr-tools/pure"
import {DELETE, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND_V2,
  COMMUNITY_SECTION_THREADS,
  PROFILE_LIST_KIND,
  RENOUNCED_COMMUNITIES_DTAG,
  buildCommunityDefinitionV2,
  parseCommunityDefinitionV2,
  type CommunityDefinitionV2,
} from "./community"
import type {EffectiveCommunityReportState} from "./community-reports"
import {
  type ActiveUserCommunityRef,
  filterExcludedCommunityRefs,
  selectCommunityMemberList,
  selectUserCommunityRefs,
} from "./community-membership"

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: key(1),
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const key = (value: number) => getPublicKey(new Uint8Array(32).fill(value))
const communityIds = new Map<string, string>()
const getCommunityId = (id: string) => {
  const existing = communityIds.get(id)
  if (existing) return existing
  const communityId = key(communityIds.size + 100)
  communityIds.set(id, communityId)
  return communityId
}

const makeDefinition = ({
  id,
  pubkey,
  sectionName = "General",
  profileListAddress,
  relays = ["wss://relay.example.com"],
}: {
  id: string
  pubkey: string
  sectionName?: string
  profileListAddress?: string
  relays?: string[]
}) =>
  parseCommunityDefinitionV2(
    makeEvent({
      id,
      pubkey,
      kind: COMMUNITY_DEFINITION_KIND_V2,
      tags: buildCommunityDefinitionV2({
        communityId: getCommunityId(id),
        name: id,
        relays,
        sections: [
          {
            name: sectionName,
            kinds: [{kind: 1111}],
            profileLists: [
              {address: profileListAddress || `${PROFILE_LIST_KIND}:${pubkey}:${sectionName}`},
            ],
          },
        ],
      }).tags,
    }),
  )!

const makeMultiSectionDefinition = ({
  id,
  pubkey,
  sections,
}: {
  id: string
  pubkey: string
  sections: Array<{name: string; profileListAddresses: string[]}>
}) =>
  parseCommunityDefinitionV2(
    makeEvent({
      id,
      pubkey,
      kind: COMMUNITY_DEFINITION_KIND_V2,
      tags: buildCommunityDefinitionV2({
        communityId: getCommunityId(id),
        name: id,
        relays: ["wss://relay.example.com"],
        sections: sections.map((section, index) => ({
          name: section.name,
          kinds: [{kind: 1111 + index}],
          profileLists: section.profileListAddresses.map(address => ({address})),
        })),
      }).tags,
    }),
  )!

const makeProfileList = ({
  id,
  pubkey,
  identifier,
  members = [],
  createdAt = 1,
}: {
  id: string
  pubkey: string
  identifier: string
  members?: string[]
  createdAt?: number
}) =>
  makeEvent({
    id,
    pubkey,
    created_at: createdAt,
    kind: PROFILE_LIST_KIND,
    tags: [["d", identifier], ...members.map(member => ["p", member])],
  })

const makePersonBanState = (pubkey: string): EffectiveCommunityReportState =>
  ({
    eventReports: [],
    personReports: [{targetPubkey: pubkey}],
  }) as unknown as EffectiveCommunityReportState

describe("community membership", () => {
  it("selects sorted non-banned owner, moderator, and member list items", () => {
    const ownerPubkey = key(1)
    const moderatorManyPubkey = key(2)
    const moderatorFewPubkey = key(3)
    const memberManyPubkey = key(4)
    const memberFewPubkey = key(5)
    const bannedPubkey = key(6)
    const removedPubkey = key(9)
    const generalAddress = `${PROFILE_LIST_KIND}:${moderatorManyPubkey}:General`
    const generalExtraAddress = `${PROFILE_LIST_KIND}:${moderatorFewPubkey}:GeneralExtra`
    const threadsAddress = `${PROFILE_LIST_KIND}:${moderatorManyPubkey}:${COMMUNITY_SECTION_THREADS}`
    const reposAddress = `${PROFILE_LIST_KIND}:${moderatorFewPubkey}:Repos`
    const definition = makeMultiSectionDefinition({
      id: "community-definition",
      pubkey: ownerPubkey,
      sections: [
        {name: "General", profileListAddresses: [generalAddress, generalExtraAddress]},
        {name: COMMUNITY_SECTION_THREADS, profileListAddresses: [threadsAddress]},
        {name: "Repos", profileListAddresses: [reposAddress]},
      ],
    })

    const members = selectCommunityMemberList({
      definition,
      profileListEvents: [
        makeProfileList({
          id: "old-general",
          pubkey: moderatorManyPubkey,
          identifier: "General",
          members: [removedPubkey],
          createdAt: 1,
        }),
        makeProfileList({
          id: "new-general",
          pubkey: moderatorManyPubkey,
          identifier: "General",
          members: [memberManyPubkey, memberFewPubkey, bannedPubkey],
          createdAt: 2,
        }),
        makeProfileList({
          id: "general-extra",
          pubkey: moderatorFewPubkey,
          identifier: "GeneralExtra",
          members: [memberManyPubkey],
        }),
        makeProfileList({
          id: "threads",
          pubkey: moderatorManyPubkey,
          identifier: COMMUNITY_SECTION_THREADS,
          members: [memberManyPubkey, moderatorManyPubkey],
        }),
        makeProfileList({
          id: "repos",
          pubkey: moderatorFewPubkey,
          identifier: "Repos",
          members: [memberManyPubkey, memberFewPubkey, moderatorManyPubkey, moderatorFewPubkey],
        }),
      ],
      reportState: makePersonBanState(bannedPubkey),
    })

    expect(members.map(member => member.pubkey)).toEqual([
      ownerPubkey,
      moderatorManyPubkey,
      moderatorFewPubkey,
      memberManyPubkey,
      memberFewPubkey,
    ])
    expect(members.map(member => member.grantCount)).toEqual([0, 3, 3, 3, 2])
    expect(members.map(member => member.moderatorSectionCount)).toEqual([0, 2, 2, 0, 0])
    expect(members[0]).toMatchObject({isOwner: true, isAdmin: true})
    expect(members[1]).toMatchObject({isModerator: true})
    expect(members[3].sectionGrants.map(grant => grant.displayName)).toEqual([
      "General",
      "Repos",
      COMMUNITY_SECTION_THREADS,
    ])
    expect(members[3].sectionGrants[0].profileListAddresses).toEqual([
      generalAddress,
      generalExtraAddress,
    ])
    expect(members.some(member => member.pubkey === bannedPubkey)).toBe(false)
    expect(members.some(member => member.pubkey === removedPubkey)).toBe(false)
  })

  it("selects admin, moderator, and member community refs", () => {
    const userPubkey = key(2)
    const moderatorCommunityPubkey = key(4)
    const memberCommunityPubkey = key(5)
    const memberListOwner = key(6)
    const moderatorListAddress = `${PROFILE_LIST_KIND}:${userPubkey}:Moderators`
    const memberListAddress = `${PROFILE_LIST_KIND}:${memberListOwner}:Members`

    const refs = selectUserCommunityRefs({
      author: userPubkey,
      definitions: [
        makeDefinition({id: "admin-definition", pubkey: userPubkey}),
        makeDefinition({
          id: "moderator-definition",
          pubkey: moderatorCommunityPubkey,
          sectionName: "Moderated",
          profileListAddress: moderatorListAddress,
        }),
        makeDefinition({
          id: "member-definition",
          pubkey: memberCommunityPubkey,
          sectionName: "Members",
          profileListAddress: memberListAddress,
        }),
      ],
      profileListEvents: [
        makeProfileList({id: "moderator-list", pubkey: userPubkey, identifier: "Moderators"}),
        makeProfileList({
          id: "member-list",
          pubkey: memberListOwner,
          identifier: "Members",
          members: [userPubkey],
        }),
      ],
    })

    expect(
      Object.fromEntries(refs.map(ref => [ref.community.controllerPubkey, ref.roles])),
    ).toEqual({
      [userPubkey]: ["admin"],
      [moderatorCommunityPubkey]: ["moderator", "member"],
      [memberCommunityPubkey]: ["member"],
    })
    expect(refs.map(ref => ref.community.address)).toEqual(
      refs.map(ref => ref.community.address).toSorted(),
    )
  })

  it("derives membership only from current non-deleted profile lists", () => {
    const userPubkey = key(2)
    const controller = key(4)
    const listOwner = key(6)
    const listAddress = `${PROFILE_LIST_KIND}:${listOwner}:Members`
    const definition = makeDefinition({
      id: "authority",
      pubkey: controller,
      profileListAddress: listAddress,
    })
    const list = makeProfileList({
      id: "members",
      pubkey: listOwner,
      identifier: "Members",
      members: [userPubkey],
      createdAt: 2,
    })
    const malformed = {
      ...list,
      id: "malformed",
      created_at: 4,
      tags: [
        ["d", "Members"],
        ["d", "Other"],
        ["p", userPubkey],
      ],
    }
    const deletion = makeEvent({
      id: "delete-members",
      pubkey: listOwner,
      created_at: 2,
      kind: DELETE,
      tags: [["a", listAddress]],
    })
    const recreated = {...list, id: "recreated", created_at: 3}
    const foreignDelete = {...deletion, id: "foreign-delete", pubkey: controller}
    const multiDelete = {
      ...deletion,
      id: "multi-delete",
      tags: [
        ["a", listAddress],
        ["a", `${PROFILE_LIST_KIND}:${listOwner}:Other`],
      ],
    }
    const roles = (events: TrustedEvent[]) =>
      selectUserCommunityRefs({
        author: userPubkey,
        definitions: [definition],
        profileListEvents: events,
      })

    expect(roles([list, malformed])).toHaveLength(1)
    expect(roles([list, deletion])).toEqual([])
    expect(roles([list, deletion, recreated])).toHaveLength(1)
    expect(roles([list, foreignDelete])).toHaveLength(1)
    expect(roles([list, multiDelete])).toHaveLength(1)
  })

  it("keeps same-controller community definitions independent", () => {
    const userPubkey = key(2)

    expect(
      selectUserCommunityRefs({
        author: userPubkey,
        definitions: [
          makeDefinition({id: "first", pubkey: userPubkey}),
          makeDefinition({id: "second", pubkey: userPubkey}),
        ],
      }).map(ref => ref.definition.event.id),
    ).toEqual(["first", "second"])
  })

  it("keeps same-ID branches under different controllers independent", () => {
    const userPubkey = key(2)
    const otherController = key(3)
    const sharedId = "shared-community-id"
    const userDefinition = makeDefinition({id: sharedId, pubkey: userPubkey})
    const otherDefinition = makeDefinition({id: sharedId, pubkey: otherController})

    expect(
      selectUserCommunityRefs({
        author: userPubkey,
        definitions: [userDefinition, otherDefinition],
      }).map(ref => ref.community.address),
    ).toEqual([userDefinition.pointer.address])
    expect(userDefinition.communityId).toBe(otherDefinition.communityId)
    expect(userDefinition.pointer.address).not.toBe(otherDefinition.pointer.address)
  })

  it("uses report state from the exact community address", () => {
    const userPubkey = key(2)
    const controller = key(4)
    const listOwner = key(6)
    const listAddress = `${PROFILE_LIST_KIND}:${listOwner}:Members`
    const bannedBranch = makeDefinition({
      id: "banned-branch",
      pubkey: controller,
      profileListAddress: listAddress,
    })
    const activeBranch = makeDefinition({
      id: "active-branch",
      pubkey: controller,
      profileListAddress: listAddress,
    })

    const refs = selectUserCommunityRefs({
      author: userPubkey,
      definitions: [bannedBranch, activeBranch],
      profileListEvents: [
        makeProfileList({
          id: "members",
          pubkey: listOwner,
          identifier: "Members",
          members: [userPubkey],
        }),
      ],
      reportStates: new Map([[bannedBranch.pointer.address, makePersonBanState(userPubkey)]]),
    })

    expect(refs.map(ref => ref.community.address)).toEqual([activeBranch.pointer.address])
  })

  it("excludes renounced non-admin community refs but keeps admin refs", () => {
    const userPubkey = key(2)
    const memberCommunityPubkey = key(4)
    const memberListOwner = key(6)
    const memberListAddress = `${PROFILE_LIST_KIND}:${memberListOwner}:Members`

    const adminDefinition = makeDefinition({id: "admin-definition", pubkey: userPubkey})
    const memberDefinition = makeDefinition({
      id: "member-definition",
      pubkey: memberCommunityPubkey,
      sectionName: "Members",
      profileListAddress: memberListAddress,
    })
    const refs = selectUserCommunityRefs({
      author: userPubkey,
      definitions: [adminDefinition, memberDefinition],
      profileListEvents: [
        makeProfileList({
          id: "member-list",
          pubkey: memberListOwner,
          identifier: "Members",
          members: [userPubkey],
        }),
      ],
      excludedCommunityAddresses: [
        adminDefinition.pointer.address,
        memberDefinition.pointer.address,
      ],
    })

    expect(refs.map(ref => ref.community.address)).toEqual([adminDefinition.pointer.address])
  })

  it("filters existing refs by renounced non-admin communities", () => {
    const definition = makeDefinition({id: "definition", pubkey: key(1)})
    const adminRef: ActiveUserCommunityRef = {
      community: definition.pointer,
      definition,
      relayHints: [],
      roles: ["admin" as const],
      writableSections: [],
    }
    const memberRef: ActiveUserCommunityRef = {
      community: definition.pointer,
      definition,
      relayHints: [],
      roles: ["member" as const],
      writableSections: [],
    }

    expect(
      filterExcludedCommunityRefs([adminRef, memberRef], [definition.pointer.address]).map(
        ref => ref.roles,
      ),
    ).toEqual([["admin"]])
  })

  it("does not exclude a sibling definition owned by the same controller", () => {
    const pubkey = key(1)
    const renounced = makeDefinition({id: "renounced", pubkey})
    const sibling = makeDefinition({id: "sibling", pubkey})
    const makeRef = (definition: CommunityDefinitionV2): ActiveUserCommunityRef => ({
      community: definition.pointer,
      definition,
      relayHints: [],
      roles: ["member"],
      writableSections: [],
    })

    expect(
      filterExcludedCommunityRefs(
        [makeRef(renounced), makeRef(sibling)],
        [renounced.pointer.address],
      ).map(ref => ref.definition.event.id),
    ).toEqual(["sibling"])
  })

  it("ignores the renounced communities list as profile-list membership evidence", () => {
    const userPubkey = key(2)
    const communityPubkey = key(4)
    const listOwner = key(6)
    const listAddress = `${PROFILE_LIST_KIND}:${listOwner}:${RENOUNCED_COMMUNITIES_DTAG}`

    expect(
      selectUserCommunityRefs({
        author: userPubkey,
        definitions: [
          makeDefinition({
            id: "definition",
            pubkey: communityPubkey,
            profileListAddress: listAddress,
          }),
        ],
        profileListEvents: [
          makeEvent({
            id: "renounced-list",
            pubkey: listOwner,
            kind: PROFILE_LIST_KIND,
            tags: [
              ["d", RENOUNCED_COMMUNITIES_DTAG],
              ["p", userPubkey],
            ],
          }),
        ],
      }),
    ).toEqual([])
  })

  it("uses stored section names for member grant display", () => {
    const ownerPubkey = key(1)
    const moderatorPubkey = key(2)
    const memberPubkey = key(3)
    const definition = makeDefinition({
      id: "goals-community-definition",
      pubkey: ownerPubkey,
      sectionName: "Goals",
      profileListAddress: `${PROFILE_LIST_KIND}:${moderatorPubkey}:Goals`,
    })

    const members = selectCommunityMemberList({
      definition,
      profileListEvents: [
        makeProfileList({
          id: "goals-list",
          pubkey: moderatorPubkey,
          identifier: "Goals",
          members: [memberPubkey],
        }),
      ],
    })
    const member = members.find(item => item.pubkey === memberPubkey)

    expect(member?.sectionGrants.map(section => section.displayName)).toEqual(["Goals"])
  })

  it("treats missing moderator profile-list evidence as member access only", () => {
    const userPubkey = key(2)
    const communityPubkey = key(4)

    expect(
      selectUserCommunityRefs({
        author: userPubkey,
        definitions: [
          makeDefinition({
            id: "moderator-definition",
            pubkey: communityPubkey,
            profileListAddress: `${PROFILE_LIST_KIND}:${userPubkey}:General`,
          }),
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        community: expect.objectContaining({controllerPubkey: communityPubkey}),
        roles: ["member"],
        writableSections: ["General"],
      }),
    ])
  })

  it("marks missing moderator profile-list refs as pending moderation invites", () => {
    const userPubkey = key(2)
    const communityPubkey = key(4)
    const definition = makeDefinition({
      id: "moderator-definition",
      pubkey: communityPubkey,
      profileListAddress: `${PROFILE_LIST_KIND}:${userPubkey}:General`,
    })

    const members = selectCommunityMemberList({definition})
    const pendingModerator = members.find(member => member.pubkey === userPubkey)

    expect(members.map(member => member.pubkey)).toEqual([communityPubkey, userPubkey])
    expect(pendingModerator).toMatchObject({
      isModerator: false,
      isPendingModerator: true,
      isDeclinedModerator: false,
      moderatorSectionCount: 0,
      pendingModeratorSectionCount: 1,
      grantCount: 1,
    })
    expect(pendingModerator?.pendingModeratorSections.map(section => section.displayName)).toEqual([
      "General",
    ])
    expect(pendingModerator?.sectionGrants.map(section => section.displayName)).toEqual(["General"])
  })

  it("marks existing empty moderator profile-list refs as active moderators", () => {
    const userPubkey = key(2)
    const communityPubkey = key(4)
    const definition = makeDefinition({
      id: "moderator-definition",
      pubkey: communityPubkey,
      profileListAddress: `${PROFILE_LIST_KIND}:${userPubkey}:General`,
    })

    const members = selectCommunityMemberList({
      definition,
      profileListEvents: [
        makeProfileList({id: "moderator-list", pubkey: userPubkey, identifier: "General"}),
      ],
    })
    const moderator = members.find(member => member.pubkey === userPubkey)

    expect(moderator).toMatchObject({
      isModerator: true,
      isPendingModerator: false,
      isDeclinedModerator: false,
      moderatorSectionCount: 1,
      pendingModeratorSectionCount: 0,
      grantCount: 1,
    })
    expect(moderator?.sectionGrants.map(section => section.displayName)).toEqual(["General"])
  })

  it("treats declined moderator refs as member access only", () => {
    const userPubkey = key(2)
    const communityPubkey = key(4)
    const definition = makeDefinition({
      id: "moderator-definition",
      pubkey: communityPubkey,
      profileListAddress: `${PROFILE_LIST_KIND}:${userPubkey}:General`,
    })
    const declinedList = makeProfileList({
      id: "declined-list",
      pubkey: userPubkey,
      identifier: "General",
    })
    declinedList.tags.push(["status", "declined"])

    expect(
      selectUserCommunityRefs({
        author: userPubkey,
        definitions: [definition],
        profileListEvents: [declinedList],
      }),
    ).toEqual([
      expect.objectContaining({
        community: expect.objectContaining({controllerPubkey: communityPubkey}),
        roles: ["member"],
        writableSections: ["General"],
      }),
    ])
    expect(selectCommunityMemberList({definition, profileListEvents: [declinedList]})).toEqual([
      expect.objectContaining({pubkey: communityPubkey, isOwner: true}),
      expect.objectContaining({
        pubkey: userPubkey,
        isModerator: false,
        isPendingModerator: false,
        isDeclinedModerator: true,
        declinedModeratorSectionCount: 1,
        grantCount: 1,
      }),
    ])
  })

  it("excludes person-banned non-admin refs but keeps admin refs", () => {
    const userPubkey = key(2)
    const memberCommunityPubkey = key(4)
    const memberListOwner = key(6)

    const adminDefinition = makeDefinition({id: "admin-definition", pubkey: userPubkey})
    const memberDefinition = makeDefinition({
      id: "member-definition",
      pubkey: memberCommunityPubkey,
      profileListAddress: `${PROFILE_LIST_KIND}:${memberListOwner}:General`,
    })
    const refs = selectUserCommunityRefs({
      author: userPubkey,
      definitions: [adminDefinition, memberDefinition],
      profileListEvents: [
        makeProfileList({
          id: "member-list",
          pubkey: memberListOwner,
          identifier: "General",
          members: [userPubkey],
        }),
      ],
      reportStates: new Map([
        [adminDefinition.pointer.address, makePersonBanState(userPubkey)],
        [memberDefinition.pointer.address, makePersonBanState(userPubkey)],
      ]),
    })

    expect(refs.map(ref => ref.community.address)).toEqual([adminDefinition.pointer.address])
  })

  it("returns relay hints only for eligible active community refs", () => {
    const userPubkey = key(2)
    const memberCommunityPubkey = key(4)
    const bannedCommunityPubkey = key(5)
    const unrelatedCommunityPubkey = key(6)
    const memberListOwner = key(7)
    const bannedListOwner = key(8)

    const adminDefinition = makeDefinition({
      id: "admin-definition",
      pubkey: userPubkey,
      relays: ["wss://admin-relay.example.com"],
    })
    const memberDefinition = makeDefinition({
      id: "member-definition",
      pubkey: memberCommunityPubkey,
      profileListAddress: `${PROFILE_LIST_KIND}:${memberListOwner}:General`,
      relays: ["wss://member-relay.example.com"],
    })
    const bannedDefinition = makeDefinition({
      id: "banned-definition",
      pubkey: bannedCommunityPubkey,
      profileListAddress: `${PROFILE_LIST_KIND}:${bannedListOwner}:General`,
      relays: ["wss://banned-relay.example.com"],
    })
    const refs = selectUserCommunityRefs({
      author: userPubkey,
      definitions: [
        adminDefinition,
        memberDefinition,
        bannedDefinition,
        makeDefinition({
          id: "unrelated-definition",
          pubkey: unrelatedCommunityPubkey,
          relays: ["wss://unrelated-relay.example.com"],
        }),
      ],
      profileListEvents: [
        makeProfileList({
          id: "member-list",
          pubkey: memberListOwner,
          identifier: "General",
          members: [userPubkey],
        }),
        makeProfileList({
          id: "banned-list",
          pubkey: bannedListOwner,
          identifier: "General",
          members: [userPubkey],
        }),
      ],
      reportStates: new Map([[bannedDefinition.pointer.address, makePersonBanState(userPubkey)]]),
    })

    expect(
      Object.fromEntries(refs.map(ref => [ref.community.controllerPubkey, ref.relayHints])),
    ).toEqual({
      [userPubkey]: ["wss://admin-relay.example.com"],
      [memberCommunityPubkey]: ["wss://member-relay.example.com"],
    })
  })
})
