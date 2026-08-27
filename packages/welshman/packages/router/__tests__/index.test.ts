import {describe, expect, it} from "vitest"
import {makeSelection} from "../src/index"

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
})
