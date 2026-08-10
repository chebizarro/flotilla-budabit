import {describe, expect, it} from "vitest"
import {PublishStatus} from "@welshman/net"
import type {TrustedEvent} from "@welshman/util"
import type {PublicationSnapshot} from "./publication-operations"
import {projectAuthoredPublicationEvents} from "./authored-publication-operations"

const ownerPubkey = "a".repeat(64)
const relay = "wss://relay.example/"

const makeEvent = (id: string, kind = 11): TrustedEvent => ({
  id,
  pubkey: ownerPubkey,
  created_at: 1,
  kind,
  tags: [],
  content: id,
  sig: "f".repeat(128),
})

const makeOperation = (
  event: TrustedEvent,
  phase: PublicationSnapshot["phase"] = "publishing",
): PublicationSnapshot => ({
  operationId: `operation-${event.id}`,
  ownerPubkey,
  label: "Authored content",
  event,
  phase,
  preview: "retain-on-failure",
  attempt: 1,
  results: {
    [relay]: {relay, status: PublishStatus.Sending, detail: "sending..."},
  },
})

describe("authored publication operation projection", () => {
  it("merges publishing and unconfirmed previews without duplicating canonical events", () => {
    const canonical = makeEvent("canonical")
    const pending = makeEvent("pending")
    const unconfirmed = makeEvent("unconfirmed")

    const projection = projectAuthoredPublicationEvents({
      events: [canonical],
      operations: [
        makeOperation(canonical),
        makeOperation(pending),
        makeOperation(unconfirmed, "unconfirmed"),
      ],
      ownerPubkey,
      matches: event => event.kind === 11,
    })

    expect(projection.events.map(event => event.id)).toEqual([
      canonical.id,
      pending.id,
      unconfirmed.id,
    ])
    expect(projection.operationIds.get(canonical.id)).toBe(`operation-${canonical.id}`)
    expect(projection.operationIds.get(unconfirmed.id)).toBe(`operation-${unconfirmed.id}`)
  })

  it("ignores confirmed, rollback, unmatched, and other-owner operations", () => {
    const confirmed = makeOperation(makeEvent("confirmed"), "confirmed")
    const rollback = {
      ...makeOperation(makeEvent("rollback")),
      preview: "rollback-on-failure" as const,
    }
    const unmatched = makeOperation(makeEvent("unmatched", 1))
    const otherOwner = {...makeOperation(makeEvent("other")), ownerPubkey: "b".repeat(64)}

    const projection = projectAuthoredPublicationEvents({
      events: [],
      operations: [confirmed, rollback, unmatched, otherOwner],
      ownerPubkey,
      matches: event => event.kind === 11,
    })

    expect(projection.events).toEqual([])
    expect(projection.operationIds.size).toBe(0)
  })
})
