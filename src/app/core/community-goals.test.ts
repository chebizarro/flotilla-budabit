import {describe, expect, it} from "vitest"
import {ZAP_GOAL, type TrustedEvent} from "@welshman/util"
import {makeCommunityGoalReply, readCommunityGoalReply} from "./community-goals"

const communityPubkey = "a".repeat(64)
const creatorPubkey = "b".repeat(64)
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

describe("community goal helpers", () => {
  it("builds and reads top-level goal replies", () => {
    const goal = makeEvent({id: "goal-id", kind: ZAP_GOAL, pubkey: creatorPubkey})
    const template = makeCommunityGoalReply({
      communityPubkey,
      goal,
      relay: "wss://relay.example.com/",
      content: "Comment body",
    })
    const reply = makeEvent({id: "reply-id", kind: 1111, ...template})

    expect(template.tags).toEqual([
      ["h", communityPubkey],
      ["E", "goal-id", "wss://relay.example.com/", creatorPubkey],
      ["K", String(ZAP_GOAL)],
      ["P", creatorPubkey, "wss://relay.example.com/"],
      ["e", "goal-id", "wss://relay.example.com/", creatorPubkey],
      ["k", String(ZAP_GOAL)],
      ["p", creatorPubkey, "wss://relay.example.com/"],
    ])
    expect(readCommunityGoalReply(reply, communityPubkey, "goal-id")).toMatchObject({
      id: "reply-id",
      communityPubkey,
      goalId: "goal-id",
      parentReplyId: "",
    })
  })

  it("builds replies to comments while keeping the root goal scope", () => {
    const goal = makeEvent({id: "goal-id", kind: ZAP_GOAL, pubkey: creatorPubkey})
    const template = makeCommunityGoalReply({
      communityPubkey,
      goal,
      parent: {id: "parent-reply-id", pubkey: authorPubkey, relay: "wss://relay.example.com/"},
      relay: "wss://relay.example.com/",
      content: "Nested reply body",
    })
    const reply = makeEvent({id: "reply-id", kind: 1111, ...template})

    expect(template.tags).toEqual([
      ["h", communityPubkey],
      ["E", "goal-id", "wss://relay.example.com/", creatorPubkey],
      ["K", String(ZAP_GOAL)],
      ["P", creatorPubkey, "wss://relay.example.com/"],
      ["e", "parent-reply-id", "wss://relay.example.com/", authorPubkey],
      ["k", "1111"],
      ["p", authorPubkey, "wss://relay.example.com/"],
    ])
    expect(readCommunityGoalReply(reply, communityPubkey, "goal-id")).toMatchObject({
      id: "reply-id",
      goalId: "goal-id",
      parentReplyId: "parent-reply-id",
    })
  })
})
