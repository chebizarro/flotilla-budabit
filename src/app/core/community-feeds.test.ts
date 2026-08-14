import {describe, expect, it} from "vitest"
import * as nip19 from "nostr-tools/nip19"
import {
  DELETE,
  EVENT_DATE,
  EVENT_TIME,
  REACTION,
  REPORT,
  matchFilters,
  type TrustedEvent,
} from "@welshman/util"
import {TARGETED_PUBLICATION_KIND, buildTargetedPublication} from "./community"
import {
  eventTargetsCommunity,
  filterRoomRoots,
  filterThreadRoots,
  getRoomRootIdForMessage,
  isRoomMessage,
  makeCommunityContentFilterPlan,
  makeCommunityExclusiveFilter,
  makeCommunityRepositoryFilter,
  makeCommunityRoomMessagesFilter,
  makeCommunityScopedFilterPlan,
  makeCommunityThreadRepliesFilter,
  makeCommunityTargetingFilter,
  makeTargetedPublicationOriginalFilters,
  makeTargetedPublicationOriginalFilterPlan,
} from "./community-feeds"

const communityPubkey = "a".repeat(64)
const otherCommunityPubkey = "b".repeat(64)
const authorPubkey = "c".repeat(64)

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: authorPubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

describe("community feed helpers", () => {
  it("builds exclusive community filters", () => {
    expect(makeCommunityExclusiveFilter(communityPubkey, [9], {since: 10})).toEqual({
      kinds: [9],
      "#h": [communityPubkey],
      since: 10,
    })
  })

  it("separates structural relay filters from current-writer admission", () => {
    const writers = Array.from({length: 1001}, (_, index) => index.toString(16).padStart(64, "0"))
    const structuralFilter = makeCommunityRepositoryFilter(communityPubkey, {limit: 100})

    expect(makeCommunityContentFilterPlan([structuralFilter], writers)).toEqual({
      relayFilters: [{kinds: [30617], "#h": [communityPubkey], limit: 100}],
      localFilters: [{kinds: [30617], "#h": [communityPubkey], limit: 100, authors: writers}],
    })
    expect(makeCommunityContentFilterPlan([structuralFilter], [])).toEqual({
      relayFilters: [],
      localFilters: [],
    })
  })

  it("keeps scoped engagement transport broad and rejects outsider results", () => {
    const writers = Array.from({length: 1001}, (_, index) => index.toString(16).padStart(64, "0"))
    const writer = writers[1000]
    const structuralFilters = [{kinds: [REPORT, REACTION], "#e": ["root-id"]}]
    const plan = makeCommunityScopedFilterPlan(structuralFilters, communityPubkey, writers)

    expect(plan.relayFilters).toEqual([
      {kinds: [REPORT, REACTION], "#e": ["root-id"], "#h": [communityPubkey]},
    ])
    expect(plan.localFilters[0].authors).toHaveLength(1001)

    const allowedReaction = makeEvent({
      kind: REACTION,
      pubkey: writer,
      tags: [
        ["e", "root-id"],
        ["h", communityPubkey],
      ],
    })
    const allowedReport = makeEvent({
      kind: REPORT,
      pubkey: writer,
      tags: [
        ["e", "root-id"],
        ["h", communityPubkey],
      ],
    })
    const outsiderReaction = makeEvent({...allowedReaction, id: "outsider", pubkey: authorPubkey})
    const wrongScopeReport = makeEvent({
      ...allowedReport,
      id: "wrong-scope",
      tags: [
        ["e", "root-id"],
        ["h", otherCommunityPubkey],
      ],
    })

    expect(matchFilters(plan.localFilters, allowedReaction)).toBe(true)
    expect(matchFilters(plan.localFilters, allowedReport)).toBe(true)
    expect(matchFilters(plan.localFilters, outsiderReaction)).toBe(false)
    expect(matchFilters(plan.localFilters, wrongScopeReport)).toBe(false)

    const deletePlan = makeCommunityScopedFilterPlan(
      [{kinds: [DELETE], "#e": [allowedReaction.id]}],
      communityPubkey,
      writers,
    )
    const outsiderDelete = makeEvent({
      kind: DELETE,
      pubkey: authorPubkey,
      tags: [
        ["e", allowedReaction.id],
        ["h", communityPubkey],
      ],
    })

    expect(deletePlan.relayFilters[0]).not.toHaveProperty("authors")
    expect(matchFilters(deletePlan.localFilters, outsiderDelete)).toBe(false)
  })

  it("retains allowed authors in generic non-community relay filters", () => {
    const filters = [{kinds: [REACTION], "#e": ["root-id"]}]
    const authors = [authorPubkey]

    expect(makeCommunityScopedFilterPlan(filters, "", authors)).toEqual({
      relayFilters: [{...filters[0], authors}],
      localFilters: [{...filters[0], authors}],
    })
  })

  it("builds room message filters", () => {
    expect(makeCommunityRoomMessagesFilter(communityPubkey, "room-root", {limit: 50})).toEqual({
      kinds: [9],
      "#h": [communityPubkey],
      "#E": ["room-root"],
      limit: 50,
    })
  })

  it("builds thread reply filters", () => {
    expect(
      makeCommunityThreadRepliesFilter(communityPubkey, {"#E": ["thread-root"], limit: 50}),
    ).toEqual({
      kinds: [1111],
      "#h": [communityPubkey],
      "#K": ["11"],
      "#E": ["thread-root"],
      limit: 50,
    })
  })

  it("builds targeted publication filters", () => {
    expect(
      makeCommunityTargetingFilter(communityPubkey, [EVENT_DATE, EVENT_TIME, 9041], {limit: 100}),
    ).toEqual({
      kinds: [TARGETED_PUBLICATION_KIND],
      "#p": [communityPubkey],
      "#k": [String(EVENT_DATE), String(EVENT_TIME), "9041"],
      limit: 100,
    })
  })

  it("separates room roots from thread roots", () => {
    const room = makeEvent({
      id: "room",
      kind: 11,
      tags: [["h", communityPubkey], ["room"], ["title", "General"]],
    })
    const thread = makeEvent({
      id: "thread",
      kind: 11,
      tags: [
        ["h", communityPubkey],
        ["title", "Thread topic"],
      ],
    })
    const other = makeEvent({id: "other", kind: 11, tags: [["h", otherCommunityPubkey], ["room"]]})

    expect(filterRoomRoots([room, thread, other], communityPubkey).map(event => event.id)).toEqual([
      "room",
    ])
    expect(
      filterThreadRoots([room, thread, other], communityPubkey).map(event => event.id),
    ).toEqual(["thread"])
  })

  it("identifies room messages by community and room root", () => {
    const message = makeEvent({
      kind: 9,
      tags: [
        ["h", communityPubkey],
        ["E", "room-root", "wss://relay.example.com", authorPubkey],
        ["K", "11"],
      ],
    })

    expect(getRoomRootIdForMessage(message)).toBe("room-root")
    expect(isRoomMessage(message, communityPubkey, "room-root")).toBe(true)
    expect(isRoomMessage(message, communityPubkey, "other-room")).toBe(false)
  })

  it("accepts legacy lowercase room-root tags on room messages", () => {
    const message = makeEvent({
      kind: 9,
      tags: [
        ["h", communityPubkey],
        ["e", "room-root", "wss://relay.example.com", authorPubkey],
        ["K", "11"],
      ],
    })

    expect(getRoomRootIdForMessage(message)).toBe("room-root")
    expect(isRoomMessage(message, communityPubkey, "room-root")).toBe(true)
  })

  it("accepts encoded community tags on room messages", () => {
    const message = makeEvent({
      kind: 9,
      tags: [
        ["h", nip19.npubEncode(communityPubkey)],
        ["E", "room-root", "wss://relay.example.com", authorPubkey],
        ["K", "11"],
      ],
    })

    expect(eventTargetsCommunity(message, communityPubkey)).toBe(true)
    expect(isRoomMessage(message, communityPubkey, "room-root")).toBe(true)
  })

  it("builds original publication filters from targeting events", () => {
    const calendarTarget = makeEvent({
      kind: TARGETED_PUBLICATION_KIND,
      tags: buildTargetedPublication({
        id: "target-calendar",
        kind: EVENT_TIME,
        ref: {type: "a", value: `${EVENT_TIME}:${authorPubkey}:calendar-1`},
        communities: [{pubkey: communityPubkey}],
      }).tags,
    })
    const allDayCalendarTarget = makeEvent({
      kind: TARGETED_PUBLICATION_KIND,
      tags: buildTargetedPublication({
        id: "target-all-day-calendar",
        kind: EVENT_DATE,
        ref: {type: "a", value: `${EVENT_DATE}:${authorPubkey}:all-day-calendar-1`},
        communities: [{pubkey: communityPubkey}],
      }).tags,
    })
    const permalinkTarget = makeEvent({
      kind: TARGETED_PUBLICATION_KIND,
      tags: buildTargetedPublication({
        id: "target-permalink",
        kind: 1623,
        ref: {type: "e", value: "permalink-event-id"},
        communities: [{pubkey: communityPubkey}],
      }).tags,
    })
    const goalTarget = makeEvent({
      kind: TARGETED_PUBLICATION_KIND,
      tags: buildTargetedPublication({
        id: "target-goal",
        kind: 9041,
        communities: [{pubkey: communityPubkey}],
      }).tags,
    })

    expect(
      makeTargetedPublicationOriginalFilters([
        allDayCalendarTarget,
        calendarTarget,
        permalinkTarget,
        goalTarget,
      ]),
    ).toEqual([
      {kinds: [EVENT_DATE], authors: [authorPubkey], "#d": ["all-day-calendar-1"], limit: 1},
      {kinds: [EVENT_TIME], authors: [authorPubkey], "#d": ["calendar-1"], limit: 1},
      {kinds: [1623], ids: ["permalink-event-id"], limit: 1},
      {kinds: [9041], "#h": ["target-goal"], limit: 1},
    ])
    expect(
      makeTargetedPublicationOriginalFilters(
        [allDayCalendarTarget, calendarTarget, permalinkTarget, goalTarget],
        [authorPubkey],
      ),
    ).toEqual([
      {kinds: [EVENT_DATE], authors: [authorPubkey], "#d": ["all-day-calendar-1"], limit: 1},
      {kinds: [EVENT_TIME], authors: [authorPubkey], "#d": ["calendar-1"], limit: 1},
      {kinds: [1623], ids: ["permalink-event-id"], authors: [authorPubkey], limit: 1},
      {kinds: [9041], "#h": ["target-goal"], authors: [authorPubkey], limit: 1},
    ])

    expect(
      makeTargetedPublicationOriginalFilterPlan([
        allDayCalendarTarget,
        permalinkTarget,
        goalTarget,
      ]),
    ).toEqual({
      relayFilters: [
        {kinds: [EVENT_DATE], authors: [authorPubkey], "#d": ["all-day-calendar-1"], limit: 1},
        {kinds: [1623], ids: ["permalink-event-id"], limit: 1},
        {kinds: [9041], authors: [authorPubkey], "#h": ["target-goal"], limit: 1},
      ],
      localFilters: [
        {kinds: [EVENT_DATE], authors: [authorPubkey], "#d": ["all-day-calendar-1"], limit: 1},
        {kinds: [1623], ids: ["permalink-event-id"], limit: 1},
        {kinds: [9041], authors: [authorPubkey], "#h": ["target-goal"], limit: 1},
      ],
    })
  })

  it("rejects targeted address references whose coordinate kind contradicts the wrapper", () => {
    const mismatchedTarget = makeEvent({
      kind: TARGETED_PUBLICATION_KIND,
      tags: buildTargetedPublication({
        id: "mismatched-target",
        kind: EVENT_TIME,
        ref: {type: "a", value: `${EVENT_DATE}:${authorPubkey}:calendar-1`},
        communities: [{pubkey: communityPubkey}],
      }).tags,
    })

    expect(makeTargetedPublicationOriginalFilterPlan([mismatchedTarget])).toEqual({
      relayFilters: [],
      localFilters: [],
    })
  })
})
