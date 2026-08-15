import {describe, expect, it, vi} from "vitest"
import type {RequestOptions} from "@welshman/net"
import type {TrustedEvent} from "@welshman/util"
import {
  ExtensionSubscriptionRegistry,
  MAX_EXTENSION_RELAYS_PER_SUBSCRIPTION,
  MAX_EXTENSION_SUBSCRIPTIONS,
  MAX_EXTENSION_SUBSCRIPTIONS_PER_RELAY,
} from "./extension-subscriptions"

const makeEvent = (kind: number, tags: string[][] = []): TrustedEvent =>
  ({
    id: `${kind}-${JSON.stringify(tags)}`,
    pubkey: "a".repeat(64),
    created_at: 1,
    kind,
    tags,
    content: "",
    sig: "sig",
  }) as TrustedEvent

const makeRegistry = (options: {backfillTimeoutMs?: number} = {}) => {
  const calls: RequestOptions[] = []
  let sequence = 0
  const request = vi.fn((requestOptions: RequestOptions) => {
    calls.push(requestOptions)
    return new Promise<TrustedEvent[]>(resolve => {
      requestOptions.signal?.addEventListener("abort", () => resolve([]), {once: true})
    })
  })
  const registry = new ExtensionSubscriptionRegistry({
    request,
    makeSubscriptionId: () => `host-${++sequence}`,
    ...options,
  })

  return {calls, registry, request}
}

