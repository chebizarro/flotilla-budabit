import {describe, expect, it, vi} from "vitest"
import type {RequestOptions} from "@welshman/net"
import {DELETE, EVENT_TIME, type TrustedEvent} from "@welshman/util"
import {getPublicKey} from "nostr-tools/pure"
import {
  COMMUNITY_DEFINITION_KIND,
  FORM_RESPONSE_KIND,
  FORM_TEMPLATE_KIND,
  PROFILE_LIST_KIND,
  TARGETED_PUBLICATION_KIND,
  buildCommunityDefinition,
  makeCommunityPointer,
  parseCommunityDefinition,
} from "./community"
import {makeCommunityGrantEvent, makeCommunityRevokeEvent} from "./community-admin"
import {
  makeTargetedPublicationForCommunity,
  makeAddressablePublicationRef,
} from "./community-targeting"
import {
  makeCommunityContentFilterPlan,
  makeCommunityExclusiveFilter,
  makeTargetedPublicationOriginalFilters,
} from "./community-feeds"
import {createBoundedCommunityHistoryLoader} from "./requests"
import {
  COMMUNITY_WRITE_TARGETS,
  canWriteCommunityTarget,
  getCommunityPublishGateState,
  getCommunitySectionWriterPubkeys,
  getGrantCapableSectionModeratorPubkeys,
} from "./community-permissions"
import {
  makeAdmissionFormAddress,
  makeAdmissionFormTemplate,
  makeAdmissionResponse,
  makeAdmissionResponseDelete,
  makeAdmissionReview,
  selectActiveAdmissionForm,
  getAdmissionSubmissionState,
} from "./community-forms"

const testPubkey = (value: number) => getPublicKey(new Uint8Array(32).fill(value))
const communityPubkey = testPubkey(31)
const communityPointer = makeCommunityPointer({
  ownerPubkey: communityPubkey,
  communityId: communityPubkey,
})!
const moderatorPubkey = testPubkey(32)
const applicantPubkey = testPubkey(33)
const outsiderPubkey = testPubkey(34)
const approvedCalendarPubkey = testPubkey(35)
const unauthorizedCalendarPubkey = testPubkey(36)

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: moderatorPubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const generalListRef = {
  kind: PROFILE_LIST_KIND,
  pubkey: moderatorPubkey,
  identifier: "General",
  address: `${PROFILE_LIST_KIND}:${moderatorPubkey}:General`,
}
const ownerGeneralListRef = {
  address: `${PROFILE_LIST_KIND}:${communityPubkey}:General`,
}
const repoListRef = {
  kind: PROFILE_LIST_KIND,
  pubkey: moderatorPubkey,
  identifier: "Repositories",
  address: `${PROFILE_LIST_KIND}:${moderatorPubkey}:Repositories`,
}
const calendarListRef = {
  kind: PROFILE_LIST_KIND,
  pubkey: moderatorPubkey,
  identifier: "Calendar-event-creator",
  address: `${PROFILE_LIST_KIND}:${moderatorPubkey}:Calendar-event-creator`,
}
const definition = parseCommunityDefinition(
  makeEvent({
    id: "community-definition",
    kind: COMMUNITY_DEFINITION_KIND,
    pubkey: communityPubkey,
    tags: buildCommunityDefinition({
      communityId: communityPointer.communityId,
      name: "Admission lifecycle",
      relays: ["wss://community.example"],
      sections: [
        {
          name: "General",
          kinds: [{kind: 9, subtype: "room-message"}, {kind: 1111}, {kind: 7}],
          profileLists: [ownerGeneralListRef, generalListRef],
        },
        {
          name: "Repositories",
          kinds: [{kind: 30617}],
          profileLists: [repoListRef],
        },
        {
          name: "Calendar-event-creator",
          kinds: [{kind: EVENT_TIME}],
          profileLists: [calendarListRef],
        },
      ],
    }).tags,
  }),
)!

const formTemplate = makeAdmissionFormTemplate({
  identifier: "general-application",
  community: communityPointer,
  sectionName: "General",
  name: "General application",
  fields: [
    {id: "intro", label: "Why should we grant access?"},
    {id: "rules", type: "label", label: "Community rules apply."},
    {
      id: "focus",
      type: "option",
      label: "Primary focus",
      options: [
        {id: "rooms", label: "Rooms"},
        {id: "threads", label: "Threads"},
      ],
    },
  ],
})
const form = selectActiveAdmissionForm({
  events: [
    makeEvent({
      id: "outsider-form",
      pubkey: outsiderPubkey,
      kind: FORM_TEMPLATE_KIND,
      tags: formTemplate.tags,
    }),
    makeEvent({
      id: "active-form",
      pubkey: moderatorPubkey,
      kind: FORM_TEMPLATE_KIND,
      tags: formTemplate.tags,
    }),
  ],
  community: communityPointer,
  sectionName: "General",
  moderatorPubkeys: [moderatorPubkey],
})!
const formAddress = makeAdmissionFormAddress(moderatorPubkey, "general-application")

