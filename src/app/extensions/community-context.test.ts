import {describe, expect, it} from "vitest"
import {EVENT_DATE, EVENT_TIME, THREAD, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_SUBTYPE_ROOM,
  COMMUNITY_SUBTYPE_THREADS,
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  TARGETED_PUBLICATION_KIND,
  parseCommunityDefinition,
} from "@app/core/community"
import {
  makeAddressablePublicationRef,
  makeTargetedPublicationForCommunity,
} from "@app/core/community-targeting"
import {
  filterAuthorizedCommunityDescriptorEvents,
  filterCommunityDescriptorEvents,
  makeCommunityDescriptorQueryPlan,
  makeCommunityWidgetContext,
  resolveCommunityEventDescriptors,
} from "./community-context"

const communityPubkey = "a".repeat(64)
const calendarWriterPubkey = "b".repeat(64)
const outsiderPubkey = "c".repeat(64)
const calendarMemberPubkey = "d".repeat(64)

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

const definition = parseCommunityDefinition(
  makeEvent({
    kind: COMMUNITY_DEFINITION_KIND,
    pubkey: communityPubkey,
    tags: [
      ["content", "Events and meetups"],
      ["k", String(EVENT_TIME)],
      ["k", String(EVENT_DATE)],
      ["a", `${PROFILE_LIST_KIND}:${calendarWriterPubkey}:Events and meetups`],
    ],
  }),
)!

const dateOnlyCalendarDefinition = parseCommunityDefinition(
  makeEvent({
    kind: COMMUNITY_DEFINITION_KIND,
    pubkey: communityPubkey,
    tags: [
      ["content", "Calendar"],
      ["k", String(EVENT_DATE)],
      ["a", `${PROFILE_LIST_KIND}:${calendarWriterPubkey}:Calendar`],
    ],
  }),
)!

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
    tags: makeTargetedPublicationForCommunity({
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
      communityPubkey,
      communityRelay: "wss://relay.example.com/",
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
    expect(context).not.toHaveProperty("writeTargets")
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
        "#p": [communityPubkey],
        "#k": [String(EVENT_TIME)],
      },
    ])
    expect(plan.localTargetingFilters).toEqual([
      {
        kinds: [TARGETED_PUBLICATION_KIND],
        "#p": [communityPubkey],
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
        "#p": [communityPubkey],
        "#k": [String(EVENT_TIME)],
      },
      {
        kinds: [TARGETED_PUBLICATION_KIND],
        "#p": [communityPubkey],
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
    const directDefinition = parseCommunityDefinition(
      makeEvent({
        kind: COMMUNITY_DEFINITION_KIND,
        pubkey: communityPubkey,
        tags: [
          ["content", "Events and meetups"],
          ["k", "1"],
          ["a", `${PROFILE_LIST_KIND}:${calendarWriterPubkey}:Events and meetups`],
        ],
      }),
    )!
    const plan = makeCommunityDescriptorQueryPlan({
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
    const mixedDefinition = parseCommunityDefinition(
      makeEvent({
        kind: COMMUNITY_DEFINITION_KIND,
        pubkey: communityPubkey,
        tags: [
          ["content", "Rooms"],
          ["k", String(THREAD), COMMUNITY_SUBTYPE_ROOM],
          ["a", `${PROFILE_LIST_KIND}:${profileListOwner}:Rooms`],
          ["content", "Threads"],
          ["k", String(THREAD), COMMUNITY_SUBTYPE_THREADS],
          ["a", `${PROFILE_LIST_KIND}:${profileListOwner}:Threads`],
        ],
      }),
    )!
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
