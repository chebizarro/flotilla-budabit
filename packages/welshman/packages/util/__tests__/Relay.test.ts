import {afterEach, describe, expect, it, vi} from "vitest"
import {
  LOCAL_RELAY_URL,
  normalizeRelayUrl,
  sanitizeRelayUrls,
  subscribeRelayNormalization,
} from "../src/Relay"

const unsubscribers: Array<() => void> = []

afterEach(() => {
  unsubscribers.splice(0).forEach(unsubscribe => unsubscribe())
})

describe("relay identity contract", () => {
  // Only scheme, hostname, default ports, an empty path, and fragments are canonicalized.
  // Path case/structure, trailing slashes, query order/case, and encoding are not equivalent.
  it.each([
    ["wss://Relay.Example", "wss://relay.example/"],
    ["WSS://Relay.Example", "wss://relay.example/"],
    ["Relay.Example", "wss://relay.example/"],
    [
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.onion",
      "ws://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.onion/",
    ],
    ["localhost:7777", "wss://localhost:7777/"],
    ["wss://relay.example:443", "wss://relay.example/"],
    ["ws://relay.example:80", "ws://relay.example/"],
    ["wss://relay.example:444", "wss://relay.example:444/"],
    ["wss://relay.example/GRASP", "wss://relay.example/GRASP"],
    ["wss://relay.example/path/", "wss://relay.example/path/"],
    ["wss://relay.example/a//b", "wss://relay.example/a//b"],
    ["wss://relay.example?token=AbC%2F123", "wss://relay.example/?token=AbC%2F123"],
    ["wss://relay.example/?b=Two&a=One", "wss://relay.example/?b=Two&a=One"],
    ["wss://relay.example/Path#section", "wss://relay.example/Path"],
    [LOCAL_RELAY_URL, LOCAL_RELAY_URL],
  ])("canonicalizes %s as %s", (input, expected) => {
    expect(normalizeRelayUrl(input)).toBe(expected)
  })

  it.each([
    "",
    "not-a-host",
    "https://relay.example",
    "wss://",
    "wss://user:pass@relay.example/path",
  ])("rejects unsupported input %j", input => {
    expect(() => normalizeRelayUrl(input)).toThrow()
  })

  it("validates and deduplicates collections by canonical identity", () => {
    expect(
      sanitizeRelayUrls([
        "Relay.Example",
        "wss://relay.example/",
        "wss://relay.example/Path",
        "wss://relay.example/path",
        "https://relay.example",
        "wss://user:pass@relay.example",
        null,
      ]),
    ).toEqual(["wss://relay.example/", "wss://relay.example/Path", "wss://relay.example/path"])
  })
})

describe("relay normalization observations", () => {
  it("reports changed inputs without credentials, query values, or fragments", () => {
    const listener = vi.fn()
    unsubscribers.push(subscribeRelayNormalization(listener))

    expect(normalizeRelayUrl("WSS://Relay.Example/Path?token=secret#private")).toBe(
      "wss://relay.example/Path?token=secret",
    )
    expect(listener).toHaveBeenCalledWith({
      source: "welshman.normalizeRelayUrl",
      outcome: "normalized",
      classification: "equivalent-spelling",
      changed: true,
      inputShape: {
        hadProtocol: true,
        hadCredentials: false,
        hadQuery: true,
        hadFragment: true,
        hadTrailingSlash: false,
        hadUppercase: true,
      },
      inputEndpoint: "wss://relay.example/Path",
      canonicalEndpoint: "wss://relay.example/Path",
    })
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
