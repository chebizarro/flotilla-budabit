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
    expect(listener).toHaveBeenCalledWith(
      {
        source: "welshman.normalizeRelayUrl",
        outcome: "normalized",
        classification: "equivalent-spelling",
        changed: true,
        inputType: "string",
        inputShape: {
          hadProtocol: true,
          hadCredentials: false,
          hadQuery: true,
          hadFragment: true,
          hadTrailingSlash: false,
          pathHadUppercase: true,
          queryHadUppercase: false,
        },
        reasons: {
          schemeCaseChanged: true,
          hostnameCaseChanged: true,
          defaultPortRemoved: false,
          rootSlashAdded: false,
          fragmentRemoved: true,
        },
        inputEndpoint: "wss://relay.example",
        canonicalEndpoint: "wss://relay.example",
      },
      {inputPath: "/Path", canonicalPath: "/Path"},
    )
    expect(JSON.stringify(listener.mock.calls)).not.toContain("secret")
  })

  it("reports unchanged routine calls as the denominator", () => {
    const listener = vi.fn()
    unsubscribers.push(subscribeRelayNormalization(listener))

    expect(normalizeRelayUrl("wss://relay.example/")).toBe("wss://relay.example/")
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({outcome: "unchanged", classification: "canonical", changed: false}),
      {inputPath: "/", canonicalPath: "/"},
    )
  })

  it("separates authority normalization reasons from significant path and query case", () => {
    const listener = vi.fn()
    unsubscribers.push(subscribeRelayNormalization(listener))

    normalizeRelayUrl("wss://relay.example/GRASP?token=AbC")
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "unchanged",
        inputShape: expect.objectContaining({pathHadUppercase: true, queryHadUppercase: true}),
        reasons: {
          schemeCaseChanged: false,
          hostnameCaseChanged: false,
          defaultPortRemoved: false,
          rootSlashAdded: false,
          fragmentRemoved: false,
        },
      }),
      expect.anything(),
    )
  })

  it("safely reports non-string runtime inputs", () => {
    const listener = vi.fn()
    unsubscribers.push(subscribeRelayNormalization(listener))

    expect(() => normalizeRelayUrl(undefined as unknown as string)).toThrow()
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({outcome: "rejected", inputType: "undefined"}),
      {inputPath: ""},
    )
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
