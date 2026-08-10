import {get} from "svelte/store"
import type {Thunk} from "@welshman/app"
import type {EventTemplate, TrustedEvent} from "@welshman/util"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => ({
  activePubkey: "a".repeat(64),
  abortThunk: vi.fn(),
  publishThunk: vi.fn(),
  repositoryPublish: vi.fn(),
  retryThunk: vi.fn(),
  waitForAnyRelayAck: vi.fn(),
}))

vi.mock("@welshman/app", () => ({
  abortThunk: mocks.abortThunk,
  pubkey: {get: () => mocks.activePubkey},
  publishThunk: mocks.publishThunk,
  repository: {publish: mocks.repositoryPublish},
  retryThunk: mocks.retryThunk,
  tracker: {
    getRelays: vi.fn(() => new Set<string>()),
    hasRelay: vi.fn(() => false),
  },
  waitForAnyRelayAck: mocks.waitForAnyRelayAck,
}))

vi.mock("@app/util/nip46", () => ({
  recoverActiveNip46Receiver: vi.fn(async () => true),
}))

import {
  cancelPublication,
  clearPublicationOperations,
  discardPublication,
  isPublicationPreviewVisible,
  publicationOperations,
  retryPublication,
  startPublication,
  type PublicationSnapshot,
} from "./publication-operations"

type TestThunk = {
  pubkey: string
  event: TrustedEvent
  options: {
    event: EventTemplate
    relays: string[]
    optimistic: boolean
    presentation?: "global" | "private"
  }
  results: Record<string, {relay: string; status: string; detail?: string}>
}

const owner = "a".repeat(64)
const otherOwner = "b".repeat(64)
const relayOne = "wss://relay-one.example/"
const relayTwo = "wss://relay-two.example/"
const acknowledgement = {
  relay: relayOne,
  status: "success" as const,
  detail: "accepted",
}

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return {promise, resolve, reject}
}

const makeEvent = (marker: string): TrustedEvent =>
  ({
    id: marker.repeat(64),
    pubkey: owner,
    created_at: 1,
    kind: 1,
    tags: [],
    content: `publication-${marker}`,
    sig: marker.repeat(128),
  }) as TrustedEvent

const makeThunk = (options: {
  event: EventTemplate
  relays: string[]
  optimistic: boolean
}): TestThunk => ({
  pubkey: owner,
  event: options.event as TrustedEvent,
  options,
  results: Object.fromEntries(
    options.relays.map(relay => [relay, {relay, status: "sending", detail: "sending..."}]),
  ),
})

const makeOptions = (
  event: TrustedEvent,
  preview: "retain-on-failure" | "rollback-on-failure" | "none" = "retain-on-failure",
) => ({
  event,
  relays: [relayOne, relayTwo],
  label: "Publish event",
  preview,
})

const getOperation = (operationId: string) => get(publicationOperations).get(operationId)

