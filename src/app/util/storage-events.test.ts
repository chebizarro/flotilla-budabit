import {describe, expect, it} from "vitest"
import {EVENT_TIME, MESSAGE, THREAD, ZAP_GOAL} from "@welshman/util"
import {DM_KIND} from "@app/core/state"
import {COMMUNITY_REPORT_KIND} from "@app/core/community-reports"
import {COMMUNITY_DEFINITION_KIND} from "@app/core/community-protocol"
import {
  isPersistedCommunityDefinitionEvent,
  isPersistedCommunityReportDeleteEvent,
  isPersistedGitDeleteEvent,
  isPersistedMobileContentEvent,
} from "./storage-events"

const communityId = "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f"

const makeEvent = (kind: number) =>
  ({
    id: `event-${kind}`,
    pubkey: "a".repeat(64),
    sig: "b".repeat(128),
    kind,
    created_at: 1,
    content: "",
    tags: [],
  }) as any

describe("storage git delete persistence", () => {
  it("persists repo-scoped git delete events", () => {
    expect(
      isPersistedGitDeleteEvent({
        id: "delete-1",
        pubkey: "a".repeat(64),
        sig: "b".repeat(128),
        kind: 5,
        created_at: 1,
        content: "",
        tags: [
          ["k", "1618"],
          ["e", "target-1"],
          ["repo", "30617:alice:repo"],
        ],
      } as any),
    ).toBe(true)
  })

  it("does not persist non-repo delete events", () => {
    expect(
      isPersistedGitDeleteEvent({
        id: "delete-2",
        pubkey: "a".repeat(64),
        sig: "b".repeat(128),
        kind: 5,
        created_at: 1,
        content: "",
        tags: [
          ["k", "1"],
          ["e", "target-2"],
        ],
      } as any),
    ).toBe(false)
  })

  it("does not persist delete events without a git target kind", () => {
    expect(
      isPersistedGitDeleteEvent({
        id: "delete-3",
        pubkey: "a".repeat(64),
        sig: "b".repeat(128),
        kind: 5,
        created_at: 1,
        content: "",
        tags: [
          ["k", "1"],
          ["e", "target-3"],
          ["repo", "30617:alice:repo"],
        ],
      } as any),
    ).toBe(false)
  })
})

describe("storage community report delete persistence", () => {
  it("persists community report delete events", () => {
    expect(
      isPersistedCommunityReportDeleteEvent({
        id: "delete-report-1",
        pubkey: "a".repeat(64),
        sig: "b".repeat(128),
        kind: 5,
        created_at: 1,
        content: "",
        tags: [
          ["k", String(COMMUNITY_REPORT_KIND)],
          ["e", "report-1"],
        ],
      } as any),
    ).toBe(true)
  })

  it("does not persist report delete events without a target", () => {
    expect(
      isPersistedCommunityReportDeleteEvent({
        id: "delete-report-2",
        pubkey: "a".repeat(64),
        sig: "b".repeat(128),
        kind: 5,
        created_at: 1,
        content: "",
        tags: [["k", String(COMMUNITY_REPORT_KIND)]],
      } as any),
    ).toBe(false)
  })

  it("does not persist unrelated delete events", () => {
    expect(
      isPersistedCommunityReportDeleteEvent({
        id: "delete-report-3",
        pubkey: "a".repeat(64),
        sig: "b".repeat(128),
        kind: 5,
        created_at: 1,
        content: "",
        tags: [
          ["k", "1"],
          ["e", "report-3"],
        ],
      } as any),
    ).toBe(false)
  })
})

describe("storage community definition persistence", () => {
  it("persists kind 32222 definitions at their exact d coordinate", () => {
    const event = makeEvent(COMMUNITY_DEFINITION_KIND)
    event.tags = [["d", communityId]]

    expect(isPersistedCommunityDefinitionEvent(event)).toBe(true)
  })

  it("does not persist legacy kind 10222 community definitions", () => {
    const event = makeEvent(10222)
    event.tags = [["d", communityId]]

    expect(isPersistedCommunityDefinitionEvent(event)).toBe(false)
  })

  it("does not persist kind 32222 events without one exact community-id d tag", () => {
    const missing = makeEvent(COMMUNITY_DEFINITION_KIND)
    const duplicate = makeEvent(COMMUNITY_DEFINITION_KIND)
    duplicate.tags = [
      ["d", communityId],
      ["d", communityId],
    ]
    const extended = makeEvent(COMMUNITY_DEFINITION_KIND)
    extended.tags = [["d", communityId, "extra"]]
    const invalid = makeEvent(COMMUNITY_DEFINITION_KIND)
    invalid.tags = [["d", "not-a-community-id"]]

    expect(isPersistedCommunityDefinitionEvent(missing)).toBe(false)
    expect(isPersistedCommunityDefinitionEvent(duplicate)).toBe(false)
    expect(isPersistedCommunityDefinitionEvent(extended)).toBe(false)
    expect(isPersistedCommunityDefinitionEvent(invalid)).toBe(false)
  })
})

describe("storage mobile content persistence", () => {
  it("persists non-message content kinds on mobile", () => {
    expect(isPersistedMobileContentEvent(makeEvent(EVENT_TIME))).toBe(true)
    expect(isPersistedMobileContentEvent(makeEvent(THREAD))).toBe(true)
    expect(isPersistedMobileContentEvent(makeEvent(ZAP_GOAL))).toBe(true)
  })

  it("does not persist message-heavy content kinds on mobile", () => {
    expect(isPersistedMobileContentEvent(makeEvent(MESSAGE))).toBe(false)
    expect(isPersistedMobileContentEvent(makeEvent(DM_KIND))).toBe(false)
  })
})
