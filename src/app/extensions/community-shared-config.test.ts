import {describe, expect, it} from "vitest"
import {isAuthorizedCommunitySharedConfigEvent} from "./community-shared-config"

describe("community shared config authority", () => {
  it("does not union moderators across unrelated descriptor tags", () => {
    const calendarModerator = "a".repeat(64)
    const roomModerator = "b".repeat(64)

    expect(
      isAuthorizedCommunitySharedConfigEvent({
        event: {pubkey: roomModerator, tags: [["descriptor", "31923"]]},
        descriptorAuthorities: [
          {descriptor: {kind: 31923}, moderatorPubkeys: [calendarModerator]},
          {descriptor: {kind: 11, subtype: "room"}, moderatorPubkeys: [roomModerator]},
        ],
      }),
    ).toBe(false)
  })

  it("requires exact requested descriptors and rejects descriptor-less events", () => {
    const moderator = "a".repeat(64)
    const authorities = [
      {descriptor: {kind: 31923}, moderatorPubkeys: [moderator]},
      {descriptor: {kind: 11, subtype: "room"}, moderatorPubkeys: [moderator]},
    ]

    expect(
      isAuthorizedCommunitySharedConfigEvent({
        event: {pubkey: moderator, tags: [["descriptor", "31923"]]},
        descriptorAuthorities: authorities,
        requireExactDescriptors: true,
      }),
    ).toBe(false)
    expect(
      isAuthorizedCommunitySharedConfigEvent({
        event: {pubkey: moderator, tags: []},
        descriptorAuthorities: authorities,
        requireExactDescriptors: true,
      }),
    ).toBe(false)
    expect(
      isAuthorizedCommunitySharedConfigEvent({
        event: {pubkey: "b".repeat(64), tags: []},
        descriptorAuthorities: authorities,
        requireExactDescriptors: true,
      }),
    ).toBe(false)
  })

  it("accepts an exact multi-descriptor event from any relevant moderator", () => {
    const calendarModerator = "a".repeat(64)
    const roomModerator = "b".repeat(64)

    expect(
      isAuthorizedCommunitySharedConfigEvent({
        event: {
          pubkey: calendarModerator,
          tags: [
            ["descriptor", "31923"],
            ["descriptor", "11", "room"],
          ],
        },
        descriptorAuthorities: [
          {descriptor: {kind: 31923}, moderatorPubkeys: [calendarModerator]},
          {descriptor: {kind: 11, subtype: "room"}, moderatorPubkeys: [roomModerator]},
        ],
        requireExactDescriptors: true,
      }),
    ).toBe(true)
  })
})