describe("single-event publication operations", () => {
  beforeEach(() => {
    mocks.activePubkey = owner
    mocks.abortThunk.mockReset()
    mocks.publishThunk.mockReset()
    mocks.repositoryPublish.mockReset().mockReturnValue(true)
    mocks.retryThunk.mockReset()
    mocks.waitForAnyRelayAck.mockReset()

    mocks.publishThunk.mockImplementation(options => makeThunk(options))
    mocks.retryThunk.mockImplementation((thunk: TestThunk) =>
      makeThunk({
        ...thunk.options,
        event: thunk.event,
        optimistic: false,
      }),
    )
  })

  afterEach(() => {
    clearPublicationOperations()
  })

  it("keeps the event outside repository until a qualifying relay ACKs", async () => {
    const ack = deferred<typeof acknowledgement>()
    mocks.waitForAnyRelayAck.mockReturnValue(ack.promise)
    const event = makeEvent("c")

    const operation = startPublication(makeOptions(event))

    expect(mocks.publishThunk).toHaveBeenCalledWith({
      event,
      relays: [relayOne, relayTwo],
      optimistic: false,
      presentation: "private",
    })
    await vi.waitFor(() => expect(mocks.waitForAnyRelayAck).toHaveBeenCalledOnce())
    expect(mocks.repositoryPublish).not.toHaveBeenCalled()
    expect(getOperation(operation.operationId)).toMatchObject({
      operationId: operation.operationId,
      ownerPubkey: owner,
      event,
      phase: "publishing",
      preview: "retain-on-failure",
      attempt: 1,
    })

    ack.resolve(acknowledgement)
    await operation.settled

    expect(mocks.repositoryPublish).toHaveBeenCalledOnce()
    expect(mocks.repositoryPublish).toHaveBeenCalledWith(event)
    expect(getOperation(operation.operationId)?.phase).toBe("confirmed")
  })

  it("uses explicit confirmation relays without widening transport destinations", async () => {
    mocks.waitForAnyRelayAck.mockResolvedValue({...acknowledgement, relay: relayTwo})
    const event = makeEvent("d")

    const operation = startPublication({
      ...makeOptions(event),
      confirmRelays: [relayTwo],
    })
    await operation.settled

    const thunk = mocks.publishThunk.mock.results[0]?.value
    expect(mocks.publishThunk).toHaveBeenCalledWith({
      event,
      relays: [relayOne, relayTwo],
      optimistic: false,
      presentation: "private",
    })
    expect(mocks.waitForAnyRelayAck).toHaveBeenCalledWith(thunk, [relayTwo])
    expect(mocks.repositoryPublish).toHaveBeenCalledWith(event)
  })

  it("preserves a delayed publication without changing confirmation relays", async () => {
    mocks.waitForAnyRelayAck.mockResolvedValue(acknowledgement)
    const event = makeEvent("7")

    const operation = startPublication({...makeOptions(event), delay: 750})
    await operation.settled

    expect(mocks.publishThunk).toHaveBeenCalledWith({
      event,
      relays: [relayOne, relayTwo],
      optimistic: false,
      presentation: "private",
      delay: 750,
    })
    expect(mocks.waitForAnyRelayAck).toHaveBeenCalledWith(
      mocks.publishThunk.mock.results[0]?.value,
      [relayOne, relayTwo],
    )
  })

  it("rejects an empty confirmation set before starting publication", () => {
    expect(() =>
      startPublication({
        ...makeOptions(makeEvent("5")),
        confirmRelays: [],
      }),
    ).toThrow("Publication requires at least one confirmation relay")

    expect(mocks.publishThunk).not.toHaveBeenCalled()
    expect(mocks.repositoryPublish).not.toHaveBeenCalled()
  })

  it("retains an unconfirmed operation without committing it", async () => {
    mocks.waitForAnyRelayAck.mockRejectedValue(new Error("No relay confirmed publication"))
    const event = makeEvent("e")

    const operation = startPublication(makeOptions(event))
    await operation.settled

    expect(mocks.repositoryPublish).not.toHaveBeenCalled()
    expect(getOperation(operation.operationId)).toMatchObject({
      event,
      phase: "unconfirmed",
      preview: "retain-on-failure",
      error: "No relay confirmed publication",
    })
  })

  it("retries the exact event in the same logical operation and commits after confirmation", async () => {
    mocks.waitForAnyRelayAck
      .mockRejectedValueOnce(new Error("relay rejected event"))
      .mockResolvedValueOnce(acknowledgement)
    const event = makeEvent("f")

    const operation = startPublication(makeOptions(event))
    await operation.settled
    const firstThunk = mocks.publishThunk.mock.results[0]?.value as TestThunk

    const retried = await retryPublication(operation.operationId)

    expect(mocks.retryThunk).toHaveBeenCalledOnce()
    expect(mocks.retryThunk).toHaveBeenCalledWith(firstThunk)
    const retryThunk = mocks.retryThunk.mock.results[0]?.value as TestThunk
    expect(retryThunk).not.toBe(firstThunk)
    expect(retryThunk.event).toBe(firstThunk.event)
    expect(retryThunk.options.presentation).toBe("private")
    expect(mocks.waitForAnyRelayAck).toHaveBeenNthCalledWith(2, retryThunk, [relayOne, relayTwo])
    expect(retried).toMatchObject({
      operationId: operation.operationId,
      attempt: 2,
      phase: "confirmed",
    })
    expect(mocks.repositoryPublish).toHaveBeenCalledOnce()
    expect(mocks.repositoryPublish).toHaveBeenCalledWith(event)
  })

  it("retries signing for the same prepared event after a signing failure", async () => {
    const preparedEvent = {...makeEvent("6"), sig: undefined} as TrustedEvent
    const signedEvent = {...preparedEvent, sig: "6".repeat(128)} as TrustedEvent
    const retryThunk = makeThunk({
      event: preparedEvent,
      relays: [relayOne, relayTwo],
      optimistic: false,
    })
    retryThunk.event = signedEvent
    mocks.retryThunk.mockReturnValueOnce(retryThunk)
    mocks.waitForAnyRelayAck
      .mockRejectedValueOnce(new Error("signing failed"))
      .mockResolvedValueOnce(acknowledgement)

    const operation = startPublication(makeOptions(preparedEvent))
    await operation.settled
    expect(mocks.repositoryPublish).not.toHaveBeenCalled()

    await retryPublication(operation.operationId)

    const firstThunk = mocks.publishThunk.mock.results[0]?.value as TestThunk
    expect(mocks.retryThunk).toHaveBeenCalledWith(firstThunk)
    expect(firstThunk.event).toBe(preparedEvent)
    expect(mocks.repositoryPublish).toHaveBeenCalledOnce()
    expect(mocks.repositoryPublish).toHaveBeenCalledWith(signedEvent)
  })

  it("blocks retry when the active account no longer owns the operation", async () => {
    mocks.waitForAnyRelayAck.mockRejectedValue(new Error("relay rejected event"))
    const operation = startPublication(makeOptions(makeEvent("1")))
    await operation.settled
    mocks.activePubkey = otherOwner

    await expect(retryPublication(operation.operationId)).rejects.toThrow(
      "Restore the account that created this publication",
    )

    expect(mocks.retryThunk).not.toHaveBeenCalled()
    expect(getOperation(operation.operationId)?.phase).toBe("unconfirmed")
  })

  it("validates freshness before retrying an unconfirmed operation", async () => {
    const validateRetry = vi.fn(() => {
      throw new Error("A newer version of this publication already exists")
    })
    mocks.waitForAnyRelayAck.mockRejectedValue(new Error("relay rejected event"))
    const operation = startPublication({...makeOptions(makeEvent("8")), validateRetry})
    await operation.settled

    await expect(retryPublication(operation.operationId)).rejects.toThrow(
      "A newer version of this publication already exists",
    )

    expect(validateRetry).toHaveBeenCalledWith(makeEvent("8"))
    expect(mocks.retryThunk).not.toHaveBeenCalled()
    expect(getOperation(operation.operationId)?.phase).toBe("unconfirmed")
  })

  it("discards an unconfirmed operation without changing repository state", async () => {
    mocks.waitForAnyRelayAck.mockRejectedValue(new Error("relay rejected event"))
    const operation = startPublication(makeOptions(makeEvent("2")))
    await operation.settled

    discardPublication(operation.operationId)

    expect(getOperation(operation.operationId)).toBeUndefined()
    expect(mocks.repositoryPublish).not.toHaveBeenCalled()
  })

  it("cancels in-flight work without committing its preview", async () => {
    const ack = deferred<typeof acknowledgement>()
    mocks.waitForAnyRelayAck.mockReturnValue(ack.promise)
    const operation = startPublication(makeOptions(makeEvent("3")))
    const thunk = mocks.publishThunk.mock.results[0]?.value as unknown as Thunk

    cancelPublication(operation.operationId)

    expect(mocks.abortThunk).toHaveBeenCalledWith(thunk)
    expect(getOperation(operation.operationId)).toBeUndefined()
    expect(mocks.repositoryPublish).not.toHaveBeenCalled()
  })

  it("keeps presentation policy separate from publication and repository state", () => {
    const base = {
      operationId: "operation",
      ownerPubkey: owner,
      label: "Publish event",
      event: makeEvent("4"),
      attempt: 1,
      results: {},
    } satisfies Omit<PublicationSnapshot, "phase" | "preview">

    expect(
      isPublicationPreviewVisible({
        ...base,
        phase: "publishing",
        preview: "retain-on-failure",
      }),
    ).toBe(true)
    expect(
      isPublicationPreviewVisible({
        ...base,
        phase: "unconfirmed",
        preview: "retain-on-failure",
      }),
    ).toBe(true)
    expect(
      isPublicationPreviewVisible({
        ...base,
        phase: "publishing",
        preview: "rollback-on-failure",
      }),
    ).toBe(true)
    expect(
      isPublicationPreviewVisible({
        ...base,
        phase: "unconfirmed",
        preview: "rollback-on-failure",
      }),
    ).toBe(false)
    expect(
      isPublicationPreviewVisible({
        ...base,
        phase: "publishing",
        preview: "none",
      }),
    ).toBe(false)
    expect(
      isPublicationPreviewVisible({
        ...base,
        phase: "confirmed",
        preview: "retain-on-failure",
      }),
    ).toBe(false)
  })
})
