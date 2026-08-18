// @vitest-environment jsdom

import {describe, expect, it, vi} from "vitest"
import {getPublicKey} from "nostr-tools/pure"
import {makeCommunityPointer} from "@app/core/community"

vi.mock("@welshman/store", async importOriginal => {
  const original = await importOriginal<typeof import("@welshman/store")>()
  return {...original, localStorageProvider: {get: vi.fn(), set: vi.fn(), clear: vi.fn()}}
})

const controllerPubkey = getPublicKey(new Uint8Array(32).fill(41))
const first = makeCommunityPointer({
  controllerPubkey,
  communityId: getPublicKey(new Uint8Array(32).fill(42)),
})!
const sibling = makeCommunityPointer({
  controllerPubkey,
  communityId: getPublicKey(new Uint8Array(32).fill(43)),
})!

describe("community extension prompt persistence", () => {
  it("keeps same-controller sibling dismissals independent", async () => {
    const {dismissCommunityExtensionPromptState, isCommunityExtensionPromptDismissed} =
      await import("./community-extension-prompt")
    const userPubkey = "a".repeat(64)
    const state = dismissCommunityExtensionPromptState(undefined, userPubkey, first)

    expect(isCommunityExtensionPromptDismissed(userPubkey, first, state)).toBe(true)
    expect(isCommunityExtensionPromptDismissed(userPubkey, sibling, state)).toBe(false)
  })

  it("rejects the legacy unversioned dismissal shape", async () => {
    const {normalizeCommunityExtensionPromptState} = await import("./community-extension-prompt")

    expect(
      normalizeCommunityExtensionPromptState({
        pubkey: "a".repeat(64),
        dismissedCommunityPubkeys: [controllerPubkey],
      }),
    ).toMatchObject({version: 2, pubkey: "", dismissedCommunityAddresses: []})
  })
})
