import {get} from "svelte/store"
import {Socket, SocketEvent, type ClientMessage} from "@welshman/net"
import {subscribeRelayNormalization} from "@welshman/util"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {deriveRelay, getRelay, relaysByUrl} from "../src/relays"
import {
  deriveRelayStats,
  getRelayStats,
  makeRelayStats,
  relayStatsByUrl,
  trackRelayStats,
} from "../src/relayStats"

const relay = "wss://relay.example/"

describe("relay identity stores", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("null")),
    )
    relaysByUrl.set(new Map())
    relayStatsByUrl.set(new Map())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("resolves metadata and statistics using equivalent relay spellings", () => {
    const profile = {url: relay, name: "Relay"}
    const stats = makeRelayStats(relay)
    relaysByUrl.set(new Map([[relay, profile]]))
    relayStatsByUrl.set(new Map([[relay, stats]]))

    expect(getRelay("WSS://RELAY.EXAMPLE")).toBe(profile)
    expect(get(deriveRelay("WSS://RELAY.EXAMPLE"))).toBe(profile)
    expect(getRelayStats("WSS://RELAY.EXAMPLE")).toBe(stats)
    expect(get(deriveRelayStats("WSS://RELAY.EXAMPLE"))).toBe(stats)
  })

  it("stores socket statistics under canonical relay identity", async () => {
    const socket = new Socket("WSS://RELAY.EXAMPLE")
    const untrack = trackRelayStats(socket)

    socket.emit(SocketEvent.Send, ["REQ", "subscription", {}] as ClientMessage, socket.url)
    await vi.advanceTimersByTimeAsync(1000)

    expect(Array.from(get(relayStatsByUrl).keys())).toEqual([relay])
    expect(getRelayStats(relay)?.request_count).toBe(1)
    untrack()
  })

  it("normalizes a relay once when tracking a burst of socket events", async () => {
    const observations = vi.fn()
    const unsubscribe = subscribeRelayNormalization(observations)
    const socket = new Socket(relay)
    const untrack = trackRelayStats(socket)

    for (let index = 0; index < 100; index++) {
      socket.emit(
        SocketEvent.Send,
        ["REQ", `subscription-${index}`, {}] as ClientMessage,
        socket.url,
      )
    }
    await vi.advanceTimersByTimeAsync(1000)

    unsubscribe()
    expect(observations).toHaveBeenCalledOnce()
    expect(getRelayStats(relay)?.request_count).toBe(100)
    untrack()
  })
})
