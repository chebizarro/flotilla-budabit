import {describe, expect, it} from "vitest"
import {normalizeRepoRelay, normalizeRepoRelays} from "./repo-relays"

describe("repository relays", () => {
  it("normalizes aliases before deduplicating", () => {
    expect(
      normalizeRepoRelays(["wss://nos.lol", "wss://nos.lol/", " WSS://NOS.LOL ", "invalid"]),
    ).toEqual(["wss://nos.lol/"])
  })

  it("returns an empty value for invalid relays", () => {
    expect(normalizeRepoRelay("https://nos.lol")).toBe("")
  })
})
