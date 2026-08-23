import {beforeEach, describe, expect, it, vi} from "vitest"
import {getPublicKey} from "nostr-tools"
import {DELETE, type TrustedEvent} from "@welshman/util"
import {makeCommunityAuthorityTags, makeCommunityPointer} from "./community-protocol"

const {request, getEvent, publish} = vi.hoisted(() => ({
  request: vi.fn(),
  getEvent: vi.fn(),
  publish: vi.fn(),
}))

vi.mock("@welshman/net", () => ({request}))
vi.mock("@welshman/app", () => ({repository: {getEvent, publish}}))

import {getCommunityDeleteSeenKey, hydrateCommunityDeleteEvents} from "./community-deletes"

const communityId = getPublicKey(new Uint8Array(32).fill(1))
const community = makeCommunityPointer({
  ownerPubkey: getPublicKey(new Uint8Array(32).fill(2)),
  communityId,
})!
const sameIdBranch = makeCommunityPointer({
  ownerPubkey: getPublicKey(new Uint8Array(32).fill(3)),
  communityId,
})!
const controllerSibling = makeCommunityPointer({
  ownerPubkey: community.ownerPubkey,
  communityId: getPublicKey(new Uint8Array(32).fill(4)),
})!

const makeDelete = (tags: string[][], created_at: number): TrustedEvent => ({
  id: `delete-${created_at}`,
  pubkey: "d".repeat(64),
  created_at,
  kind: DELETE,
  tags,
  content: "",
  sig: "",
})

describe("community delete hydration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getEvent.mockReturnValue(undefined)
  })

  it("persists checkpoints under the exact definition address", () => {
    expect(getCommunityDeleteSeenKey(community.address)).toBe(
      `communityDeleteSeen:${community.address}`,
    )
    expect(getCommunityDeleteSeenKey(sameIdBranch.address)).toBe(
      `communityDeleteSeen:${sameIdBranch.address}`,
    )
    expect(getCommunityDeleteSeenKey(controllerSibling.address)).toBe(
      `communityDeleteSeen:${controllerSibling.address}`,
    )
    expect(getCommunityDeleteSeenKey(communityId)).toBe("")
  })

  it("queries by h and admits only the exact marked branch authority", async () => {
    const admitted = makeDelete(makeCommunityAuthorityTags(community, undefined, [["k", "1"]]), 10)
    const sibling = makeDelete(
      makeCommunityAuthorityTags(sameIdBranch, undefined, [["k", "1"]]),
      20,
    )
    request.mockImplementation(async ({onEvent}) => {
      onEvent(admitted)
      onEvent(sibling)
    })

    await expect(
      hydrateCommunityDeleteEvents({
        relays: ["wss://relay.example"],
        community,
        kinds: [1],
        since: 4,
      }),
    ).resolves.toBe(10)

    expect(request.mock.calls[0][0].filters).toEqual([
      {kinds: [DELETE], "#h": [communityId], "#k": ["1"], since: 4},
    ])
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith(admitted)
  })

  it("propagates request failures so route ownership can retry", async () => {
    const failure = new Error("relay unavailable")
    request.mockRejectedValueOnce(failure)

    await expect(
      hydrateCommunityDeleteEvents({
        relays: ["wss://relay.example"],
        community,
        kinds: [1],
        since: 4,
      }),
    ).rejects.toBe(failure)
  })
})
