import {describe, expect, it} from "vitest"
import {getPublicKey} from "nostr-tools"
import type {TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  buildCommunityDefinition,
  makeCommunityPointer,
  parseCommunityDefinition,
} from "./community"
import {
  COMMUNITY_MEMBER_FLOOR,
  DIRECT_FOLLOW_WEIGHT,
  OVERLAY_CAP,
  REPORT_WEIGHT,
} from "./trust-assessment"
import {
  COMMUNITY_REPORT_KIND,
  getEffectiveCommunityReportState,
  makeCommunityEventReport,
  makeCommunityPersonReport,
  type EffectiveCommunityReportState,
} from "./community-reports"
import {
  MAX_SHARED_COMMUNITY_BONUS,
  buildCommunityTrustAssessment,
  buildCommunityTrustAssessments,
} from "./community-trust"

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: key(20),
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const reportCommunityId = getPublicKey(new Uint8Array(32).fill(10))
const key = (value: number) => getPublicKey(new Uint8Array(32).fill(value))
const communityIds = new Map<string, string>()
const getCommunityId = (id: string) => {
  if (id === reportCommunityId) return id
  const current = communityIds.get(id)
  if (current) return current
  const communityId = key(communityIds.size + 100)
  communityIds.set(id, communityId)
  return communityId
}
const makeReportCommunity = (ownerPubkey: string) =>
  makeCommunityPointer({ownerPubkey, communityId: reportCommunityId})!
const getDefinitionAddress = (definition: ReturnType<typeof makeDefinition>) =>
  definition.pointer.address
const makePersonBanState = (
  ownerPubkey: string,
  targetPubkey: string,
): EffectiveCommunityReportState => {
  const community = makeReportCommunity(ownerPubkey)

  return {
    eventReports: [],
    personReports: [
      {
        target: "person",
        targetPubkey,
        community,
        communityAddress: community.address,
        communityId: community.communityId,
        ownerPubkey: community.ownerPubkey,
        reporterPubkey: ownerPubkey,
        adminAuthored: true,
        event: makeEvent({id: "person-ban", pubkey: ownerPubkey}),
      },
    ],
  }
}

const makeDefinition = ({
  id,
  pubkey,
  sectionName = "Repositories",
  profileListAddress,
  profileListAddresses,
}: {
  id: string
  pubkey: string
  sectionName?: string
  profileListAddress?: string
  profileListAddresses?: string[]
}) =>
  parseCommunityDefinition(
    makeEvent({
      id,
      pubkey,
      kind: COMMUNITY_DEFINITION_KIND,
      tags: buildCommunityDefinition({
        communityId: getCommunityId(id),
        name: id,
        relays: ["wss://relay.example.com"],
        sections: [
          {
            name: sectionName,
            kinds: [{kind: 30617}],
            profileLists: [
              ...[
                ...(profileListAddresses || []),
                ...(profileListAddress ? [profileListAddress] : []),
                ...(!profileListAddress && !profileListAddresses
                  ? [`${PROFILE_LIST_KIND}:${pubkey}:${sectionName}`]
                  : []),
              ].map(address => ({address})),
            ],
          },
        ],
      }).tags,
    }),
  )!

const makeProfileList = ({
  id,
  pubkey,
  identifier,
  members = [],
}: {
  id: string
  pubkey: string
  identifier: string
  members?: string[]
}) =>
  makeEvent({
    id,
    pubkey,
    kind: PROFILE_LIST_KIND,
    tags: [["d", identifier], ...members.map(member => ["p", member])],
  })

