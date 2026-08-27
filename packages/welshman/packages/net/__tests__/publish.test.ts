import {describe, expect, it, vi, beforeEach, afterEach} from "vitest"
import {publishOne, publish, PublishStatus} from "../src/publish"
import {MockAdapter} from "../src/adapter"
import {ClientMessageType} from "../src/message"
import {makeEvent} from "@welshman/util"
import {Nip01Signer} from "@welshman/signer"

const relay1 = "wss://relay-1.example/"
const relay2 = "wss://relay-2.example/"
const relay3 = "wss://relay-3.example/"

describe("publishOne", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("success works", async () => {
    const sendSpy = vi.fn()
    const adapter = new MockAdapter(relay1, sendSpy)
    const signer = Nip01Signer.ephemeral()
    const event = await signer.sign(makeEvent(1))
    const successSpy = vi.fn()
    const failureSpy = vi.fn()
    const completeSpy = vi.fn()

    publishOne({
      event,
      relay: "WSS://RELAY-1.EXAMPLE",
      context: {getAdapter: () => adapter},
      onSuccess: successSpy,
      onFailure: failureSpy,
      onComplete: completeSpy,
    })

    await vi.advanceTimersByTimeAsync(200)

    expect(sendSpy).toHaveBeenCalledWith([ClientMessageType.Event, event])

    adapter.receive(["OK", event.id, true, "hi"])

    await vi.runAllTimers()

    expect(successSpy).toHaveBeenCalledWith({
      relay: relay1,
      detail: "hi",
      status: PublishStatus.Success,
    })
    expect(failureSpy).not.toHaveBeenCalled()
    expect(completeSpy).toHaveBeenCalled()
  })

  it("failure works", async () => {
    const sendSpy = vi.fn()
    const adapter = new MockAdapter(relay1, sendSpy)
    const signer = Nip01Signer.ephemeral()
    const event = await signer.sign(makeEvent(1))
    const successSpy = vi.fn()
    const failureSpy = vi.fn()
    const completeSpy = vi.fn()

    publishOne({
      event,
      relay: relay1,
      context: {getAdapter: () => adapter},
      onSuccess: successSpy,
      onFailure: failureSpy,
      onComplete: completeSpy,
    })

    await vi.advanceTimersByTimeAsync(200)

    expect(sendSpy).toHaveBeenCalledWith([ClientMessageType.Event, event])

    adapter.receive(["OK", event.id, false, "hi"])

    await vi.runAllTimers()

    expect(successSpy).not.toHaveBeenCalled()
    expect(failureSpy).toHaveBeenCalledWith({
      relay: relay1,
      detail: "hi",
      status: PublishStatus.Failure,
    })
    expect(completeSpy).toHaveBeenCalled()
  })

  it("timeout works", async () => {
    const sendSpy = vi.fn()
    const adapter = new MockAdapter(relay1, sendSpy)
    const signer = Nip01Signer.ephemeral()
    const event = await signer.sign(makeEvent(1))
    const successSpy = vi.fn()
    const failureSpy = vi.fn()
    const completeSpy = vi.fn()
    const timeoutSpy = vi.fn()

    publishOne({
      event,
      relay: relay1,
      context: {getAdapter: () => adapter},
      onSuccess: successSpy,
      onFailure: failureSpy,
      onComplete: completeSpy,
      onTimeout: timeoutSpy,
    })

    await vi.runAllTimers()

    expect(sendSpy).toHaveBeenCalledWith([ClientMessageType.Event, event])

    await vi.runAllTimers()

    expect(successSpy).not.toHaveBeenCalled()
    expect(failureSpy).not.toHaveBeenCalled()
    expect(completeSpy).toHaveBeenCalled()
    expect(timeoutSpy).toHaveBeenCalled()
  })

  it("abort works", async () => {
    const sendSpy = vi.fn()
    const adapter = new MockAdapter(relay1, sendSpy)
    const signer = Nip01Signer.ephemeral()
    const event = await signer.sign(makeEvent(1))
    const ctrl = new AbortController()
    const successSpy = vi.fn()
    const failureSpy = vi.fn()
    const completeSpy = vi.fn()
    const abortSpy = vi.fn()

    publishOne({
      event,
      relay: relay1,
      signal: ctrl.signal,
      context: {getAdapter: () => adapter},
      onSuccess: successSpy,
      onFailure: failureSpy,
      onComplete: completeSpy,
      onTimeout: abortSpy,
    })

    await vi.runAllTimers()

    expect(sendSpy).toHaveBeenCalledWith([ClientMessageType.Event, event])

    ctrl.abort()

    await vi.runAllTimers()

    expect(successSpy).not.toHaveBeenCalled()
    expect(failureSpy).not.toHaveBeenCalled()
    expect(completeSpy).toHaveBeenCalled()
    expect(abortSpy).toHaveBeenCalled()
  })
})

describe("publish", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should all basically work", async () => {
    const send1Spy = vi.fn()
    const adapter1 = new MockAdapter(relay1, send1Spy)
    const send2Spy = vi.fn()
    const adapter2 = new MockAdapter(relay2, send2Spy)
    const send3Spy = vi.fn()
    const adapter3 = new MockAdapter(relay3, send3Spy)
    const signer = Nip01Signer.ephemeral()
    const event = await signer.sign(makeEvent(1))
    const successSpy = vi.fn()
    const failureSpy = vi.fn()
    const completeSpy = vi.fn()
    const timeoutSpy = vi.fn()

    publish({
      event,
      relays: [relay1, relay2, relay3],
      context: {
        getAdapter: (url: string) => {
          switch (url) {
            case relay1:
              return adapter1
            case relay2:
              return adapter2
            case relay3:
              return adapter3
            default:
              throw new Error(`Unknown relay: ${url}`)
          }
        },
      },
      onSuccess: successSpy,
      onFailure: failureSpy,
      onComplete: completeSpy,
      onTimeout: timeoutSpy,
    })

    adapter1.receive(["OK", event.id, true, "hi"])
    adapter2.receive(["OK", event.id, false, "hi"])

    await vi.runAllTimersAsync()

    expect(successSpy).toHaveBeenCalledWith({
      relay: relay1,
      status: PublishStatus.Success,
      detail: "hi",
    })
    expect(failureSpy).toHaveBeenCalledWith({
      relay: relay2,
      status: PublishStatus.Failure,
      detail: "hi",
    })
    expect(completeSpy).toHaveBeenCalledTimes(1)
    expect(timeoutSpy).toHaveBeenCalledWith({
      relay: relay3,
      status: PublishStatus.Timeout,
      detail: "timed out",
    })
  })

  it("publishes equivalent relay spellings once under the canonical result key", async () => {
    const send = vi.fn()
    const adapter = new MockAdapter(relay1, send)
    const event = await Nip01Signer.ephemeral().sign(makeEvent(1))
    const getAdapter = vi.fn(() => adapter)
    const resultPromise = publish({
      event,
      relays: ["WSS://RELAY-1.EXAMPLE", relay1],
      context: {getAdapter},
    })

    adapter.receive(["OK", event.id, true, "accepted"])
    await vi.runAllTimersAsync()

    await expect(resultPromise).resolves.toEqual({
      [relay1]: {relay: relay1, status: PublishStatus.Success, detail: "accepted"},
    })
    expect(getAdapter).toHaveBeenCalledOnce()
    expect(getAdapter).toHaveBeenCalledWith(relay1, expect.anything())
    expect(send).toHaveBeenCalledOnce()
  })
})
