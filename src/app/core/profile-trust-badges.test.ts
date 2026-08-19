import {describe, expect, it} from "vitest"
import {getPublicKey} from "nostr-tools"
import type {TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  buildCommunityDefinition,
  makeCommunityPointer,
  parseCommunityDefinition,
  type CommunityDefinition,
} from "@app/core/community"
import type {ActiveUserCommunityRef} from "@app/core/community-membership"
import {
  makeCommunityEventReport,
  makeCommunityPersonReport,
  type EffectiveCommunityReportState,
} from "@app/core/community-reports"
import {
  getProfileFlagReportEvidence,
  getSharedProfileCommunityEvidenceGroups,
} from "./profile-trust-badges"

const key = (value: number) => getPublicKey(new Uint8Array(32).fill(value))
const targetPubkey = key(20)
const sharedCommunityPubkey = getPublicKey(new Uint8Array(32).fill(2))
const otherSharedCommunityPubkey = getPublicKey(new Uint8Array(32).fill(3))
const unsharedCommunityPubkey = key(4)
const memberListOwner = key(5)
const otherMemberListOwner = key(6)
const viewerPubkey = key(9)
const reportCommunityId = getPublicKey(new Uint8Array(32).fill(10))
const communityIds = new Map<string, string>()
const getCommunityId = (id: string) => {
  if (id === reportCommunityId) return id
  const current = communityIds.get(id)
  if (current) return current
  const communityId = getPublicKey(new Uint8Array(32).fill(communityIds.size + 100))
  communityIds.set(id, communityId)
  return communityId
}
const makeReportCommunity = (ownerPubkey: string) =>
  makeCommunityPointer({ownerPubkey, communityId: reportCommunityId})!
const getDefinitionAddress = (definition: CommunityDefinition) => definition.pointer.address

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

const makeDefinition = ({
  id,
  pubkey,
  sections,
}: {
  id: string
  pubkey: string
  sections: Array<{name: string; profileListAddresses: string[]}>
}) => {
  const communityId = getCommunityId(id)
  return parseCommunityDefinition(
    makeEvent({
      id,
      pubkey,
      kind: COMMUNITY_DEFINITION_KIND,
      tags: buildCommunityDefinition({
        communityId,
        name: id,
        relays: ["wss://relay.example.com"],
        sections: sections.map((section, index) => ({
          name: section.name,
          kinds: [{kind: 1111 + index}],
          profileLists: (section.profileListAddresses.length > 0
            ? section.profileListAddresses
            : [`${PROFILE_LIST_KIND}:${pubkey}:${section.name}`]
          ).map(address => {
            const [kind, owner, ...parts] = address.split(":")
            const purpose = parts
              .join(":")
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
            return {address: `${kind}:${owner}:${communityId}-${purpose}`}
          }),
        })),
      }).tags,
    }),
  )!
}

const makeProfileList = ({
  id,
  pubkey,
  identifier,
  communityId,
  members = [],
}: {
  id: string
  pubkey: string
  identifier: string
  communityId: string
  members?: string[]
}) =>
  makeEvent({
    id,
    pubkey,
    kind: PROFILE_LIST_KIND,
    tags: [
      ["d", `${communityId}-${identifier.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`],
      ...members.map(member => ["p", member]),
    ],
  })

const makeViewerRef = (definition: CommunityDefinition) =>
  ({
    community: definition.pointer,
    definition,
    relayHints: definition.relays,
    roles: ["member"],
    writableSections: definition.sections.map(section => section.name),
  }) as ActiveUserCommunityRef

const makeReportState = (
  ownerPubkey: string,
  targetPubkeys: string[],
): EffectiveCommunityReportState => {
  const community = makeReportCommunity(ownerPubkey)

  return {
    eventReports: [],
    personReports: targetPubkeys.map((targetPubkey, index) => ({
      target: "person",
      targetPubkey,
      community,
      communityAddress: community.address,
      communityId: reportCommunityId,
      ownerPubkey,
      reporterPubkey: viewerPubkey,
      adminAuthored: true,
      event: makeEvent({id: `report-${index}`, created_at: index}),
    })),
  }
}

