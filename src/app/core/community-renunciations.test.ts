import {describe, expect, it, vi} from "vitest"
import {getPublicKey} from "nostr-tools"
import {NAMED_PEOPLE} from "@welshman/util"

vi.mock("@app/core/state", () => ({
  INDEXER_RELAYS: ["wss://indexer.example", "bad-relay"],
}))

import {
  RENOUNCED_COMMUNITIES_DTAG,
  addRenouncedCommunityToList,
  getRenouncedCommunityAddressesFromList,
  getRenunciationPublishRelays,
  makeRenouncedCommunitiesList,
  removeRenouncedCommunityFromList,
} from "@app/core/community-renunciations"
import {makeCommunityPointer} from "@app/core/community-protocol"

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

describe("community renunciations", () => {
  it("creates a private named people list for renounced communities", () => {
    const list = makeRenouncedCommunitiesList({
      kind: NAMED_PEOPLE,
      publicTags: [
        ["d", "old"],
        ["title", "Renounced"],
      ],
      privateTags: [["a", community.address]],
    })

    expect(list.kind).toBe(NAMED_PEOPLE)
    expect(list.publicTags).toEqual([
      ["d", RENOUNCED_COMMUNITIES_DTAG],
      ["title", "Renounced"],
    ])
    expect(getRenouncedCommunityAddressesFromList(list)).toEqual([community.address])
  })

  it("only reads exact encrypted private definition addresses as renounced communities", () => {
    const list = makeRenouncedCommunitiesList({
      kind: NAMED_PEOPLE,
      publicTags: [["a", sameIdBranch.address]],
      privateTags: [
        ["a", community.address],
        ["a", "bad"],
        ["a", sameIdBranch.address, "wss://relay.example"],
        ["p", communityId],
      ],
    })

    expect(getRenouncedCommunityAddressesFromList(list)).toEqual([community.address])
  })

  it("keeps same-ID branches independent in private list content", async () => {
    const added = await addRenouncedCommunityToList(undefined, community).reconcile(
      async value => `encrypted:${value}`,
    )

    expect(added).toMatchObject({
      kind: NAMED_PEOPLE,
      tags: [["d", RENOUNCED_COMMUNITIES_DTAG]],
      content: `encrypted:${JSON.stringify([["a", community.address]])}`,
    })

    const removed = await removeRenouncedCommunityFromList(
      makeRenouncedCommunitiesList({
        kind: NAMED_PEOPLE,
        privateTags: [
          ["a", community.address],
          ["a", sameIdBranch.address],
        ],
      }),
      community,
    ).reconcile(async value => `encrypted:${value}`)

    expect(removed).toMatchObject({
      kind: NAMED_PEOPLE,
      tags: [["d", RENOUNCED_COMMUNITIES_DTAG]],
      content: `encrypted:${JSON.stringify([["a", sameIdBranch.address]])}`,
    })
  })

  it("keeps communities from the same owner independent", async () => {
    const removed = await removeRenouncedCommunityFromList(
      makeRenouncedCommunitiesList({
        kind: NAMED_PEOPLE,
        privateTags: [
          ["a", community.address],
          ["a", controllerSibling.address],
        ],
      }),
      community,
    ).reconcile(async value => `encrypted:${value}`)

    expect(removed.content).toBe(`encrypted:${JSON.stringify([["a", controllerSibling.address]])}`)
  })

  it("falls back to indexer relays when the user has no outbox relays", () => {
    expect(getRenunciationPublishRelays([])).toEqual(["wss://indexer.example/"])
  })

  it("prefers normalized user outbox relays for renunciation publishes", () => {
    expect(
      getRenunciationPublishRelays(["bad-relay", "wss://outbox.example", "wss://outbox.example/"]),
    ).toEqual(["wss://outbox.example/"])
  })
})