describe("extension subscription registry", () => {
  it("runs a normal finite backfill and background live tail for each relay group", () => {
    const {calls, registry} = makeRegistry()

    registry.subscribe({
      extensionId: "extension-a",
      relays: ["wss://relay.example", "wss://relay.example/"],
      filters: [{kinds: [1]}],
      onEvent: vi.fn(),
    })

    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      relays: ["wss://relay.example/"],
      filters: [{kinds: [1]}],
      lifetime: "finite",
      autoClose: true,
      priority: 0,
      owner: "extension:extension-a",
    })
    expect(calls[1]).toMatchObject({
      relays: ["wss://relay.example/"],
      filters: [{kinds: [1]}],
      lifetime: "live",
      priority: -100,
      owner: "extension:extension-a",
    })
    expect(calls[0].signal).not.toBe(calls[1].signal)

    calls[0].onEose?.("wss://relay.example/")
    expect(calls[0].signal?.aborted).toBe(true)
    expect(calls[1].signal?.aborted).toBe(false)
    expect(registry.getSnapshot()).toMatchObject({groups: [{active: true, pending: false}]})

    registry.close()
  })

  it("reconciles changed filters without interrupting the prior live tail before EOSE", () => {
    const {calls, registry} = makeRegistry()

    registry.subscribe({
      extensionId: "extension-a",
      relays: ["wss://relay.example"],
      filters: [{kinds: [1]}],
      onEvent: vi.fn(),
    })
    calls[0].onEose?.("wss://relay.example/")

    registry.subscribe({
      extensionId: "extension-a",
      relays: ["wss://relay.example"],
      filters: [{kinds: [2]}],
      onEvent: vi.fn(),
    })

    expect(calls).toHaveLength(4)
    expect(calls[1].signal?.aborted).toBe(false)
    expect(calls[2]).toMatchObject({
      filters: [{kinds: [1]}, {kinds: [2]}],
      lifetime: "finite",
    })
    expect(calls[3]).toMatchObject({
      filters: [{kinds: [1]}, {kinds: [2]}],
      lifetime: "live",
    })

    calls[2].onEose?.("wss://relay.example/")
    expect(calls[1].signal?.aborted).toBe(true)
    expect(calls[3].signal?.aborted).toBe(false)
    expect(registry.getSnapshot()).toMatchObject({
      logicalSubscriptions: 2,
      groups: [{logicalSubscriptions: 2, active: true, pending: false}],
    })

    registry.close()
  })

  it("matches events against logical filters and deduplicates finite/live overlap", () => {
    const {calls, registry} = makeRegistry()
    const first = vi.fn()
    const second = vi.fn()
    const firstId = registry.subscribe({
      extensionId: "extension-a",
      relays: ["wss://relay.example"],
      filters: [{kinds: [1], "#d": ["one"]}],
      onEvent: first,
    })
    calls[0].onEose?.("wss://relay.example/")
    const secondId = registry.subscribe({
      extensionId: "extension-a",
      relays: ["wss://relay.example"],
      filters: [{kinds: [1], "#d": ["two"]}],
      onEvent: second,
    })

    const firstEvent = makeEvent(1, [["d", "one"]])
    calls[1].onEvent?.(firstEvent, "wss://relay.example/")
    calls[2].onEvent?.(firstEvent, "wss://relay.example/")

    expect(first).toHaveBeenCalledWith(firstId, expect.objectContaining({kind: 1}))
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()

    calls[3].onDuplicate?.(makeEvent(1, [["d", "two"]]), "wss://relay.example/")
    expect(second).toHaveBeenCalledWith(secondId, expect.objectContaining({kind: 1}))
    registry.close()
  })

  it("retains enough dedupe history for the maximum public backfill quotas", () => {
    const {calls, registry} = makeRegistry()
    const onEvent = vi.fn()
    registry.subscribe({
      extensionId: "extension-a",
      relays: ["wss://relay.example"],
      filters: [{kinds: [1], limit: 500}],
      onEvent,
    })

    const first = makeEvent(1, [["d", "event-0"]])
    for (let index = 0; index < 1_001; index += 1) {
      calls[0].onEvent?.(makeEvent(1, [["d", `event-${index}`]]), "wss://relay.example/")
    }
    calls[1].onEvent?.(first, "wss://relay.example/")

    expect(onEvent).toHaveBeenCalledTimes(1_001)
    registry.close()
  })

  it("sends EOSE once per logical subscription and relay", () => {
    const {calls, registry} = makeRegistry()
    const onEose = vi.fn()
    const subscriptionId = registry.subscribe({
      extensionId: "extension-a",
      relays: ["wss://one.example", "wss://two.example"],
      filters: [{kinds: [1]}],
      onEvent: vi.fn(),
      onEose,
    })

    calls[1].onEose?.("wss://one.example/")
    calls[0].onEose?.("wss://one.example/")
    calls[2].onEose?.("wss://two.example/")

    expect(onEose.mock.calls).toEqual([
      [subscriptionId, "wss://one.example/"],
      [subscriptionId, "wss://two.example/"],
    ])
    registry.close()
  })

  it("gives an identical late subscriber its own history and EOSE", () => {
    const {calls, registry} = makeRegistry()
    const firstEvent = vi.fn()
    const firstEose = vi.fn()
    const secondEvent = vi.fn()
    const secondEose = vi.fn()
    const event = makeEvent(1)

    const firstId = registry.subscribe({
      extensionId: "extension-a",
      relays: ["wss://relay.example"],
      filters: [{kinds: [1]}],
      onEvent: firstEvent,
      onEose: firstEose,
    })
    calls[0].onEvent?.(event, "wss://relay.example/")
    calls[0].onEose?.("wss://relay.example/")

    const secondId = registry.subscribe({
      extensionId: "extension-a",
      relays: ["wss://relay.example"],
      filters: [{kinds: [1]}],
      onEvent: secondEvent,
      onEose: secondEose,
    })
    expect(calls).toHaveLength(4)
    calls[2].onEvent?.(event, "wss://relay.example/")
    calls[2].onEose?.("wss://relay.example/")

    expect(firstEvent).toHaveBeenCalledTimes(1)
    expect(secondEvent).toHaveBeenCalledWith(secondId, event)
    expect(firstEose).toHaveBeenCalledTimes(1)
    expect(firstEose).toHaveBeenCalledWith(firstId, "wss://relay.example/")
    expect(secondEose).toHaveBeenCalledWith(secondId, "wss://relay.example/")
    registry.close()
  })

  it("times out a silent finite backfill without closing its live tail", async () => {
    vi.useFakeTimers()
    const {calls, registry} = makeRegistry({backfillTimeoutMs: 1_000})
    registry.subscribe({
      extensionId: "extension-a",
      relays: ["wss://relay.example"],
      filters: [{kinds: [1]}],
      onEvent: vi.fn(),
    })

    await vi.advanceTimersByTimeAsync(2_000)
    expect(calls[0].signal?.aborted).toBe(false)

    calls[0].onStart?.("wss://relay.example/")
    await vi.advanceTimersByTimeAsync(1_000)

    expect(calls[0].signal?.aborted).toBe(true)
    expect(calls[1].signal?.aborted).toBe(false)
    expect(registry.getSnapshot()).toMatchObject({groups: [{active: true, pending: false}]})

    registry.cleanupExtension("extension-a")
    expect(calls[1].signal?.aborted).toBe(true)
    expect(registry.getSnapshot()).toEqual({logicalSubscriptions: 0, groups: []})
    vi.useRealTimers()
  })

  it("keeps a viable finite backfill after the live request closes", async () => {
    const calls: RequestOptions[] = []
    let finishLive: () => void = () => {}
    const onEvent = vi.fn()
    const onEose = vi.fn()
    const registry = new ExtensionSubscriptionRegistry({
      retryDelayMs: 1_000,
      request: options => {
        calls.push(options)
        if (options.lifetime === "live") {
          return new Promise<TrustedEvent[]>(resolve => {
            finishLive = () => resolve([])
          })
        }
        return new Promise<TrustedEvent[]>(resolve => {
          options.signal?.addEventListener("abort", () => resolve([]), {once: true})
        })
      },
    })
    const subscriptionId = registry.subscribe({
      extensionId: "extension-a",
      relays: ["wss://relay.example"],
      filters: [{kinds: [1]}],
      onEvent,
      onEose,
    })

    calls[0].onStart?.("wss://relay.example/")
    finishLive()
    await Promise.resolve()
    await Promise.resolve()

    expect(calls[0].signal?.aborted).toBe(false)
    calls[0].onEvent?.(makeEvent(1), "wss://relay.example/")
    calls[0].onEose?.("wss://relay.example/")

    expect(onEvent).toHaveBeenCalledWith(subscriptionId, makeEvent(1))
    expect(onEose).toHaveBeenCalledWith(subscriptionId, "wss://relay.example/")
    registry.close()
  })

  it("replaces removed filters at EOSE and cleans up every physical request", () => {
    const {calls, registry} = makeRegistry()
    const firstId = registry.subscribe({
      extensionId: "extension-a",
      relays: ["wss://relay.example"],
      filters: [{kinds: [1]}],
      onEvent: vi.fn(),
    })
    calls[0].onEose?.("wss://relay.example/")
    const secondId = registry.subscribe({
      extensionId: "extension-a",
      relays: ["wss://relay.example"],
      filters: [{kinds: [2]}],
      onEvent: vi.fn(),
    })
    calls[2].onEose?.("wss://relay.example/")

    expect(registry.unsubscribe("extension-a", secondId)).toBe(true)
    expect(calls).toHaveLength(6)
    expect(calls[4]).toMatchObject({filters: [{kinds: [1]}], lifetime: "finite"})
    expect(calls[5]).toMatchObject({filters: [{kinds: [1]}], lifetime: "live"})
    expect(calls[3].signal?.aborted).toBe(false)

    calls[4].onEose?.("wss://relay.example/")
    expect(calls[3].signal?.aborted).toBe(true)
    expect(calls[5].signal?.aborted).toBe(false)
    expect(registry.unsubscribe("extension-a", firstId)).toBe(true)
    expect(calls[4].signal?.aborted).toBe(true)
    expect(calls[5].signal?.aborted).toBe(true)
    registry.close()
  })

  it("closes every relay request during extension cleanup", () => {
    const {calls, registry} = makeRegistry()
    registry.subscribe({
      extensionId: "extension-a",
      relays: ["wss://one.example", "wss://two.example"],
      filters: [{kinds: [1]}],
      onEvent: vi.fn(),
    })

    registry.cleanupExtension("extension-a")

    expect(calls).toHaveLength(4)
    expect(calls.every(call => call.signal?.aborted)).toBe(true)
    expect(registry.getSnapshot()).toEqual({logicalSubscriptions: 0, groups: []})
  })

  it("retries a live request that ends while its logical registration remains", async () => {
    vi.useFakeTimers()
    const calls: RequestOptions[] = []
    const registry = new ExtensionSubscriptionRegistry({
      retryDelayMs: 1_000,
      request: async options => {
        calls.push(options)
        options.onStart?.(options.relays[0])
        return []
      },
    })
    registry.subscribe({
      extensionId: "extension-a",
      relays: ["wss://relay.example"],
      filters: [{kinds: [1]}],
      onEvent: vi.fn(),
    })

    await Promise.resolve()
    expect(calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(calls).toHaveLength(3)

    registry.cleanupExtension("extension-a")
    await vi.advanceTimersByTimeAsync(1_000)
    expect(calls).toHaveLength(3)
    vi.useRealTimers()
  })

  it("enforces extension, relay-per-subscription, and per-relay logical quotas", () => {
    const first = makeRegistry()
    for (let index = 0; index < MAX_EXTENSION_SUBSCRIPTIONS; index += 1) {
      first.registry.subscribe({
        extensionId: "extension-a",
        relays: ["wss://relay.example"],
        filters: [{kinds: [index + 1]}],
        onEvent: vi.fn(),
      })
    }
    expect(() =>
      first.registry.subscribe({
        extensionId: "extension-a",
        relays: ["wss://other.example"],
        filters: [{kinds: [100]}],
        onEvent: vi.fn(),
      }),
    ).toThrow(`Subscription limit reached (max ${MAX_EXTENSION_SUBSCRIPTIONS})`)
    first.registry.close()

    const second = makeRegistry()
    expect(() =>
      second.registry.subscribe({
        extensionId: "extension-a",
        relays: Array.from(
          {length: MAX_EXTENSION_RELAYS_PER_SUBSCRIPTION + 1},
          (_, index) => `wss://relay-${index}.example`,
        ),
        filters: [{kinds: [1]}],
        onEvent: vi.fn(),
      }),
    ).toThrow(`Relay limit reached (max ${MAX_EXTENSION_RELAYS_PER_SUBSCRIPTION} per subscription)`)

    for (let index = 0; index < MAX_EXTENSION_SUBSCRIPTIONS_PER_RELAY; index += 1) {
      second.registry.subscribe({
        extensionId: `extension-${index}`,
        relays: ["wss://relay.example"],
        filters: [{kinds: [index + 1]}],
        onEvent: vi.fn(),
      })
    }
    expect(() =>
      second.registry.subscribe({
        extensionId: "extension-overflow",
        relays: ["wss://relay.example"],
        filters: [{kinds: [100]}],
        onEvent: vi.fn(),
      }),
    ).toThrow(`Relay subscription limit reached for wss://relay.example/`)
    second.registry.close()
  })
})