describe("profile trust badges", () => {
  it("keeps same-owner community branches as separate role evidence", () => {
    const ownerPubkey = sharedCommunityPubkey
    const firstDefinition = makeDefinition({
      id: "first-branch",
      pubkey: ownerPubkey,
      sections: [
        {
          name: "General",
          profileListAddresses: [`${PROFILE_LIST_KIND}:${memberListOwner}:General`],
        },
      ],
    })
    const secondDefinition = makeDefinition({
      id: "second-branch",
      pubkey: ownerPubkey,
      sections: [
        {
          name: "General",
          profileListAddresses: [`${PROFILE_LIST_KIND}:${otherMemberListOwner}:General`],
        },
      ],
    })
    const groups = getSharedProfileCommunityEvidenceGroups({
      targetPubkey,
      viewerCommunityRefs: [makeViewerRef(firstDefinition), makeViewerRef(secondDefinition)],
      profileListEvents: [
        makeProfileList({
          id: "first-members",
          pubkey: memberListOwner,
          identifier: "General",
          communityId: firstDefinition.communityId,
          members: [targetPubkey],
        }),
        makeProfileList({
          id: "second-members",
          pubkey: otherMemberListOwner,
          identifier: "General",
          communityId: secondDefinition.communityId,
          members: [targetPubkey],
        }),
      ],
    })

    expect(groups[0].items).toHaveLength(2)
    expect(new Set(groups[0].items.map(item => item.key))).toEqual(
      new Set([
        `member:${getDefinitionAddress(firstDefinition)}`,
        `member:${getDefinitionAddress(secondDefinition)}`,
      ]),
    )
  })

  it("keeps same-ID branches under different owners as separate moderation state", () => {
    const firstDefinition = makeDefinition({
      id: reportCommunityId,
      pubkey: sharedCommunityPubkey,
      sections: [{name: "General", profileListAddresses: []}],
    })
    const secondDefinition = makeDefinition({
      id: reportCommunityId,
      pubkey: otherSharedCommunityPubkey,
      sections: [{name: "General", profileListAddresses: []}],
    })
    const groups = getSharedProfileCommunityEvidenceGroups({
      targetPubkey,
      viewerCommunityRefs: [makeViewerRef(firstDefinition), makeViewerRef(secondDefinition)],
      reportStates: new Map([
        [
          getDefinitionAddress(firstDefinition),
          makeReportState(sharedCommunityPubkey, [targetPubkey]),
        ],
      ]),
    })

    expect(groups).toHaveLength(1)
    expect(groups[0].role).toBe("banned")
    expect(groups[0].items).toHaveLength(1)
    expect(groups[0].items[0].definition).toBe(firstDefinition)
  })

  it("accepts profile report evidence only from the exact shared branch", () => {
    const sharedDefinition = makeDefinition({
      id: reportCommunityId,
      pubkey: sharedCommunityPubkey,
      sections: [{name: "General", profileListAddresses: []}],
    })
    const siblingCommunityId = getPublicKey(new Uint8Array(32).fill(11))
    const siblingReport = makeEvent({
      id: "sibling-report",
      pubkey: viewerPubkey,
      ...makeCommunityEventReport({
        community: makeCommunityPointer({
          ownerPubkey: sharedCommunityPubkey,
          communityId: siblingCommunityId,
        })!,
        sectionName: "General",
        eventId: "reported-event",
        eventPubkey: targetPubkey,
      }),
    })

    const reports = getProfileFlagReportEvidence({
      targetPubkey,
      viewerPubkey,
      viewerCommunityRefs: [makeViewerRef(sharedDefinition)],
      reportEvents: [siblingReport],
    })

    expect(reports).toEqual([])
  })
  it("only presents community role evidence shared with the logged-in user", () => {
    const sharedAddress = `${PROFILE_LIST_KIND}:${memberListOwner}:General`
    const unsharedModeratorAddress = `${PROFILE_LIST_KIND}:${targetPubkey}:General`
    const sharedDefinition = makeDefinition({
      id: "shared",
      pubkey: sharedCommunityPubkey,
      sections: [{name: "General", profileListAddresses: [sharedAddress]}],
    })
    const unsharedDefinition = makeDefinition({
      id: "unshared",
      pubkey: unsharedCommunityPubkey,
      sections: [{name: "General", profileListAddresses: [unsharedModeratorAddress]}],
    })
    const groups = getSharedProfileCommunityEvidenceGroups({
      targetPubkey,
      viewerCommunityRefs: [makeViewerRef(sharedDefinition)],
      profileListEvents: [
        makeProfileList({
          id: "shared-member-list",
          pubkey: memberListOwner,
          identifier: "General",
          communityId: sharedDefinition.communityId,
          members: [targetPubkey],
        }),
        makeProfileList({
          id: "unshared-moderator-list",
          pubkey: targetPubkey,
          identifier: "General",
          communityId: unsharedDefinition.communityId,
        }),
      ],
    })

    expect(unsharedDefinition.ownerPubkey).toBe(unsharedCommunityPubkey)
    expect(groups.map(group => group.role)).toEqual(["member"])
    expect(groups[0].items.map(item => item.communityPubkey)).toEqual([sharedCommunityPubkey])
  })

  it("uses only the highest ranked role per shared community", () => {
    const moderatorAddress = `${PROFILE_LIST_KIND}:${targetPubkey}:General`
    const memberAddress = `${PROFILE_LIST_KIND}:${memberListOwner}:General`
    const definition = makeDefinition({
      id: "shared",
      pubkey: sharedCommunityPubkey,
      sections: [{name: "General", profileListAddresses: [moderatorAddress, memberAddress]}],
    })
    const groups = getSharedProfileCommunityEvidenceGroups({
      targetPubkey,
      viewerCommunityRefs: [makeViewerRef(definition)],
      profileListEvents: [
        makeProfileList({
          id: "moderator-list",
          pubkey: targetPubkey,
          identifier: "General",
          communityId: definition.communityId,
        }),
        makeProfileList({
          id: "member-list",
          pubkey: memberListOwner,
          identifier: "General",
          communityId: definition.communityId,
          members: [targetPubkey],
        }),
      ],
    })

    expect(groups.map(group => group.role)).toEqual(["moderator"])
    expect(groups[0].items[0]).toMatchObject({
      communityPubkey: sharedCommunityPubkey,
      sectionCount: 1,
      grantCount: 0,
    })
  })

  it("groups repeated moderator evidence and keeps section counts per community", () => {
    const sharedGeneralAddress = `${PROFILE_LIST_KIND}:${targetPubkey}:General`
    const sharedReposAddress = `${PROFILE_LIST_KIND}:${targetPubkey}:Repositories`
    const otherSharedGeneralAddress = `${PROFILE_LIST_KIND}:${targetPubkey}:OtherGeneral`
    const sharedDefinition = makeDefinition({
      id: "shared",
      pubkey: sharedCommunityPubkey,
      sections: [
        {name: "General", profileListAddresses: [sharedGeneralAddress]},
        {name: "Repositories", profileListAddresses: [sharedReposAddress]},
      ],
    })
    const otherSharedDefinition = makeDefinition({
      id: "other-shared",
      pubkey: otherSharedCommunityPubkey,
      sections: [{name: "General", profileListAddresses: [otherSharedGeneralAddress]}],
    })
    const groups = getSharedProfileCommunityEvidenceGroups({
      targetPubkey,
      viewerCommunityRefs: [makeViewerRef(sharedDefinition), makeViewerRef(otherSharedDefinition)],
      profileListEvents: [
        makeProfileList({
          id: "shared-general",
          pubkey: targetPubkey,
          identifier: "General",
          communityId: sharedDefinition.communityId,
        }),
        makeProfileList({
          id: "shared-repos",
          pubkey: targetPubkey,
          identifier: "Repositories",
          communityId: sharedDefinition.communityId,
        }),
        makeProfileList({
          id: "other-shared-general",
          pubkey: targetPubkey,
          identifier: "OtherGeneral",
          communityId: otherSharedDefinition.communityId,
        }),
      ],
    })
    const moderatorGroup = groups.find(group => group.role === "moderator")

    expect(moderatorGroup?.items).toHaveLength(2)
    expect(moderatorGroup?.items.map(item => item.sectionCount)).toEqual([2, 1])
  })

  it("adds ban evidence only from communities the logged-in user belongs to", () => {
    const sharedAddress = `${PROFILE_LIST_KIND}:${memberListOwner}:General`
    const otherSharedAddress = `${PROFILE_LIST_KIND}:${otherMemberListOwner}:General`
    const sharedDefinition = makeDefinition({
      id: "shared",
      pubkey: sharedCommunityPubkey,
      sections: [{name: "General", profileListAddresses: [sharedAddress]}],
    })
    const otherSharedDefinition = makeDefinition({
      id: "other-shared",
      pubkey: otherSharedCommunityPubkey,
      sections: [{name: "General", profileListAddresses: [otherSharedAddress]}],
    })
    const groups = getSharedProfileCommunityEvidenceGroups({
      targetPubkey,
      viewerCommunityRefs: [makeViewerRef(sharedDefinition), makeViewerRef(otherSharedDefinition)],
      profileListEvents: [
        makeProfileList({
          id: "shared-member-list",
          pubkey: memberListOwner,
          identifier: "General",
          communityId: sharedDefinition.communityId,
          members: [targetPubkey],
        }),
      ],
      reportStates: new Map([
        [
          getDefinitionAddress(sharedDefinition),
          makeReportState(sharedCommunityPubkey, [targetPubkey]),
        ],
        [
          getDefinitionAddress(otherSharedDefinition),
          makeReportState(otherSharedCommunityPubkey, [targetPubkey]),
        ],
        [
          `${COMMUNITY_DEFINITION_KIND}:${unsharedCommunityPubkey}:${reportCommunityId}`,
          makeReportState(unsharedCommunityPubkey, [targetPubkey]),
        ],
      ]),
    })

    expect(groups.map(group => group.role)).toEqual(["banned"])
    expect(groups[0].items.map(item => item.communityPubkey)).toEqual([
      sharedCommunityPubkey,
      otherSharedCommunityPubkey,
    ])
  })

  it("collects only the logged-in user's event-targeted reports in shared communities", () => {
    const sharedDefinition = makeDefinition({
      id: reportCommunityId,
      pubkey: sharedCommunityPubkey,
      sections: [{name: "General", profileListAddresses: []}],
    })
    const otherReporter = key(8)
    const ownEventReport = makeEvent({
      id: "own-event-report",
      pubkey: viewerPubkey,
      ...makeCommunityEventReport({
        community: makeReportCommunity(sharedCommunityPubkey),
        sectionName: "General",
        eventId: "reported-event",
        eventPubkey: targetPubkey,
        eventKind: 1,
        eventTitle: "Reported note",
        eventContent: "Reported content snapshot",
        content: "Off-topic",
      }),
    })
    const ownPersonReport = makeEvent({
      id: "own-person-report",
      pubkey: viewerPubkey,
      ...makeCommunityPersonReport({
        community: makeReportCommunity(sharedCommunityPubkey),
        pubkey: targetPubkey,
      }),
    })
    const otherReporterEventReport = makeEvent({
      id: "other-reporter-event-report",
      pubkey: otherReporter,
      ...makeCommunityEventReport({
        community: makeReportCommunity(sharedCommunityPubkey),
        sectionName: "General",
        eventId: "other-reported-event",
        eventPubkey: targetPubkey,
      }),
    })
    const unsharedEventReport = makeEvent({
      id: "unshared-event-report",
      pubkey: viewerPubkey,
      ...makeCommunityEventReport({
        community: makeReportCommunity(unsharedCommunityPubkey),
        sectionName: "General",
        eventId: "unshared-reported-event",
        eventPubkey: targetPubkey,
      }),
    })
    const reports = getProfileFlagReportEvidence({
      targetPubkey,
      viewerPubkey,
      viewerCommunityRefs: [makeViewerRef(sharedDefinition)],
      reportEvents: [
        ownEventReport,
        ownPersonReport,
        otherReporterEventReport,
        unsharedEventReport,
      ],
    })

    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      communityPubkey: sharedCommunityPubkey,
      targetEventId: "reported-event",
      targetEventKind: 1,
      targetEventTitle: "Reported note",
      targetEventContent: "Reported content snapshot",
      reason: "spam",
      reportContent: "Off-topic",
    })
  })

  it("preserves addressable flag metadata when the report target is an address", () => {
    const sharedDefinition = makeDefinition({
      id: reportCommunityId,
      pubkey: sharedCommunityPubkey,
      sections: [{name: "General", profileListAddresses: []}],
    })
    const targetAddress = `31922:${targetPubkey}:calendar-1`
    const addressReport = makeEvent({
      id: "address-report",
      pubkey: viewerPubkey,
      ...makeCommunityEventReport({
        community: makeReportCommunity(sharedCommunityPubkey),
        sectionName: "General",
        eventId: "",
        eventPubkey: targetPubkey,
        targetAddress,
      }),
    })
    addressReport.tags = addressReport.tags.map(tag =>
      tag[0] === "a" && tag[1] === targetAddress ? [tag[0], tag[1], "malware"] : tag,
    )

    const reports = getProfileFlagReportEvidence({
      targetPubkey,
      viewerPubkey,
      viewerCommunityRefs: [makeViewerRef(sharedDefinition)],
      reportEvents: [addressReport],
    })

    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      targetAddress,
      targetEventKind: 31922,
      targetIdentifier: "calendar-1",
      reason: "malware",
    })
  })
})
