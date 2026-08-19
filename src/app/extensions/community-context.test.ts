import {describe, expect, it} from "vitest"
import {EVENT_DATE, EVENT_TIME, THREAD, type TrustedEvent} from "@welshman/util"
import {getPublicKey} from "nostr-tools/pure"
import {GIT_REPO_ANNOUNCEMENT} from "@nostr-git/core/events"
import {
  COMMUNITY_SUBTYPE_ROOM,
  COMMUNITY_SUBTYPE_THREADS,
  COMMUNITY_DEFINITION_KIND_V2,
  PROFILE_LIST_KIND,
  TARGETED_PUBLICATION_KIND,
  buildCommunityDefinitionV2,
  makeCommunityPointer,
  parseCommunityDefinitionV2,
  type CommunitySectionInputV2,
} from "@app/core/community"
import {
  makeAddressablePublicationRef,
  makeTargetedPublicationForCommunityV2,
} from "@app/core/community-targeting"
import {
  filterAuthorizedCommunityDescriptorEvents,
  filterCommunityDescriptorEvents,
  makeCommunityDescriptorQueryPlan,
  makeCommunityWidgetContext,
  resolveCommunityEventDescriptors,
} from "./community-context"

const testPubkey = (value: number) => getPublicKey(new Uint8Array(32).fill(value))
const communityPubkey = testPubkey(41)
const communityPointer = makeCommunityPointer({
  controllerPubkey: communityPubkey,
  communityId: communityPubkey,
  relayHints: ["wss://relay.example.com/"],
})!
const calendarWriterPubkey = testPubkey(42)
const outsiderPubkey = testPubkey(43)
const calendarMemberPubkey = testPubkey(44)

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: communityPubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const makeDefinition = (sections: CommunitySectionInputV2[]) =>
  parseCommunityDefinitionV2(
    makeEvent({
      kind: COMMUNITY_DEFINITION_KIND_V2,
      content: "",
      tags: buildCommunityDefinitionV2({
        communityId: communityPubkey,
        name: "Test community",
        description: "Definition description",
        picture: "https://community.example/picture.png",
        relays: ["wss://relay.example"],
        sections,
      }).tags,
    }),
  )!

const definition = makeDefinition([
  {
    name: "Events and meetups",
    kinds: [{kind: EVENT_TIME}, {kind: EVENT_DATE}],
    profileLists: [{address: `${PROFILE_LIST_KIND}:${calendarWriterPubkey}:Events and meetups`}],
  },
])

const dateOnlyCalendarDefinition = makeDefinition([
  {
    name: "Calendar",
    kinds: [{kind: EVENT_DATE}],
    profileLists: [{address: `${PROFILE_LIST_KIND}:${calendarWriterPubkey}:Calendar`}],
  },
])

const calendarProfileList = makeEvent({
  kind: PROFILE_LIST_KIND,
  pubkey: calendarWriterPubkey,
  tags: [
    ["d", "Events and meetups"],
    ["p", calendarWriterPubkey],
    ["p", calendarMemberPubkey],
  ],
})

const dateOnlyCalendarProfileList = makeEvent({
  kind: PROFILE_LIST_KIND,
  pubkey: calendarWriterPubkey,
  tags: [
    ["d", "Calendar"],
    ["p", calendarWriterPubkey],
    ["p", calendarMemberPubkey],
  ],
})

const makeCalendarTargetingEvent = ({
  id,
  pubkey,
  identifier,
  originalPubkey = pubkey,
  implicit = false,
}: {
  id: string
  pubkey: string
  identifier: string
  originalPubkey?: string
  implicit?: boolean
}) =>
  makeEvent({
    id,
    pubkey,
    kind: TARGETED_PUBLICATION_KIND,
    tags: makeTargetedPublicationForCommunityV2({
      targetingId: id,
      originalKind: EVENT_TIME,
      originalRef: implicit
        ? undefined
        : makeAddressablePublicationRef({
            kind: EVENT_TIME,
            pubkey: originalPubkey,
            identifier,
            relay: "wss://relay.example.com/",
          }),
      community: communityPointer,
    }).tags,
  })

