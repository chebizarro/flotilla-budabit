import {describe, expect, it} from "vitest"
import {PublishStatus} from "@welshman/net"
import {DELETE, REACTION, type TrustedEvent} from "@welshman/util"
import type {PublicationSnapshot} from "./publication-operations"
import {
  getReactionEventReference,
  getReactionOperationSemanticKey,
  projectReactionOperations,
} from "./reaction-operations"

const owner = "a".repeat(64)
const otherAuthor = "b".repeat(64)
const targetEventId = "c".repeat(64)
const relay = "wss://relay.example/"

const makeTargetEvent = ({
  id = targetEventId,
  kind = 1,
  pubkey = otherAuthor,
  tags = [],
}: {
  id?: string
  kind?: number
  pubkey?: string
  tags?: string[][]
} = {}): TrustedEvent => ({
  id,
  pubkey,
  kind,
  content: "target",
  tags,
  created_at: 1,
  sig: "e".repeat(128),
})

const targetEvent = makeTargetEvent()
const targetReference = getReactionEventReference(targetEvent)

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
  semanticKey = event.kind === REACTION
    ? getReactionOperationSemanticKey(targetReference, event)
    : undefined,
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
      targetEvent,
      ownerPubkey: owner,
      relays: [relay],
    })

    expect(projection.reactions.map(event => event.id)).toEqual([canonical[0].id, pending.id])
    expect(canonical).toHaveLength(1)
    expect(projection.pendingSemanticKeys).toContain(
      getReactionOperationSemanticKey(targetReference, pending),
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
          semanticKey: getReactionOperationSemanticKey(targetReference, ownReaction),
        }),
      ],
      targetEvent,
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
        semanticKey: getReactionOperationSemanticKey(targetReference, canonical),
      }),
    ]

    const projection = projectReactionOperations({
      reactions: [canonical],
      operations,
      targetEvent,
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
      targetEvent,
      ownerPubkey: owner,
      relays: [relay],
    })

    expect(projection.reactions).toEqual([])
  })

  it("admits optimistic reactions only from allowed reaction authors", () => {
    const pending = makeEvent({id: "e".repeat(64)})
    const operation = makeOperation({event: pending})

    const rejected = projectReactionOperations({
      reactions: [],
      operations: [operation],
      targetEvent,
      ownerPubkey: owner,
      relays: [relay],
      allowedAuthors: [otherAuthor],
    })
    const admitted = projectReactionOperations({
      reactions: [],
      operations: [operation],
      targetEvent,
      ownerPubkey: owner,
      relays: [relay],
      allowedAuthors: [owner],
    })

    expect(rejected.reactions).toEqual([])
    expect(rejected.pendingSemanticKeys.size).toBe(0)
    expect(admitted.reactions).toEqual([pending])
  })

  it("projects a pending addition across an addressable event replacement", () => {
    const addressPubkey = "d".repeat(64)
    const address = `31922:${addressPubkey}:calendar-event`
    const original = makeTargetEvent({
      id: "a".repeat(64),
      kind: 31922,
      pubkey: addressPubkey,
      tags: [["d", "calendar-event"]],
    })
    const replacement = {...original, id: "b".repeat(64), created_at: 2}
    const pending = makeEvent({
      id: "7".repeat(64),
      content: "🔥",
      tags: [
        ["e", original.id],
        ["a", address],
      ],
    })
    const semanticKey = getReactionOperationSemanticKey(
      getReactionEventReference(original),
      pending,
    )

    const projection = projectReactionOperations({
      reactions: [],
      operations: [makeOperation({event: pending, semanticKey})],
      targetEvent: replacement,
      ownerPubkey: owner,
      relays: [relay],
    })

    expect(getReactionEventReference(replacement)).toBe(getReactionEventReference(original))
    expect(projection.reactions).toEqual([pending])
    expect(projection.pendingSemanticKeys).toContain(semanticKey)
  })

  it("projects and rolls back a reaction delete across an addressable replacement", () => {
    const addressPubkey = "d".repeat(64)
    const address = `31922:${addressPubkey}:calendar-event`
    const original = makeTargetEvent({
      id: "a".repeat(64),
      kind: 31922,
      pubkey: addressPubkey,
      tags: [["d", "calendar-event"]],
    })
    const replacement = {...original, id: "b".repeat(64), created_at: 2}
    const ownReaction = makeEvent({
      id: "8".repeat(64),
      tags: [
        ["e", original.id],
        ["a", address],
      ],
    })
    const otherReaction = makeEvent({
      id: "9".repeat(64),
      pubkey: otherAuthor,
      tags: [
        ["e", original.id],
        ["a", address],
      ],
    })
    const deleteEvent = makeEvent({
      id: "f".repeat(64),
      kind: DELETE,
      content: "",
      tags: [["e", ownReaction.id]],
    })
    const semanticKey = getReactionOperationSemanticKey(
      getReactionEventReference(replacement),
      ownReaction,
    )
    const publishingDelete = makeOperation({event: deleteEvent, semanticKey})

    const publishing = projectReactionOperations({
      reactions: [ownReaction, otherReaction],
      operations: [publishingDelete],
      targetEvent: replacement,
      ownerPubkey: owner,
      relays: [relay],
    })
    const unconfirmed = projectReactionOperations({
      reactions: [ownReaction, otherReaction],
      operations: [{...publishingDelete, phase: "unconfirmed"}],
      targetEvent: replacement,
      ownerPubkey: owner,
      relays: [relay],
    })

    expect(publishing.reactions).toEqual([otherReaction])
    expect(publishing.pendingSemanticKeys).toContain(semanticKey)
    expect(unconfirmed.reactions).toEqual([ownReaction, otherReaction])
    expect(unconfirmed.pendingSemanticKeys.size).toBe(0)
  })

  it("keeps non-addressable reaction targets scoped by event id", () => {
    expect(getReactionEventReference(makeTargetEvent({id: "1".repeat(64)}))).not.toBe(
      getReactionEventReference(makeTargetEvent({id: "2".repeat(64)})),
    )
  })

  it("does not prefix-match distinct address identifiers", () => {
    const addressPubkey = "d".repeat(64)
    const target = makeTargetEvent({
      id: "1".repeat(64),
      kind: 31922,
      pubkey: addressPubkey,
      tags: [["d", "calendar-event"]],
    })
    const otherTarget = makeTargetEvent({
      id: "2".repeat(64),
      kind: 31922,
      pubkey: addressPubkey,
      tags: [["d", "calendar-event:other"]],
    })
    const pending = makeEvent({
      id: "3".repeat(64),
      tags: [
        ["e", otherTarget.id],
        ["a", `31922:${addressPubkey}:calendar-event:other`],
      ],
    })

    const projection = projectReactionOperations({
      reactions: [],
      operations: [
        makeOperation({
          event: pending,
          semanticKey: getReactionOperationSemanticKey(
            getReactionEventReference(otherTarget),
            pending,
          ),
        }),
      ],
      targetEvent: target,
      ownerPubkey: owner,
      relays: [relay],
    })

    expect(projection.reactions).toEqual([])
    expect(projection.pendingSemanticKeys.size).toBe(0)
  })
})