describe("community trust", () => {
  it("does not share trust between different community IDs under one owner", () => {
    const viewerPubkey = key(1)
    const targetPubkey = key(2)
    const ownerPubkey = key(3)
    const viewerListOwner = key(4)
    const targetListOwner = key(5)
    const definitions = [
      makeDefinition({
        id: "viewer-branch",
        pubkey: ownerPubkey,
        profileListAddress: `${PROFILE_LIST_KIND}:${viewerListOwner}:Repositories`,
      }),
      makeDefinition({
        id: "target-branch",
        pubkey: ownerPubkey,
        profileListAddress: `${PROFILE_LIST_KIND}:${targetListOwner}:Repositories`,
      }),
    ]

    const assessment = buildCommunityTrustAssessment({
      viewerPubkey,
      targetPubkey,
      context: {scope: "global_discovery"},
      definitions,
      profileListEvents: [
        makeProfileList({
          id: "viewer-members",
          pubkey: viewerListOwner,
          identifier: "Repositories",
          members: [viewerPubkey],
        }),
        makeProfileList({
          id: "target-members",
          pubkey: targetListOwner,
          identifier: "Repositories",
          members: [targetPubkey],
        }),
      ],
    })

    expect(assessment.category).toBe("unknown")
    expect(assessment.evidence).toEqual([])
  })

  it("uses exact owner authority when community IDs collide", () => {
    const viewerPubkey = key(1)
    const targetPubkey = key(2)
    const selectedController = key(3)
    const otherController = key(4)
    const selectedDefinition = makeDefinition({
      id: reportCommunityId,
      pubkey: selectedController,
      profileListAddress: `${PROFILE_LIST_KIND}:${key(5)}:Repositories`,
    })
    const otherDefinition = makeDefinition({id: reportCommunityId, pubkey: otherController})
    const otherReportState = makePersonBanState(otherController, targetPubkey)

    const assessment = buildCommunityTrustAssessment({
      viewerPubkey,
      targetPubkey,
      context: {
        scope: "active_community",
        communityPubkey: selectedController,
        communityAddress: getDefinitionAddress(selectedDefinition),
      },
      definitions: [selectedDefinition, otherDefinition],
      reportStates: new Map([[getDefinitionAddress(otherDefinition), otherReportState]]),
    })

    expect(assessment.suppressed).toBe(false)
    expect(assessment.displayLabels).not.toContain("Banned here")
  })
  it("scores active-community members above direct follows", () => {
    const viewerPubkey = key(1)
    const memberPubkey = key(2)
    const communityPubkey = key(3)
    const listOwner = key(4)
    const listAddress = `${PROFILE_LIST_KIND}:${listOwner}:Repositories`
    const definitions = [
      makeDefinition({id: "community", pubkey: communityPubkey, profileListAddress: listAddress}),
    ]
    const profileListEvents = [
      makeProfileList({
        id: "members",
        pubkey: listOwner,
        identifier: "Repositories",
        members: [memberPubkey],
      }),
    ]

    const assessment = buildCommunityTrustAssessment({
      viewerPubkey,
      targetPubkey: memberPubkey,
      context: {
        scope: "active_community",
        communityPubkey,
        communityAddress: getDefinitionAddress(definitions[0]),
      },
      definitions,
      profileListEvents,
    })

    expect(assessment.category).toBe("community_member")
    expect(assessment.score).toBeGreaterThan(DIRECT_FOLLOW_WEIGHT)
    expect(assessment.displayLabels).toContain("Community member")
  })

  it("scores active-community moderators above members", () => {
    const viewerPubkey = key(1)
    const moderatorPubkey = key(2)
    const memberPubkey = key(3)
    const communityPubkey = key(4)
    const memberListOwner = key(5)
    const moderatorListAddress = `${PROFILE_LIST_KIND}:${moderatorPubkey}:Repositories`
    const memberListAddress = `${PROFILE_LIST_KIND}:${memberListOwner}:Repositories`
    const definitions = [
      makeDefinition({
        id: "community",
        pubkey: communityPubkey,
        profileListAddresses: [moderatorListAddress, memberListAddress],
      }),
    ]
    const profileListEvents = [
      makeProfileList({id: "moderators", pubkey: moderatorPubkey, identifier: "Repositories"}),
      makeProfileList({
        id: "members",
        pubkey: memberListOwner,
        identifier: "Repositories",
        members: [memberPubkey],
      }),
    ]
    const context = {
      scope: "active_community" as const,
      communityPubkey,
      communityAddress: getDefinitionAddress(definitions[0]),
    }

    const moderator = buildCommunityTrustAssessment({
      viewerPubkey,
      targetPubkey: moderatorPubkey,
      context,
      definitions,
      profileListEvents,
    })
    const member = buildCommunityTrustAssessment({
      viewerPubkey,
      targetPubkey: memberPubkey,
      context,
      definitions,
      profileListEvents,
    })

    expect(moderator.category).toBe("community_moderator")
    expect(moderator.score).toBeGreaterThan(member.score)
    expect(moderator.displayLabels).toContain("Moderator")
  })

  it("emits capped shared-community and shared-section evidence", () => {
    const viewerPubkey = key(1)
    const targetPubkey = key(2)
    const communities = [key(3), key(4), key(5)]
    const listOwners = [key(6), key(7), key(8)]
    const definitions = communities.map((communityPubkey, index) =>
      makeDefinition({
        id: `community-${index}`,
        pubkey: communityPubkey,
        profileListAddress: `${PROFILE_LIST_KIND}:${listOwners[index]}:Repositories`,
      }),
    )
    const profileListEvents = listOwners.map((listOwner, index) =>
      makeProfileList({
        id: `members-${index}`,
        pubkey: listOwner,
        identifier: "Repositories",
        members: [viewerPubkey, targetPubkey],
      }),
    )

    const assessment = buildCommunityTrustAssessment({
      viewerPubkey,
      targetPubkey,
      context: {scope: "global_discovery"},
      definitions,
      profileListEvents,
    })

    expect(assessment.score).toBe(COMMUNITY_MEMBER_FLOOR + MAX_SHARED_COMMUNITY_BONUS + 1)
    expect(assessment.displayLabels).toContain("3 shared communities")
    expect(assessment.displayLabels).toContain("Shared Repositories section")
  })

  it("does not count a social-only target as community-aligned", () => {
    const assessment = buildCommunityTrustAssessment({
      viewerPubkey: key(1),
      targetPubkey: key(2),
      context: {scope: "global_discovery"},
    })

    expect(assessment.category).toBe("unknown")
    expect(assessment.score).toBe(0)
    expect(assessment.evidence).toEqual([])
  })

  it("ignores renounced active-community trust and report evidence", () => {
    const viewerPubkey = key(1)
    const memberPubkey = key(2)
    const communityPubkey = key(3)
    const listOwner = key(4)
    const definitions = [
      makeDefinition({
        id: reportCommunityId,
        pubkey: communityPubkey,
        profileListAddress: `${PROFILE_LIST_KIND}:${listOwner}:Repositories`,
      }),
    ]
    const profileListEvents = [
      makeProfileList({
        id: "members",
        pubkey: listOwner,
        identifier: "Repositories",
        members: [memberPubkey],
      }),
    ]
    const reportEvent = makeEvent({
      id: "event-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: communityPubkey,
      tags: makeCommunityEventReport({
        community: makeReportCommunity(communityPubkey),
        sectionName: "Repositories",
        eventId: "reported-event",
        eventPubkey: memberPubkey,
      }).tags,
    })
    const reportState = getEffectiveCommunityReportState({
      definition: definitions[0],
      reportEvents: [reportEvent],
    })

    const assessment = buildCommunityTrustAssessment({
      viewerPubkey,
      targetPubkey: memberPubkey,
      context: {
        scope: "active_community",
        communityPubkey,
        communityAddress: getDefinitionAddress(definitions[0]),
      },
      definitions,
      profileListEvents,
      reportStates: new Map([[getDefinitionAddress(definitions[0]), reportState]]),
      renouncedCommunityAddresses: [getDefinitionAddress(definitions[0])],
    })

    expect(assessment.category).toBe("unknown")
    expect(assessment.score).toBe(0)
    expect(assessment.evidence).toEqual([])
  })

  it("applies contextual event report penalties to target authors", () => {
    const viewerPubkey = key(1)
    const memberPubkey = key(2)
    const communityPubkey = key(3)
    const listOwner = key(4)
    const definitions = [
      makeDefinition({
        id: reportCommunityId,
        pubkey: communityPubkey,
        profileListAddress: `${PROFILE_LIST_KIND}:${listOwner}:Repositories`,
      }),
    ]
    const profileListEvents = [
      makeProfileList({
        id: "members",
        pubkey: listOwner,
        identifier: "Repositories",
        members: [memberPubkey],
      }),
    ]
    const reportEvent = makeEvent({
      id: "event-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: communityPubkey,
      tags: makeCommunityEventReport({
        community: makeReportCommunity(communityPubkey),
        sectionName: "Repositories",
        eventId: "reported-event",
        eventPubkey: memberPubkey,
      }).tags,
    })
    const reportState = getEffectiveCommunityReportState({
      definition: definitions[0],
      reportEvents: [reportEvent],
    })

    const assessment = buildCommunityTrustAssessment({
      viewerPubkey,
      targetPubkey: memberPubkey,
      context: {
        scope: "active_community",
        communityPubkey,
        communityAddress: getDefinitionAddress(definitions[0]),
      },
      definitions,
      profileListEvents,
      reportStates: new Map([[getDefinitionAddress(definitions[0]), reportState]]),
    })

    expect(assessment.category).toBe("community_member")
    expect(assessment.score).toBe(COMMUNITY_MEMBER_FLOOR + REPORT_WEIGHT)
    expect(assessment.suppressed).toBe(false)
    expect(assessment.displayLabels).toEqual(["Community member", "Reported here"])
  })

  it("caps repeated report penalties so reports do not erase membership evidence", () => {
    const viewerPubkey = key(1)
    const memberPubkey = key(2)
    const communityPubkey = key(3)
    const listOwner = key(4)
    const definitions = [
      makeDefinition({
        id: reportCommunityId,
        pubkey: communityPubkey,
        profileListAddress: `${PROFILE_LIST_KIND}:${listOwner}:Repositories`,
      }),
    ]
    const profileListEvents = [
      makeProfileList({
        id: "members",
        pubkey: listOwner,
        identifier: "Repositories",
        members: [memberPubkey],
      }),
    ]
    const reportEvents = ["reported-event-1", "reported-event-2", "reported-event-3"].map(
      (eventId, index) =>
        makeEvent({
          id: `event-report-${index}`,
          kind: COMMUNITY_REPORT_KIND,
          pubkey: communityPubkey,
          tags: makeCommunityEventReport({
            community: makeReportCommunity(communityPubkey),
            sectionName: "Repositories",
            eventId,
            eventPubkey: memberPubkey,
          }).tags,
        }),
    )
    const reportState = getEffectiveCommunityReportState({
      definition: definitions[0],
      reportEvents,
    })

    const assessment = buildCommunityTrustAssessment({
      viewerPubkey,
      targetPubkey: memberPubkey,
      context: {
        scope: "active_community",
        communityPubkey,
        communityAddress: getDefinitionAddress(definitions[0]),
      },
      definitions,
      profileListEvents,
      reportStates: new Map([[getDefinitionAddress(definitions[0]), reportState]]),
    })

    expect(assessment.score).toBe(COMMUNITY_MEMBER_FLOOR - OVERLAY_CAP)
    expect(assessment.displayLabels).toEqual(["Community member", "3 reports here"])
    expect(assessment.suppressed).toBe(false)
  })

  it("suppresses person bans only in the reported community context", () => {
    const viewerPubkey = key(1)
    const memberPubkey = key(2)
    const communityPubkey = key(3)
    const otherCommunityPubkey = key(4)
    const listOwner = key(5)
    const definitions = [
      makeDefinition({
        id: reportCommunityId,
        pubkey: communityPubkey,
        profileListAddress: `${PROFILE_LIST_KIND}:${listOwner}:Repositories`,
      }),
    ]
    const profileListEvents = [
      makeProfileList({
        id: "members",
        pubkey: listOwner,
        identifier: "Repositories",
        members: [memberPubkey],
      }),
    ]
    const banEvent = makeEvent({
      id: "person-ban",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: communityPubkey,
      tags: makeCommunityPersonReport({
        community: makeReportCommunity(communityPubkey),
        pubkey: memberPubkey,
      }).tags,
    })
    const reportState = getEffectiveCommunityReportState({
      definition: definitions[0],
      reportEvents: [banEvent],
    })
    const reportStates = new Map([[getDefinitionAddress(definitions[0]), reportState]])

    const assessment = buildCommunityTrustAssessment({
      viewerPubkey,
      targetPubkey: memberPubkey,
      context: {
        scope: "active_community",
        communityPubkey,
        communityAddress: getDefinitionAddress(definitions[0]),
      },
      definitions,
      profileListEvents,
      reportStates,
    })
    const unrelatedAssessment = buildCommunityTrustAssessment({
      viewerPubkey,
      targetPubkey: memberPubkey,
      context: {
        scope: "active_community",
        communityPubkey: otherCommunityPubkey,
        communityAddress: `${COMMUNITY_DEFINITION_KIND}:${otherCommunityPubkey}:${reportCommunityId}`,
      },
      definitions,
      profileListEvents,
      reportStates,
    })

    expect(assessment.category).toBe("suppressed")
    expect(assessment.score).toBe(COMMUNITY_MEMBER_FLOOR)
    expect(assessment.suppressionReason).toBe("community_ban")
    expect(assessment.displayLabels).toEqual(["Community member", "Banned here"])
    expect(unrelatedAssessment.suppressed).toBe(false)
    expect(unrelatedAssessment.displayLabels).not.toContain("Banned here")
  })

  it("builds candidate assessments while reusing collected refs", () => {
    const viewerPubkey = key(1)
    const memberPubkey = key(2)
    const unknownPubkey = key(3)
    const communityPubkey = key(4)
    const listOwner = key(5)
    const definitions = [
      makeDefinition({
        id: "community",
        pubkey: communityPubkey,
        profileListAddress: `${PROFILE_LIST_KIND}:${listOwner}:Repositories`,
      }),
    ]
    const profileListEvents = [
      makeProfileList({
        id: "members",
        pubkey: listOwner,
        identifier: "Repositories",
        members: [viewerPubkey, memberPubkey],
      }),
    ]
    const assessments = buildCommunityTrustAssessments({
      viewerPubkey,
      candidatePubkeys: [memberPubkey, unknownPubkey],
      context: {scope: "global_discovery"},
      definitions,
      profileListEvents,
    })

    expect(assessments.get(memberPubkey)?.category).toBe("community_member")
    expect(assessments.get(unknownPubkey)?.category).toBe("unknown")
  })
})
