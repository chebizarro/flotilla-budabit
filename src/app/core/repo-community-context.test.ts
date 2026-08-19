import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {GIT_REPO_ANNOUNCEMENT} from "@nostr-git/core/events"
import {getPublicKey} from "nostr-tools/pure"
import {
  COMMUNITY_DEFINITION_KIND_V2,
  PROFILE_LIST_KIND,
  TARGETED_PUBLICATION_KIND_V2,
  buildCommunityDefinitionV2,
  buildTargetedPublicationV2,
  makeCommunityPointer,
  parseCommunityDefinitionV2,
} from "./community"
import {
  COMMUNITY_REPORT_KIND,
  getEffectiveCommunityReportState,
  makeCommunityPersonReport,
} from "./community-reports"
import {
  buildRepoCommunityContexts,
  getPrimaryRepoCommunityContext,
  isAuthorizedDirectCommunityRepo,
  isEndorsedRepoCommunityContext,
} from "./repo-community-context"

const key = (value: number) => getPublicKey(new Uint8Array(32).fill(value))
const repoOwnerPubkey = key(1)
const communityPubkey = key(2)
const moderatorPubkey = key(3)
const granteePubkey = key(4)
const outsiderPubkey = key(5)
const otherCommunityPubkey = key(6)
const repoAddress = `${GIT_REPO_ANNOUNCEMENT}:${repoOwnerPubkey}:demo`
const reportCommunity = makeCommunityPointer({
  controllerPubkey: communityPubkey,
  communityId: moderatorPubkey,
})!

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: repoOwnerPubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const makeDefinition = (pubkey = communityPubkey, sectionName = "Code-curator") => {
  return parseCommunityDefinitionV2(
    makeEvent({
      id: `definition-${pubkey}`,
      pubkey,
      kind: COMMUNITY_DEFINITION_KIND_V2,
      tags: buildCommunityDefinitionV2({
        communityId: moderatorPubkey,
        name: "Community",
        relays: ["wss://relay.example.com"],
        sections: [
          {
            name: sectionName,
            kinds: [{kind: GIT_REPO_ANNOUNCEMENT}],
            profileLists: [{address: `${PROFILE_LIST_KIND}:${moderatorPubkey}:${sectionName}`}],
          },
        ],
      }).tags,
    }),
  )!
}

const makeProfileList = ({members = [granteePubkey], sectionName = "Code-curator"} = {}) =>
  makeEvent({
    id: "repo-profile-list",
    pubkey: moderatorPubkey,
    kind: PROFILE_LIST_KIND,
    tags: [["d", sectionName], ...members.map(member => ["p", member])],
  })

const makeRepo = (overrides: Partial<TrustedEvent> = {}) =>
  makeEvent({
    id: "repo-event",
    pubkey: repoOwnerPubkey,
    kind: GIT_REPO_ANNOUNCEMENT,
    tags: [["d", "demo"]],
    ...overrides,
  })

const makeAssociation = ({
  pubkey,
  community = makeCommunityPointer({
    controllerPubkey: communityPubkey,
    communityId: moderatorPubkey,
  })!,
  createdAt = 10,
}: {
  pubkey: string
  community?: NonNullable<ReturnType<typeof makeCommunityPointer>>
  createdAt?: number
}) =>
  makeEvent({
    id: `association-${pubkey}-${community.address}`,
    pubkey,
    created_at: createdAt,
    kind: TARGETED_PUBLICATION_KIND_V2,
    tags: buildTargetedPublicationV2({
      id: `target-${community.address}`,
      kind: GIT_REPO_ANNOUNCEMENT,
      source: {type: "a", value: repoAddress},
      communities: [community],
    }).tags,
  })

