import {describe, expect, it} from "vitest"
import {addMaximalFallbacks, makeSelection, Router} from "../src/index"

describe("router relay selection", () => {
  it("sanitizes and deduplicates relay identities at the routing boundary", () => {
    expect(
      makeSelection([
        "WSS://Relay.Example",
        "wss://relay.example/",
        "wss://relay.example/GRASP",
        "wss://relay.example/grasp",
        "invalid",
      ]).relays,
    ).toEqual(["wss://relay.example/", "wss://relay.example/GRASP", "wss://relay.example/grasp"])
  })

  it("canonicalizes and deduplicates fallback identities", () => {
    const router = new Router({
      getDefaultRelays: () => [
        "WSS://Fallback.Example",
        "wss://fallback.example/",
        "wss://other.example/",
      ],
    })

    expect(router.scenario([]).policy(addMaximalFallbacks).limit(2).getUrls().sort()).toEqual([
      "wss://fallback.example/",
      "wss://other.example/",
    ])
  })
})