describe("community admission lifecycle integration", () => {
  it("covers application, duplicate prevention, delete/resubmit, review, grants, gates, and filtered reads", () => {
    expect(form.event.id).toBe("active-form")
    expect(form.fields.focus.type).toBe("option")

    const firstResponse = makeEvent({
      id: "response-1",
      kind: FORM_RESPONSE_KIND,
      pubkey: applicantPubkey,
      created_at: 10,
      tags: makeAdmissionResponse({
        community: communityPointer,
        formAddress,
        values: {intro: "I build room tools.", focus: "rooms"},
      }).tags,
    })
    const duplicateResponse = makeEvent({
      id: "response-2",
      kind: FORM_RESPONSE_KIND,
      pubkey: applicantPubkey,
      created_at: 11,
      tags: makeAdmissionResponse({
        community: communityPointer,
        formAddress,
        values: {intro: "A duplicate active submission.", focus: "threads"},
      }).tags,
    })

    expect(
      getAdmissionSubmissionState({
        community: communityPointer,
        responseEvents: [firstResponse, duplicateResponse],
        deleteEvents: [],
        reviewEvents: [],
        formAddress,
        applicantPubkey,
        moderatorPubkeys: [moderatorPubkey],
      }).response?.event.id,
    ).toBe("response-2")

    const deleteDuplicate = makeEvent({
      id: "delete-response-2",
      kind: DELETE,
      pubkey: applicantPubkey,
      created_at: 12,
      tags: makeAdmissionResponseDelete({
        community: communityPointer,
        responseId: "response-2",
      }).tags,
    })
    const revisedResponse = makeEvent({
      id: "response-3",
      kind: FORM_RESPONSE_KIND,
      pubkey: applicantPubkey,
      created_at: 13,
      tags: makeAdmissionResponse({
        community: communityPointer,
        formAddress,
        values: {intro: "A revised application.", focus: "threads"},
      }).tags,
    })
    const rejection = makeEvent({
      id: "reject-response-3",
      kind: 7,
      pubkey: moderatorPubkey,
      created_at: 14,
      content: "-",
      tags: makeAdmissionReview({
        responseId: "response-3",
        applicantPubkey,
        formAddress,
        community: communityPointer,
        status: "rejected",
      }).tags,
    })
    const grantReview = makeEvent({
      id: "grant-response-3",
      kind: 7,
      pubkey: moderatorPubkey,
      created_at: 15,
      content: "+",
      tags: makeAdmissionReview({
        responseId: "response-3",
        applicantPubkey,
        formAddress,
        community: communityPointer,
        status: "granted",
      }).tags,
    })

    expect(
      getAdmissionSubmissionState({
        community: communityPointer,
        responseEvents: [firstResponse, duplicateResponse, revisedResponse],
        deleteEvents: [deleteDuplicate],
        reviewEvents: [rejection],
        formAddress,
        applicantPubkey,
        moderatorPubkeys: [moderatorPubkey],
      }).status,
    ).toBe("rejected")
    expect(
      getAdmissionSubmissionState({
        community: communityPointer,
        responseEvents: [firstResponse, duplicateResponse, revisedResponse],
        deleteEvents: [deleteDuplicate],
        reviewEvents: [rejection, grantReview],
        formAddress,
        applicantPubkey,
        moderatorPubkeys: [moderatorPubkey],
      }).status,
    ).toBe("granted")

    expect(
      getCommunityPublishGateState({
        definition,
        profileListEvents: [],
        userPubkey: applicantPubkey,
        target: COMMUNITY_WRITE_TARGETS.comment,
        form,
        responseEvents: [revisedResponse],
      }).status,
    ).toBe("pending")

    const grantEvent = makeCommunityGrantEvent({
      profileList: generalListRef,
      pubkey: applicantPubkey,
    })
    const grantedProfileList = makeEvent({
      id: "general-list-granted",
      kind: PROFILE_LIST_KIND,
      pubkey: moderatorPubkey,
      tags: grantEvent.tags,
    })
    const revokeReview = makeEvent({
      id: "revoke-response-3",
      kind: 7,
      pubkey: moderatorPubkey,
      created_at: 16,
      content: "-",
      tags: makeAdmissionReview({
        responseId: "response-3",
        applicantPubkey,
        formAddress,
        community: communityPointer,
        sectionName: "General",
        status: "rejected",
      }).tags,
    })
    const revokedProfileList = makeEvent({
      id: "general-list-revoked",
      kind: PROFILE_LIST_KIND,
      pubkey: moderatorPubkey,
      created_at: 16,
      tags: makeCommunityRevokeEvent({
        profileList: generalListRef,
        profileListEvent: grantedProfileList,
        pubkey: applicantPubkey,
      }).tags,
    })

    expect(
      canWriteCommunityTarget({
        definition,
        profileListEvents: [grantedProfileList],
        userPubkey: applicantPubkey,
        target: COMMUNITY_WRITE_TARGETS.comment,
      }),
    ).toBe(true)
    expect(
      canWriteCommunityTarget({
        definition,
        profileListEvents: [grantedProfileList],
        userPubkey: applicantPubkey,
        target: COMMUNITY_WRITE_TARGETS.repository,
      }),
    ).toBe(false)
    expect(
      getAdmissionSubmissionState({
        community: communityPointer,
        responseEvents: [firstResponse, duplicateResponse, revisedResponse],
        deleteEvents: [deleteDuplicate],
        reviewEvents: [rejection, grantReview, revokeReview],
        formAddress,
        applicantPubkey,
        moderatorPubkeys: [moderatorPubkey],
        profileListGranted: true,
      }).status,
    ).toBe("rejected")
    expect(
      canWriteCommunityTarget({
        definition,
        profileListEvents: [revokedProfileList],
        userPubkey: applicantPubkey,
        target: COMMUNITY_WRITE_TARGETS.comment,
      }),
    ).toBe(false)

    const calendarList = makeEvent({
      id: "calendar-list",
      kind: PROFILE_LIST_KIND,
      pubkey: moderatorPubkey,
      tags: [
        ["d", "Calendar-event-creator"],
        ["p", approvedCalendarPubkey],
      ],
    })
    const calendarAuthors = getCommunitySectionWriterPubkeys({
      definition,
      profileListEvents: [calendarList],
      sectionName: "Calendar-event-creator",
    })
    const approvedTargeting = makeEvent({
      id: "approved-targeting",
      kind: TARGETED_PUBLICATION_KIND,
      pubkey: approvedCalendarPubkey,
      tags: makeTargetedPublicationForCommunity({
        targetingId: "approved-event",
        originalKind: EVENT_TIME,
        originalRef: makeAddressablePublicationRef({
          kind: EVENT_TIME,
          pubkey: approvedCalendarPubkey,
          identifier: "approved-event",
        }),
        community: communityPointer,
      }).tags,
    })
    const unauthorizedTargeting = makeEvent({
      id: "unauthorized-targeting",
      kind: TARGETED_PUBLICATION_KIND,
      pubkey: unauthorizedCalendarPubkey,
      tags: makeTargetedPublicationForCommunity({
        targetingId: "unauthorized-event",
        originalKind: EVENT_TIME,
        originalRef: makeAddressablePublicationRef({
          kind: EVENT_TIME,
          pubkey: unauthorizedCalendarPubkey,
          identifier: "unauthorized-event",
        }),
        community: communityPointer,
      }).tags,
    })

    expect(
      makeTargetedPublicationOriginalFilters(
        [approvedTargeting, unauthorizedTargeting],
        calendarAuthors,
      ),
    ).toEqual([
      {
        kinds: [EVENT_TIME],
        authors: [approvedCalendarPubkey],
        "#d": ["approved-event"],
        limit: 1,
      },
    ])
  })

  it("ignores grants, forms, and reviews from a removed moderator", () => {
    const grantEvent = makeCommunityGrantEvent({
      profileList: generalListRef,
      pubkey: applicantPubkey,
    })
    const grantedProfileList = makeEvent({
      id: "general-list-granted",
      kind: PROFILE_LIST_KIND,
      pubkey: moderatorPubkey,
      tags: grantEvent.tags,
    })
    const revokedDefinition = parseCommunityDefinition(
      makeEvent({
        id: "community-definition-revoked",
        kind: COMMUNITY_DEFINITION_KIND,
        pubkey: communityPubkey,
        tags: definition.event.tags.filter(
          tag => !(tag[0] === "a" && tag[1] === generalListRef.address),
        ),
      }),
    )!
    const response = makeEvent({
      id: "response-revoked-moderator",
      kind: FORM_RESPONSE_KIND,
      pubkey: applicantPubkey,
      tags: makeAdmissionResponse({
        community: communityPointer,
        formAddress,
        values: {intro: "I was approved by a removed moderator."},
      }).tags,
    })
    const grantReview = makeEvent({
      id: "grant-response-revoked-moderator",
      kind: 7,
      pubkey: moderatorPubkey,
      created_at: 2,
      content: "+",
      tags: makeAdmissionReview({
        responseId: response.id,
        applicantPubkey,
        formAddress,
        community: communityPointer,
        status: "granted",
      }).tags,
    })
    const currentModerators = getGrantCapableSectionModeratorPubkeys({
      definition: revokedDefinition,
      sectionName: "General",
    })

    expect(
      canWriteCommunityTarget({
        definition,
        profileListEvents: [grantedProfileList],
        userPubkey: applicantPubkey,
        target: COMMUNITY_WRITE_TARGETS.comment,
      }),
    ).toBe(true)
    expect(
      canWriteCommunityTarget({
        definition: revokedDefinition,
        profileListEvents: [grantedProfileList],
        userPubkey: applicantPubkey,
        target: COMMUNITY_WRITE_TARGETS.comment,
      }),
    ).toBe(false)
    expect(currentModerators).toEqual([communityPubkey])
    expect(
      selectActiveAdmissionForm({
        events: [form.event],
        community: communityPointer,
        sectionName: "General",
        moderatorPubkeys: currentModerators,
      }),
    ).toBeUndefined()
    expect(
      getAdmissionSubmissionState({
        community: communityPointer,
        responseEvents: [response],
        deleteEvents: [],
        reviewEvents: [grantReview],
        formAddress,
        applicantPubkey,
        moderatorPubkeys: currentModerators,
      }).status,
    ).toBe("pending")
  })

  it("hides historical content on revoke and refetches it on regrant", async () => {
    const relay = "wss://admission-lifecycle.test"
    const historicalContent = makeEvent({
      id: "historical-community-content",
      pubkey: applicantPubkey,
      created_at: 5,
      kind: 1111,
      tags: [["h", communityPubkey]],
      content: "Historical community content",
    })
    const grantedProfileList = makeEvent({
      id: "general-list-grant-lifecycle",
      kind: PROFILE_LIST_KIND,
      pubkey: moderatorPubkey,
      created_at: 10,
      tags: makeCommunityGrantEvent({
        profileList: generalListRef,
        pubkey: applicantPubkey,
      }).tags,
    })
    const revokedProfileList = makeEvent({
      id: "general-list-revoke-lifecycle",
      kind: PROFILE_LIST_KIND,
      pubkey: moderatorPubkey,
      created_at: 20,
      tags: makeCommunityRevokeEvent({
        profileList: generalListRef,
        profileListEvent: grantedProfileList,
        pubkey: applicantPubkey,
      }).tags,
    })
    const regrantedProfileList = makeEvent({
      id: "general-list-regrant-lifecycle",
      kind: PROFILE_LIST_KIND,
      pubkey: moderatorPubkey,
      created_at: 30,
      tags: makeCommunityGrantEvent({
        profileList: generalListRef,
        profileListEvent: revokedProfileList,
        pubkey: applicantPubkey,
      }).tags,
    })
    const request = vi.fn(async (options: RequestOptions) => {
      expect(options.filters[0]).not.toHaveProperty("authors")
      options.onEvent?.(historicalContent, relay)
      options.onEose?.(relay)
      return [historicalContent]
    })
    const publish = vi.fn()
    const loadHistory = createBoundedCommunityHistoryLoader({request, publish, track: vi.fn()})
    const loadWithCurrentAdmission = (profileListEvents: TrustedEvent[]) => {
      const writers = getCommunitySectionWriterPubkeys({
        definition,
        profileListEvents,
        sectionName: "General",
      })
      const plan = makeCommunityContentFilterPlan(
        [makeCommunityExclusiveFilter(communityPubkey, [historicalContent.kind])],
        writers,
      )

      return loadHistory({
        relays: [relay],
        ...plan,
        timeoutMs: 1000,
      })
    }

    const granted = await loadWithCurrentAdmission([grantedProfileList])
    const revoked = await loadWithCurrentAdmission([grantedProfileList, revokedProfileList])
    const regranted = await loadWithCurrentAdmission([
      grantedProfileList,
      revokedProfileList,
      regrantedProfileList,
    ])

    expect(granted.events).toEqual([historicalContent])
    expect(revoked.events).toEqual([])
    expect(regranted.events).toEqual([historicalContent])
    expect(request).toHaveBeenCalledTimes(3)
    expect(publish.mock.calls.map(([event]) => event)).toEqual([
      historicalContent,
      historicalContent,
    ])
  })
})
