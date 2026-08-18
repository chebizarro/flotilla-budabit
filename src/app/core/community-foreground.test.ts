import {get} from "svelte/store"
import {beforeEach, describe, expect, it} from "vitest"
import {activeCommunityRoomLoad, clearActiveCommunityRoomLoad} from "./community-foreground"

describe("community room foreground state", () => {
  beforeEach(() => activeCommunityRoomLoad.set({communityAddress: "", roomId: "", pending: false}))

  it("isolates sibling definitions controlled by the same key", () => {
    activeCommunityRoomLoad.set({
      communityAddress: `32222:${"a".repeat(64)}:${"b".repeat(64)}`,
      roomId: "general",
      pending: true,
    })

    clearActiveCommunityRoomLoad(`32222:${"a".repeat(64)}:${"c".repeat(64)}`, "general")
    expect(get(activeCommunityRoomLoad).pending).toBe(true)

    clearActiveCommunityRoomLoad(`32222:${"a".repeat(64)}:${"b".repeat(64)}`, "general")
    expect(get(activeCommunityRoomLoad)).toEqual({
      communityAddress: "",
      roomId: "",
      pending: false,
    })
  })
})
