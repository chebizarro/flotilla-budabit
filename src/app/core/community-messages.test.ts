import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {
  getCommunityRoomMessageParentId,
  makeCommunityRoomMessage,
  readCommunityRoomMessage,
  readCommunityRoomMessages,
} from "./community-messages"

const communityPubkey = "a".repeat(64)
const creatorPubkey = "b".repeat(64)
const authorPubkey = "c".repeat(64)
const parentPubkey = "d".repeat(64)

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

describe("community room message helpers", () => {
  it("builds room messages with community and room-root tags", () => {
    expect(
      makeCommunityRoomMessage({
        communityPubkey,
        room: {id: "room-root", creatorPubkey},
        relay: "wss://relay.example.com/",
        content: "GM",
      }),
    ).toEqual({
      content: "GM",
      tags: [
        ["h", communityPubkey],
        ["E", "room-root", "wss://relay.example.com/", creatorPubkey],
        ["K", "11"],
        ["e", "room-root", "wss://relay.example.com/", creatorPubkey],
        ["k", "11"],
        ["p", creatorPubkey, "wss://relay.example.com/"],
      ],
    })
  })

  it("builds room replies with explicit parent and compatible q tags", () => {
    expect(
      makeCommunityRoomMessage({
        communityPubkey,
        room: {id: "room-root", creatorPubkey},
        relay: "wss://relay.example.com/",
        content: "nostr:nevent1...\nyes",
        parent: {id: "parent-message", relay: "wss://relay.example.com/", pubkey: parentPubkey},
      }),
    ).toEqual({
      content: "nostr:nevent1...\nyes",
      tags: [
        ["h", communityPubkey],
        ["E", "room-root", "wss://relay.example.com/", creatorPubkey],
        ["K", "11"],
        ["e", "parent-message", "wss://relay.example.com/", parentPubkey],
        ["k", "9"],
        ["p", parentPubkey, "wss://relay.example.com/"],
        ["q", "parent-message", "wss://relay.example.com/", parentPubkey],
      ],
    })
  })

  it("prefers explicit parent metadata over citation q tags", () => {
    const message = makeEvent({
      id: "message-id",
      kind: 9,
      tags: [
        ["h", communityPubkey],
        ["E", "room-root", "wss://relay.example.com/", creatorPubkey],
        ["K", "11"],
        ["e", "parent-message", "wss://relay.example.com/", parentPubkey],
        ["k", "9"],
        ["p", parentPubkey, "wss://relay.example.com/"],
        ["q", "shared-message", "wss://relay.example.com/", authorPubkey],
      ],
    })
    const otherRoom = makeEvent({
      id: "other-room-message",
      kind: 9,
      tags: [
        ["h", communityPubkey],
        ["E", "other-room", "wss://relay.example.com/", creatorPubkey],
        ["K", "11"],
      ],
    })

    expect(getCommunityRoomMessageParentId(message)).toBe("parent-message")
    expect(readCommunityRoomMessage(message, communityPubkey, "room-root")).toMatchObject({
      id: "message-id",
      communityPubkey,
      roomRootId: "room-root",
      parentMessageId: "parent-message",
    })
    expect(readCommunityRoomMessage(message, communityPubkey, "other-room")).toBeUndefined()
    expect(
      readCommunityRoomMessages([message, otherRoom], communityPubkey, "room-root").map(m => m.id),
    ).toEqual(["message-id"])
  })

  it("does not treat a citation-only q tag on a new top-level message as its parent", () => {
    const message = makeEvent({
      kind: 9,
      tags: [
        ["h", communityPubkey],
        ["E", "room-root", "wss://relay.example.com/", creatorPubkey],
        ["K", "11"],
        ["e", "room-root", "wss://relay.example.com/", creatorPubkey],
        ["k", "11"],
        ["p", creatorPubkey, "wss://relay.example.com/"],
        ["q", "shared-message", "wss://relay.example.com/", authorPubkey],
      ],
    })

    expect(getCommunityRoomMessageParentId(message)).toBe("")
  })

  it("falls back to q tags for legacy room replies", () => {
    const message = makeEvent({
      kind: 9,
      tags: [
        ["h", communityPubkey],
        ["E", "room-root", "wss://relay.example.com/", creatorPubkey],
        ["K", "11"],
        ["q", "legacy-parent", "wss://relay.example.com/", parentPubkey],
      ],
    })

    expect(getCommunityRoomMessageParentId(message)).toBe("legacy-parent")
  })
})
