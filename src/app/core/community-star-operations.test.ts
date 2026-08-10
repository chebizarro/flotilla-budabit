import {describe, expect, it} from "vitest"
import {PublishStatus} from "@welshman/net"
import {DELETE, type TrustedEvent} from "@welshman/util"
import type {PublicationSnapshot} from "./publication-operations"
import {
  getCommunityStarOperationSemanticKey,
  projectCommunityStarOperation,
} from "./community-star-operations"
import {makeCommunityStarReaction, parseCommunityStarReaction} from "@app/util/community-stars"

const ownerPubkey = "a".repeat(64)
const communityPubkey = "b".repeat(64)
const relay = "wss://relay.example/"

const sign = (event: ReturnType<typeof makeCommunityStarReaction>, id: string): TrustedEvent => ({
  ...event,
  id,
  pubkey: ownerPubkey,
  sig: "f".repeat(128),
})

const makeOperation = ({
  event,
  phase = "publishing",
}: {
  event: TrustedEvent
  phase?: PublicationSnapshot["phase"]
}): PublicationSnapshot => ({
  operationId: event.id,
  ownerPubkey,
  label: "Community star",
  semanticKey: getCommunityStarOperationSemanticKey(communityPubkey),
  event,
  phase,
  preview: "rollback-on-failure",
  attempt: 1,
  results: {
    [relay]: {relay, status: PublishStatus.Sending, detail: "sending..."},
  },
})

describe("community star operation projection", () => {
  it("shows a publishing star and rolls it back when unconfirmed", () => {
    const reaction = sign(
      makeCommunityStarReaction({communityPubkey, relayHints: [relay]}),
      "1".repeat(64),
    )

    const publishing = projectCommunityStarOperation({
      operations: [makeOperation({event: reaction})],
      ownerPubkey,
      communityPubkey,
    })
    const unconfirmed = projectCommunityStarOperation({
      operations: [makeOperation({event: reaction, phase: "unconfirmed"})],
      ownerPubkey,
      communityPubkey,
    })

    expect(publishing.star?.reaction).toBe(reaction)
    expect(publishing.pending).toBe(true)
    expect(unconfirmed).toMatchObject({
      star: undefined,
      pending: false,
      retryOperationId: reaction.id,
      retryDesiredStarred: true,
      retryEventId: reaction.id,
    })
  })

  it("hides a canonical star only while its delete is publishing", () => {
    const reaction = sign(
      makeCommunityStarReaction({communityPubkey, relayHints: [relay]}),
      "2".repeat(64),
    )
    const star = parseCommunityStarReaction(reaction)
    const deleteEvent: TrustedEvent = {
      ...reaction,
      id: "3".repeat(64),
      kind: DELETE,
      content: "",
      tags: [["e", reaction.id]],
    }

    const publishing = projectCommunityStarOperation({
      star,
      operations: [makeOperation({event: deleteEvent})],
      ownerPubkey,
      communityPubkey,
    })
    const unconfirmed = projectCommunityStarOperation({
      star,
      operations: [makeOperation({event: deleteEvent, phase: "unconfirmed"})],
      ownerPubkey,
      communityPubkey,
    })

    expect(publishing).toMatchObject({star: undefined, pending: true})
    expect(unconfirmed).toMatchObject({
      star,
      pending: false,
      retryOperationId: deleteEvent.id,
      retryDesiredStarred: false,
      retryEventId: deleteEvent.id,
    })
  })

  it("ignores other owners and non-community-star semantic keys", () => {
    const reaction = sign(
      makeCommunityStarReaction({communityPubkey, relayHints: [relay]}),
      "4".repeat(64),
    )
    const operation = makeOperation({event: reaction})

    expect(
      projectCommunityStarOperation({
        operations: [{...operation, ownerPubkey: "c".repeat(64)}],
        ownerPubkey,
        communityPubkey,
      }).pending,
    ).toBe(false)
    expect(
      projectCommunityStarOperation({
        operations: [{...operation, semanticKey: `repo-star:${communityPubkey}`}],
        ownerPubkey,
        communityPubkey,
      }).pending,
    ).toBe(false)
  })
})