describe("community widget context", () => {
  it("exposes community context without extension-facing write target taxonomy", () => {
    const context = makeCommunityWidgetContext({
      definition,
      profileListEvents: [calendarProfileList],
      userPubkey: calendarWriterPubkey,
      relays: ["wss://relay.example.com/"],
      relayHints: ["wss://relay.example.com/"],
    })

    expect(context.sections).toContainEqual({
      name: "Events and meetups",
      kinds: [{kind: EVENT_TIME}, {kind: EVENT_DATE}],
    })
    expect(context.contextSessionId).toMatch(/^community-context-/)
    expect(context.contextVersion).toBe(0)
    expect(context).toMatchObject({
      version: 2,
      communityId: communityPointer.communityId,
      controllerPubkey: communityPointer.controllerPubkey,
      definitionAddress: communityPointer.address,
      naddr: definition.pointer.naddr,
    })
    expect(context).not.toHaveProperty("pubkey")
    expect(context).not.toHaveProperty("ncommunity")
    expect(context).not.toHaveProperty("writeTargets")
  })

  it("sources its community profile exclusively from definition metadata", () => {
    const context = makeCommunityWidgetContext({
      definition,
      profileListEvents: [],
      relays: ["wss://relay.example.com/"],
    })

    expect(context.profile).toEqual({
      name: definition.metadata.name,
      displayName: definition.metadata.name,
      picture: definition.metadata.picture,
      about: definition.metadata.description,
    })
  })

  it("resolves descriptor write capabilities from active sections without defaults", () => {
    const resolved = resolveCommunityEventDescriptors({
      definition,
      profileListEvents: [calendarProfileList],
      userPubkey: calendarWriterPubkey,
      descriptors: [{kind: EVENT_TIME}, {kind: EVENT_DATE}],
    })

    expect(resolved.map(info => info.capability)).toEqual([
      {
        descriptor: {kind: EVENT_TIME},
        sectionNames: ["Events and meetups"],
        writableSectionNames: ["Events and meetups"],
        moderatorSectionNames: ["Events and meetups"],
        canWrite: true,
        canModerate: true,
      },
      {
        descriptor: {kind: EVENT_DATE},
        sectionNames: ["Events and meetups"],
        writableSectionNames: ["Events and meetups"],
        moderatorSectionNames: ["Events and meetups"],
        canWrite: true,
        canModerate: true,
      },
    ])
  })

  it("recognizes profile-list members as writers without section moderation authority", () => {
    const resolved = resolveCommunityEventDescriptors({
      definition,
      profileListEvents: [calendarProfileList],
      userPubkey: calendarMemberPubkey,
      descriptors: [{kind: EVENT_TIME}],
    })

    expect(resolved[0]?.capability).toEqual({
      descriptor: {kind: EVENT_TIME},
      sectionNames: ["Events and meetups"],
      writableSectionNames: ["Events and meetups"],
      moderatorSectionNames: [],
      canWrite: true,
      canModerate: false,
    })
  })

  it("only grants profile-list manager authority when its active list event exists", () => {
    const missingManager = resolveCommunityEventDescriptors({
      definition,
      profileListEvents: [],
      userPubkey: calendarWriterPubkey,
      descriptors: [{kind: EVENT_TIME}],
    })[0]
    const owner = resolveCommunityEventDescriptors({
      definition,
      profileListEvents: [],
      userPubkey: communityPubkey,
      descriptors: [{kind: EVENT_TIME}],
    })[0]
    const activeManager = resolveCommunityEventDescriptors({
      definition,
      profileListEvents: [calendarProfileList],
      userPubkey: calendarWriterPubkey,
      descriptors: [{kind: EVENT_TIME}],
    })[0]

    expect(missingManager.moderatorPubkeys).toEqual([communityPubkey])
    expect(missingManager.writerPubkeys).toContain(calendarWriterPubkey)
    expect(missingManager.capability).toMatchObject({canWrite: true, canModerate: false})
    expect(owner.capability).toMatchObject({canWrite: true, canModerate: true})
    expect(activeManager.moderatorPubkeys).toEqual([communityPubkey, calendarWriterPubkey])
    expect(activeManager.capability).toMatchObject({canWrite: true, canModerate: true})
  })

  it("treats time and date calendar descriptors as one section capability family", () => {
    const resolved = resolveCommunityEventDescriptors({
      definition: dateOnlyCalendarDefinition,
      profileListEvents: [dateOnlyCalendarProfileList],
      userPubkey: calendarWriterPubkey,
      descriptors: [{kind: EVENT_TIME}, {kind: EVENT_DATE}],
    })

    expect(resolved.map(info => info.capability)).toEqual([
      {
        descriptor: {kind: EVENT_TIME},
        sectionNames: ["Calendar"],
        writableSectionNames: ["Calendar"],
        moderatorSectionNames: ["Calendar"],
        canWrite: true,
        canModerate: true,
      },
      {
        descriptor: {kind: EVENT_DATE},
        sectionNames: ["Calendar"],
        writableSectionNames: ["Calendar"],
        moderatorSectionNames: ["Calendar"],
        canWrite: true,
        canModerate: true,
      },
    ])
  })

  it("errors when no active section supports a descriptor", () => {
    expect(() =>
      resolveCommunityEventDescriptors({
        definition,
        profileListEvents: [calendarProfileList],
        userPubkey: calendarWriterPubkey,
        descriptors: [{kind: 1}],
      }),
    ).toThrow("No active community section supports event descriptor 1")
  })

  it("builds calendar queries from descriptors and authorized writers", () => {
    const authorizedTargetingEvent = makeCalendarTargetingEvent({
      id: "target-1",
      pubkey: calendarWriterPubkey,
      identifier: "event-1",
      originalPubkey: outsiderPubkey,
    })
    const unauthorizedTargetingEvent = makeCalendarTargetingEvent({
      id: "target-2",
      pubkey: outsiderPubkey,
      identifier: "event-2",
    })
    const plan = makeCommunityDescriptorQueryPlan({
      community: communityPointer,
      definition,
      profileListEvents: [calendarProfileList],
      descriptors: [{kind: EVENT_TIME}],
      targetingEvents: [authorizedTargetingEvent, unauthorizedTargetingEvent],
      limit: 5,
    })

    expect(plan.descriptors).toEqual([{kind: EVENT_TIME}])
    expect(plan.targetKinds).toEqual([EVENT_TIME])
    expect(plan.relayTargetingFilters).toEqual([
      {
        kinds: [TARGETED_PUBLICATION_KIND],
        "#h": [communityPubkey],
        "#k": [String(EVENT_TIME)],
      },
    ])
    expect(plan.localTargetingFilters).toEqual([
      {
        kinds: [TARGETED_PUBLICATION_KIND],
        "#h": [communityPubkey],
        "#k": [String(EVENT_TIME)],
        authors: [communityPubkey, calendarWriterPubkey, calendarMemberPubkey],
      },
    ])
    expect(plan.localOriginalFilters).toEqual([
      {kinds: [EVENT_TIME], authors: [outsiderPubkey], "#d": ["event-1"], limit: 5},
      {kinds: [EVENT_TIME], authors: [communityPubkey, calendarWriterPubkey], limit: 5},
    ])
    expect(plan.relayOriginalFilters).toEqual(plan.localOriginalFilters)
    expect(plan.originalRelayHints).toEqual(["wss://relay.example.com/"])
    expect(plan.originalFilters).toBe(plan.localOriginalFilters)
  })

  it("binds implicit originals to authorized wrapper signers", () => {
    const authorizedTargetingEvent = makeCalendarTargetingEvent({
      id: "target-implicit",
      pubkey: calendarWriterPubkey,
      identifier: "",
      implicit: true,
    })
    const unauthorizedTargetingEvent = makeCalendarTargetingEvent({
      id: "target-outsider",
      pubkey: outsiderPubkey,
      identifier: "",
      implicit: true,
    })
    const plan = makeCommunityDescriptorQueryPlan({
      community: communityPointer,
      definition,
      profileListEvents: [calendarProfileList],
      descriptors: [{kind: EVENT_TIME}],
      targetingEvents: [authorizedTargetingEvent, unauthorizedTargetingEvent],
      limit: 5,
    })

    expect(plan.localOriginalFilters).toEqual([
      {
        kinds: [EVENT_TIME],
        authors: [calendarWriterPubkey],
        "#h": ["target-implicit"],
        limit: 5,
      },
      {kinds: [EVENT_TIME], authors: [communityPubkey, calendarWriterPubkey], limit: 5},
    ])
    expect(plan.relayOriginalFilters).toEqual(plan.localOriginalFilters)
  })

  it("builds timed calendar queries when only date-based calendar sections are declared", () => {
    const authorizedTargetingEvent = makeCalendarTargetingEvent({
      id: "target-1",
      pubkey: calendarWriterPubkey,
      identifier: "timed-event-1",
    })
    const plan = makeCommunityDescriptorQueryPlan({
      community: communityPointer,
      definition: dateOnlyCalendarDefinition,
      profileListEvents: [dateOnlyCalendarProfileList],
      descriptors: [{kind: EVENT_TIME}, {kind: EVENT_DATE}],
      targetingEvents: [authorizedTargetingEvent],
      limit: 5,
    })

    expect(plan.descriptors).toEqual([{kind: EVENT_TIME}, {kind: EVENT_DATE}])
    expect(plan.targetKinds).toEqual([EVENT_TIME, EVENT_DATE])
    expect(plan.relayTargetingFilters).toEqual([
      {
        kinds: [TARGETED_PUBLICATION_KIND],
        "#h": [communityPubkey],
        "#k": [String(EVENT_TIME)],
      },
      {
        kinds: [TARGETED_PUBLICATION_KIND],
        "#h": [communityPubkey],
        "#k": [String(EVENT_DATE)],
      },
    ])
    expect(plan.localTargetingFilters).toEqual(
      plan.relayTargetingFilters.map(filter => ({
        ...filter,
        authors: [communityPubkey, calendarWriterPubkey, calendarMemberPubkey],
      })),
    )
    expect(plan.localOriginalFilters).toEqual([
      {kinds: [EVENT_TIME], authors: [calendarWriterPubkey], "#d": ["timed-event-1"], limit: 5},
      {kinds: [EVENT_TIME], authors: [communityPubkey, calendarWriterPubkey], limit: 5},
      {kinds: [EVENT_DATE], authors: [communityPubkey, calendarWriterPubkey], limit: 5},
    ])
    expect(plan.relayOriginalFilters).toEqual(plan.localOriginalFilters)
  })

  it("uses structural relay filters and author-qualified local filters for direct descriptors", () => {
    const directDefinition = makeDefinition([
      {
        name: "Events and meetups",
        kinds: [{kind: 1}],
        profileLists: [
          {address: `${PROFILE_LIST_KIND}:${calendarWriterPubkey}:Events and meetups`},
        ],
      },
    ])
    const plan = makeCommunityDescriptorQueryPlan({
      community: communityPointer,
      definition: directDefinition,
      profileListEvents: [calendarProfileList],
      descriptors: [{kind: 1}],
      limit: 5,
    })

    expect(plan.relayOriginalFilters).toEqual([{kinds: [1], "#h": [communityPubkey], limit: 5}])
    expect(plan.localOriginalFilters).toEqual([
      {
        kinds: [1],
        "#h": [communityPubkey],
        authors: [communityPubkey, calendarWriterPubkey, calendarMemberPubkey],
        limit: 5,
      },
    ])
  })

  it("queries and admits repository announcements only through one direct community h tag", () => {
    const repoDefinition = makeDefinition([
      {
        name: "Repositories",
        kinds: [{kind: GIT_REPO_ANNOUNCEMENT}],
        profileLists: [{address: `${PROFILE_LIST_KIND}:${calendarWriterPubkey}:Repositories`}],
      },
    ])
    const repoProfileList = makeEvent({
      kind: PROFILE_LIST_KIND,
      pubkey: calendarWriterPubkey,
      tags: [
        ["d", "Repositories"],
        ["p", calendarWriterPubkey],
      ],
    })
    const plan = makeCommunityDescriptorQueryPlan({
      community: communityPointer,
      definition: repoDefinition,
      profileListEvents: [repoProfileList],
      descriptors: [{kind: GIT_REPO_ANNOUNCEMENT}],
      limit: 5,
    })
    const direct = makeEvent({
      kind: GIT_REPO_ANNOUNCEMENT,
      pubkey: calendarWriterPubkey,
      tags: [
        ["d", "repo"],
        ["h", communityPointer.communityId],
      ],
    })
    const duplicateScope = {...direct, tags: [...direct.tags, ["h", communityPointer.communityId]]}

    expect(plan.targetKinds).toEqual([])
    expect(plan.relayTargetingFilters).toEqual([])
    expect(plan.relayOriginalFilters).toEqual([
      {kinds: [GIT_REPO_ANNOUNCEMENT], "#h": [communityPointer.communityId], limit: 5},
    ])
    expect(plan.localOriginalFilters).toEqual([
      {
        kinds: [GIT_REPO_ANNOUNCEMENT],
        "#h": [communityPointer.communityId],
        authors: [communityPubkey, calendarWriterPubkey],
        limit: 5,
      },
    ])
    expect(
      filterAuthorizedCommunityDescriptorEvents(
        [direct, duplicateScope],
        communityPointer.communityId,
        resolveCommunityEventDescriptors({
          definition: repoDefinition,
          profileListEvents: [repoProfileList],
          descriptors: [{kind: GIT_REPO_ANNOUNCEMENT}],
        }),
      ),
    ).toEqual([direct])
  })

  it("post-filters direct descriptor events by known subtypes", () => {
    const roomRoot = makeEvent({
      id: "room-root",
      kind: THREAD,
      tags: [["h", communityPubkey], ["room"]],
    })
    const threadRoot = makeEvent({
      id: "thread-root",
      kind: THREAD,
      tags: [["h", communityPubkey]],
    })

    expect(
      filterCommunityDescriptorEvents([roomRoot, threadRoot], communityPubkey, [
        {kind: THREAD, subtype: COMMUNITY_SUBTYPE_ROOM},
      ]).map(event => event.id),
    ).toEqual(["room-root"])
    expect(
      filterCommunityDescriptorEvents([roomRoot, threadRoot], communityPubkey, [
        {kind: THREAD, subtype: COMMUNITY_SUBTYPE_THREADS},
      ]).map(event => event.id),
    ).toEqual(["thread-root"])
  })

  it("authorizes same-kind direct events only through their matching descriptor", () => {
    const profileListOwner = calendarWriterPubkey
    const roomWriter = outsiderPubkey
    const threadWriter = calendarMemberPubkey
    const mixedDefinition = makeDefinition([
      {
        name: "Rooms",
        kinds: [{kind: THREAD, subtype: COMMUNITY_SUBTYPE_ROOM}],
        profileLists: [{address: `${PROFILE_LIST_KIND}:${profileListOwner}:Rooms`}],
      },
      {
        name: "Threads",
        kinds: [{kind: THREAD, subtype: COMMUNITY_SUBTYPE_THREADS}],
        profileLists: [{address: `${PROFILE_LIST_KIND}:${profileListOwner}:Threads`}],
      },
    ])
    const roomWriters = makeEvent({
      kind: PROFILE_LIST_KIND,
      pubkey: profileListOwner,
      tags: [
        ["d", "Rooms"],
        ["p", roomWriter],
      ],
    })
    const threadWriters = makeEvent({
      kind: PROFILE_LIST_KIND,
      pubkey: profileListOwner,
      tags: [
        ["d", "Threads"],
        ["p", threadWriter],
      ],
    })
    const descriptors = [
      {kind: THREAD, subtype: COMMUNITY_SUBTYPE_ROOM},
      {kind: THREAD, subtype: COMMUNITY_SUBTYPE_THREADS},
    ]
    const resolved = resolveCommunityEventDescriptors({
      definition: mixedDefinition,
      profileListEvents: [roomWriters, threadWriters],
      descriptors,
    })
    const events = [
      makeEvent({
        id: "room-by-room-writer",
        kind: THREAD,
        pubkey: roomWriter,
        tags: [["h", communityPubkey], ["room"]],
      }),
      makeEvent({
        id: "thread-by-thread-writer",
        kind: THREAD,
        pubkey: threadWriter,
        tags: [["h", communityPubkey]],
      }),
      makeEvent({
        id: "room-by-thread-writer",
        kind: THREAD,
        pubkey: threadWriter,
        tags: [["h", communityPubkey], ["room"]],
      }),
      makeEvent({
        id: "thread-by-room-writer",
        kind: THREAD,
        pubkey: roomWriter,
        tags: [["h", communityPubkey]],
      }),
    ]

    expect(
      filterAuthorizedCommunityDescriptorEvents(events, communityPubkey, resolved).map(
        event => event.id,
      ),
    ).toEqual(["room-by-room-writer", "thread-by-thread-writer"])
  })
})
