import {describe, expect, it} from "vitest"
import {PublishStatus} from "@welshman/net"
import {DELETE, REACTION, type TrustedEvent} from "@welshman/util"
import type {PublicationSnapshot} from "./publication-operations"
import {getReactionOperationSemanticKey, projectReactionOperations} from "./reaction-operations"

const owner = "a".repeat(64)
const otherAuthor = "b".repeat(64)
const targetEventId = "c".repeat(64)
const relay = "wss://relay.example/"

const makeEvent = ({
  id,
  pubkey = owner,
  kind = REACTION,
  content = "+",
  tags = [["e", targetEventId]],
}: {
  id: string
  pubkey?: string
  kind?: number
  content?: string
  tags?: string[][]
}): TrustedEvent => ({
  id,
  pubkey,
  kind,
  content,
  tags,
  created_at: 1,
  sig: "f".repeat(128),
})

const makeOperation = ({
  event,
  phase = "publishing",
  semanticKey = getReactionOperationSemanticKey(targetEventId, event),
}: {
  event: TrustedEvent
  phase?: PublicationSnapshot["phase"]
  semanticKey?: string
}): PublicationSnapshot => ({
  operationId: event.id,
  ownerPubkey: owner,
  label: "Reaction",
  semanticKey,
  event,
  phase,
  preview: "rollback-on-failure",
  attempt: 1,
  results: {
    [relay]: {relay, status: PublishStatus.Sending, detail: "sending..."},
  },
})

describe("reaction operation projection", () => {
  it("adds a publishing reaction without changing canonical input", () => {
    const canonical = [makeEvent({id: "1".repeat(64), pubkey: otherAuthor})]
    const pending = makeEvent({id: "2".repeat(64), content: "🔥"})

    const projection = projectReactionOperations({
      reactions: canonical,
      operations: [makeOperation({event: pending})],
      targetEventId,
      ownerPubkey: owner,
      relays: [relay],
    })

    expect(projection.reactions.map(event => event.id)).toEqual([canonical[0].id, pending.id])
    expect(canonical).toHaveLength(1)
    expect(projection.pendingSemanticKeys).toContain(
      getReactionOperationSemanticKey(targetEventId, pending),
    )
  })

  it("suppresses only the targeted reaction while its delete is publishing", () => {
    const ownReaction = makeEvent({id: "3".repeat(64)})
    const otherReaction = makeEvent({id: "4".repeat(64), pubkey: otherAuthor})
    const deleteEvent = makeEvent({
      id: "5".repeat(64),
      kind: DELETE,
      content: "",
      tags: [
        ["e", ownReaction.id],
        ["k", String(REACTION)],
      ],
    })

    const projection = projectReactionOperations({
      reactions: [ownReaction, otherReaction],
      operations: [
        makeOperation({
          event: deleteEvent,
          semanticKey: getReactionOperationSemanticKey(targetEventId, ownReaction),
        }),
      ],
      targetEventId,
      ownerPubkey: owner,
      relays: [relay],
    })

    expect(projection.reactions).toEqual([otherReaction])
  })

  it("rolls additions and deletions back when they become unconfirmed", () => {
    const canonical = makeEvent({id: "6".repeat(64)})
    const pendingAdd = makeEvent({id: "7".repeat(64), content: "🔥"})
    const pendingDelete = makeEvent({
      id: "8".repeat(64),
      kind: DELETE,
      content: "",
      tags: [["e", canonical.id]],
    })
    const operations = [
      makeOperation({event: pendingAdd, phase: "unconfirmed"}),
      makeOperation({
        event: pendingDelete,
        phase: "unconfirmed",
        semanticKey: getReactionOperationSemanticKey(targetEventId, canonical),
      }),
    ]

    const projection = projectReactionOperations({
      reactions: [canonical],
      operations,
      targetEventId,
      ownerPubkey: owner,
      relays: [relay],
    })

    expect(projection.reactions).toEqual([canonical])
    expect(projection.pendingSemanticKeys.size).toBe(0)
  })

  it("ignores operations outside relay scope and non-reaction semantic keys", () => {
    const wrongRelay = {
      ...makeOperation({event: makeEvent({id: "9".repeat(64)})}),
      results: {
        "wss://other.example/": {
          relay: "wss://other.example/",
          status: PublishStatus.Sending,
          detail: "sending...",
        },
      },
    }
    const collectionStar = makeOperation({
      event: makeEvent({id: "d".repeat(64)}),
      semanticKey: `repo-star:${targetEventId}`,
    })

    const projection = projectReactionOperations({
      reactions: [],
      operations: [wrongRelay, collectionStar],
      targetEventId,
      ownerPubkey: owner,
      relays: [relay],
    })

    expect(projection.reactions).toEqual([])
  })
})