describe("repo community context", () => {
  it("accepts direct stable-h repositories only from authorized section writers", () => {
    const event = makeRepo({
      pubkey: granteePubkey,
      tags: [
        ["d", "demo"],
        ["h", moderatorPubkey, "wss://relay.example.com"],
      ],
    })

    expect(
      isAuthorizedDirectCommunityRepo({
        event,
        communityId: moderatorPubkey,
        authorPubkeys: [granteePubkey],
      }),
    ).toBe(true)
    expect(
      isAuthorizedDirectCommunityRepo({
        event,
        communityId: moderatorPubkey,
        authorPubkeys: [outsiderPubkey],
      }),
    ).toBe(false)
  })

  it("does not treat legacy direct repository tags as V2 associations", () => {
    const definition = makeDefinition()
    const tags = [
      ["d", "demo"],
      ["h", communityPubkey],
    ]
    const granteeContext = getPrimaryRepoCommunityContext({
      repoEvent: makeRepo({pubkey: granteePubkey, tags}),
      definitions: [definition],
      profileListEvents: [makeProfileList()],
    })
    const outsiderContext = getPrimaryRepoCommunityContext({
      repoEvent: makeRepo({pubkey: outsiderPubkey, tags}),
      definitions: [definition],
      profileListEvents: [makeProfileList()],
    })

    expect(granteeContext).toBeUndefined()
    expect(outsiderContext).toBeUndefined()
  })

  it("strongly validates repo associations from community admins and repo moderators", () => {
    const definition = makeDefinition()
    const repoEvent = makeRepo()
    const adminAssociation = makeAssociation({pubkey: communityPubkey})
    const moderatorAssociation = makeAssociation({pubkey: moderatorPubkey})

    const adminContext = getPrimaryRepoCommunityContext({
      repoEvent,
      repoAddress,
      associationEvents: [adminAssociation],
      definitions: [definition],
      profileListEvents: [makeProfileList()],
    })
    const moderatorContext = getPrimaryRepoCommunityContext({
      repoEvent,
      repoAddress,
      associationEvents: [moderatorAssociation],
      definitions: [definition],
      profileListEvents: [makeProfileList()],
    })

    expect(adminContext).toMatchObject({validation: "strong", communityPubkey})
    expect(moderatorContext).toMatchObject({validation: "strong", communityPubkey})
    expect(adminContext?.evidence.map(item => item.label)).toContain("Associated by repo authority")
  })

  it("strongly validates repo authority from custom sections that support repositories", () => {
    const definition = makeDefinition(communityPubkey, "Code")
    const repoEvent = makeRepo()
    const moderatorAssociation = makeAssociation({pubkey: moderatorPubkey})

    const context = getPrimaryRepoCommunityContext({
      repoEvent,
      repoAddress,
      associationEvents: [moderatorAssociation],
      definitions: [definition],
      profileListEvents: [makeProfileList({sectionName: "Code"})],
    })

    expect(context).toMatchObject({validation: "strong", communityPubkey})
    expect(context?.evidence.map(item => item.label)).toContain("Associated by repo authority")
  })

  it("validates repo-section grantee associations but leaves outsider associations weak", () => {
    const definition = makeDefinition()
    const repoEvent = makeRepo()
    const profileListEvents = [makeProfileList()]
    const granteeContext = getPrimaryRepoCommunityContext({
      repoEvent,
      repoAddress,
      associationEvents: [makeAssociation({pubkey: granteePubkey})],
      definitions: [definition],
      profileListEvents,
    })
    const outsiderContext = getPrimaryRepoCommunityContext({
      repoEvent,
      repoAddress,
      associationEvents: [makeAssociation({pubkey: outsiderPubkey})],
      definitions: [definition],
      profileListEvents,
    })

    expect(granteeContext).toMatchObject({validation: "valid", communityPubkey})
    expect(granteeContext?.evidence.map(item => item.label)).toEqual([
      "Community repo",
      "Associated by repo grant",
    ])
    expect(isEndorsedRepoCommunityContext(granteeContext)).toBe(true)
    expect(outsiderContext).toMatchObject({validation: "weak", communityPubkey})
    expect(isEndorsedRepoCommunityContext(outsiderContext)).toBe(false)
  })

  it("requires implicit originals to share the authorized wrapper signer", () => {
    const definition = makeDefinition()
    const targetingId = "implicit-target"
    const association = makeEvent({
      id: "implicit-association",
      pubkey: granteePubkey,
      kind: TARGETED_PUBLICATION_KIND_V2,
      tags: buildTargetedPublicationV2({
        id: targetingId,
        kind: GIT_REPO_ANNOUNCEMENT,
        communities: [reportCommunity],
      }).tags,
    })
    const externalRepo = makeRepo({
      tags: [
        ["d", "demo"],
        ["h", targetingId],
      ],
    })
    const signerRepo = makeRepo({
      pubkey: granteePubkey,
      tags: [
        ["d", "demo"],
        ["h", targetingId],
      ],
    })

    expect(
      getPrimaryRepoCommunityContext({
        repoEvent: externalRepo,
        associationEvents: [association],
        definitions: [definition],
        profileListEvents: [makeProfileList()],
      }),
    ).toBeUndefined()
    expect(
      getPrimaryRepoCommunityContext({
        repoEvent: signerRepo,
        associationEvents: [association],
        definitions: [definition],
        profileListEvents: [makeProfileList()],
      }),
    ).toMatchObject({validation: "valid", communityPubkey})
  })

  it("suppresses associations when the associator or repo owner is banned in that community", () => {
    const definition = makeDefinition()
    const repoEvent = makeRepo()
    const banAssociator = makeEvent({
      id: "ban-associator",
      pubkey: communityPubkey,
      kind: COMMUNITY_REPORT_KIND,
      tags: makeCommunityPersonReport({community: reportCommunity, pubkey: granteePubkey}).tags,
    })
    const banOwner = makeEvent({
      id: "ban-owner",
      pubkey: communityPubkey,
      kind: COMMUNITY_REPORT_KIND,
      tags: makeCommunityPersonReport({community: reportCommunity, pubkey: repoOwnerPubkey}).tags,
    })
    const reportState = getEffectiveCommunityReportState({
      definition,
      reportEvents: [banAssociator, banOwner],
    })

    const context = getPrimaryRepoCommunityContext({
      repoEvent,
      repoAddress,
      associationEvents: [makeAssociation({pubkey: granteePubkey})],
      definitions: [definition],
      profileListEvents: [makeProfileList()],
      reportStates: new Map([[reportCommunity.address, reportState]]),
    })

    expect(context).toMatchObject({validation: "invalid", suppressed: true})
    expect(context?.suppressionReason).toBe("community_ban")
    expect(context?.evidence.map(item => item.label)).toEqual(["Community repo", "Banned here"])
    expect(isEndorsedRepoCommunityContext(context)).toBe(false)
  })

  it("sorts the active community context before unrelated community associations", () => {
    const definition = makeDefinition()
    const otherDefinition = makeDefinition(otherCommunityPubkey)
    const repoEvent = makeRepo()
    const contexts = buildRepoCommunityContexts({
      repoEvent,
      repoAddress,
      associationEvents: [
        makeAssociation({pubkey: communityPubkey, community: reportCommunity, createdAt: 10}),
        makeAssociation({
          pubkey: otherCommunityPubkey,
          community: makeCommunityPointer({
            controllerPubkey: otherCommunityPubkey,
            communityId: moderatorPubkey,
          })!,
          createdAt: 20,
        }),
      ],
      definitions: [definition, otherDefinition],
      profileListEvents: [makeProfileList()],
      activeCommunityPubkey: communityPubkey,
    })

    expect(contexts.map(context => context.communityPubkey)).toEqual([
      communityPubkey,
      otherCommunityPubkey,
    ])
    expect(new Set(contexts.map(context => context.communityAddress))).toEqual(
      new Set([reportCommunity.address, `32222:${otherCommunityPubkey}:${moderatorPubkey}`]),
    )
  })
})
