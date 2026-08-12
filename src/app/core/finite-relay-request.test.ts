import {describe, expect, it, vi} from "vitest"
import type {RequestOptions} from "@welshman/net"
import type {TrustedEvent} from "@welshman/util"
import {createFiniteRelayRequester} from "./finite-relay-request"

const relay = "wss://repo.example.com"
const event: TrustedEvent = {
  id: "1".repeat(64),
  pubkey: "2".repeat(64),
  created_at: 123,
  kind: 1621,
  tags: [],
  content: "issue",
  sig: "3".repeat(128),
}

const waitForAbort = (options: RequestOptions) =>
  new Promise<TrustedEvent[]>(resolve => {
    if (options.signal?.aborted) resolve([])
    else options.signal?.addEventListener("abort", () => resolve([]), {once: true})
  })

describe("finite relay request", () => {
  it("returns EOSE with deduplicated events while forwarding relay provenance", async () => {
    let clock = 100
    const onEvent = vi.fn()
    const request = vi.fn(async (options: RequestOptions) => {
      options.onStart?.(relay)
      clock = 120
      options.onEvent?.(event, relay)
      options.onDuplicate?.(event, relay)
      options.onEose?.(relay)
      clock = 130
      return [event]
    })
    const finiteRequest = createFiniteRelayRequester({request, now: () => clock})

    await expect(
      finiteRequest({relay, filters: [{kinds: [event.kind]}], timeoutMs: 1000, onEvent}),
    ).resolves.toEqual({
      relay,
      outcome: "eose",
      events: [event],
      queuedAt: 100,
      startedAt: 100,
      finishedAt: 130,
    })
    expect(onEvent).toHaveBeenNthCalledWith(1, event, relay)
    expect(onEvent).toHaveBeenNthCalledWith(2, event, relay)
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        relays: [relay],
        autoClose: true,
        lifetime: "finite",
      }),
    )
  })

  it("times out while still queued", async () => {
    vi.useFakeTimers()
    const request = vi.fn((options: RequestOptions) => waitForAbort(options))
    const finiteRequest = createFiniteRelayRequester({request})

    try {
      const pending = finiteRequest({relay, filters: [{}], timeoutMs: 1000})
      await vi.advanceTimersByTimeAsync(1000)

      await expect(pending).resolves.toMatchObject({outcome: "timeout", startedAt: undefined})
      expect(vi.mocked(request).mock.calls[0][0].signal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("times out after the physical request starts", async () => {
    vi.useFakeTimers()
    const request = vi.fn((options: RequestOptions) => {
      options.onStart?.(relay)
      return waitForAbort(options)
    })
    const finiteRequest = createFiniteRelayRequester({request})

    try {
      const pending = finiteRequest({relay, filters: [{}], timeoutMs: 1000})
      await vi.advanceTimersByTimeAsync(1000)

      const result = await pending
      expect(result.outcome).toBe("timeout")
      expect(result.startedAt).toBeTypeOf("number")
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    {
      expected: {outcome: "closed", reason: "rate-limited"},
      terminate: (options: RequestOptions) => options.onClosed?.("rate-limited", relay),
    },
    {
      expected: {outcome: "disconnect"},
      terminate: (options: RequestOptions) => options.onDisconnect?.(relay),
    },
  ])("preserves $expected.outcome outcomes", async ({expected, terminate}) => {
    const request = vi.fn(async (options: RequestOptions) => {
      terminate(options)
      return []
    })
    const finiteRequest = createFiniteRelayRequester({request})

    await expect(finiteRequest({relay, filters: [{}], timeoutMs: 1000})).resolves.toMatchObject(
      expected,
    )
  })

  it("aborts queued work through the request signal", async () => {
    const controller = new AbortController()
    const request = vi.fn((options: RequestOptions) => waitForAbort(options))
    const finiteRequest = createFiniteRelayRequester({request})
    const pending = finiteRequest({
      relay,
      filters: [{}],
      timeoutMs: 1000,
      signal: controller.signal,
    })

    controller.abort()

    await expect(pending).resolves.toMatchObject({outcome: "aborted", startedAt: undefined})
    expect(vi.mocked(request).mock.calls[0][0].signal?.aborted).toBe(true)
  })

  it("aborts active work through the request signal", async () => {
    const controller = new AbortController()
    const request = vi.fn((options: RequestOptions) => {
      options.onStart?.(relay)
      return waitForAbort(options)
    })
    const finiteRequest = createFiniteRelayRequester({request})
    const pending = finiteRequest({
      relay,
      filters: [{}],
      timeoutMs: 1000,
      signal: controller.signal,
    })

    controller.abort()

    const result = await pending
    expect(result.outcome).toBe("aborted")
    expect(result.startedAt).toBeTypeOf("number")
  })

  it.each([
    {
      label: "synchronous request failure",
      request: () => {
        throw new Error("admission failed")
      },
    },
    {
      label: "asynchronous request failure",
      request: async () => {
        throw new Error("transport failed")
      },
    },
  ])("returns an error result for $label", async ({request}) => {
    const finiteRequest = createFiniteRelayRequester({request})

    const result = await finiteRequest({relay, filters: [{}], timeoutMs: 1000})

    expect(result.outcome).toBe("error")
    expect(result.reason).toMatch(/failed/)
  })

  it("aborts when the event consumer fails", async () => {
    const request = vi.fn((options: RequestOptions) => {
      options.onEvent?.(event, relay)
      return waitForAbort(options)
    })
    const finiteRequest = createFiniteRelayRequester({request})

    const result = await finiteRequest({
      relay,
      filters: [{}],
      timeoutMs: 1000,
      onEvent: () => {
        throw new Error("publish failed")
      },
    })

    expect(result).toMatchObject({outcome: "error", reason: "publish failed"})
    expect(vi.mocked(request).mock.calls[0][0].signal?.aborted).toBe(true)
  })
})
