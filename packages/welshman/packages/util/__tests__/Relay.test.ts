import {afterEach, describe, expect, it, vi} from "vitest"
import {normalizeRelayUrl, subscribeRelayNormalization} from "../src/Relay"

const unsubscribers: Array<() => void> = []

afterEach(() => {
  unsubscribers.splice(0).forEach(unsubscribe => unsubscribe())
})

describe("relay normalization observations", () => {
  it("reports changed inputs without credentials, query values, or fragments", () => {
    const listener = vi.fn()
    unsubscribers.push(subscribeRelayNormalization(listener))

    expect(normalizeRelayUrl("WSS://user:pass@Relay.Example/path?token=secret#private")).toBe(
      "wss://user:pass@relay.example/path?token=secret#private",
    )
    expect(listener).toHaveBeenCalledWith({
      source: "welshman.normalizeRelayUrl",
      outcome: "normalized",
      classification: "equivalent-spelling",
      changed: true,
      inputShape: {
        hadProtocol: true,
        hadCredentials: true,
        hadQuery: true,
        hadFragment: true,
        hadTrailingSlash: false,
        hadUppercase: true,
      },
      inputEndpoint: "wss://relay.example/path",
      canonicalEndpoint: "wss://relay.example/path",
    })
    expect(JSON.stringify(listener.mock.calls)).not.toContain("user")
    expect(JSON.stringify(listener.mock.calls)).not.toContain("secret")
  })

  it("does not report unchanged routine calls", () => {
    const listener = vi.fn()
    unsubscribers.push(subscribeRelayNormalization(listener))

    expect(normalizeRelayUrl("wss://relay.example/")).toBe("wss://relay.example/")
    expect(listener).not.toHaveBeenCalled()
  })

  it("isolates listeners and unsubscribes without changing normalization", () => {
    const throwing = vi.fn(() => {
      throw new Error("observer failed")
    })
    const listener = vi.fn()
    unsubscribers.push(subscribeRelayNormalization(throwing))
    const unsubscribe = subscribeRelayNormalization(listener)

    expect(normalizeRelayUrl("relay.example")).toBe("wss://relay.example/")
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
    expect(normalizeRelayUrl("other.example")).toBe("wss://other.example/")
    expect(listener).toHaveBeenCalledOnce()
  })
})
