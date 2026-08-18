import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"
import {getPublicKey} from "nostr-tools/pure"
import {makeCommunityPointer} from "./community"
import {makeExactCommunityPath} from "../util/routes"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("exact community admin navigation contracts", () => {
  it("retains each sibling's exact naddr in admin navigation", () => {
    const controllerPubkey = getPublicKey(new Uint8Array(32).fill(1))
    const first = makeCommunityPointer({
      controllerPubkey,
      communityId: getPublicKey(new Uint8Array(32).fill(2)),
      relayHints: ["wss://relay.example"],
    })!
    const sibling = makeCommunityPointer({
      controllerPubkey,
      communityId: getPublicKey(new Uint8Array(32).fill(3)),
      relayHints: ["wss://relay.example"],
    })!

    expect(makeExactCommunityPath(first, "admin")).toBe(
      `/c/${encodeURIComponent(first.naddr)}/admin`,
    )
    expect(makeExactCommunityPath(sibling, "admin")).toBe(
      `/c/${encodeURIComponent(sibling.naddr)}/admin`,
    )
    expect(makeExactCommunityPath(first, "admin")).not.toBe(
      makeExactCommunityPath(sibling, "admin"),
    )
  })

  it("keeps admin notification and drawer navigation on the exact naddr pointer", () => {
    const admin = readProjectFile("../../routes/c/[community]/admin/+page.svelte")
    const menu = readProjectFile("../components/CommunityMenu.svelte")

    expect(admin).toContain('makeExactCommunityPath($activeExactCommunityPointer, "admin")')
    expect(admin).not.toContain('makeCommunityPath(communityPubkey, "admin")')
    expect(menu).toContain('makeExactCommunityPath(exactCommunity, "admin")')
    expect(menu).toContain('makeExactCommunityPath(exactCommunity, "moderation")')
    expect(menu).not.toContain('makeCommunityPath(community, "admin")')
    expect(menu).not.toContain('makeCommunityPath(community, "moderation")')
  })

  it("uses the exact V2 definition for the moderation owner-grant update", () => {
    const moderation = readProjectFile("../../routes/c/[community]/moderation/+page.svelte")

    expect(moderation).toContain("definition: $activeExactCommunityDefinition")
    expect(moderation).toContain(
      'makeExactCommunityPath($activeExactCommunityPointer, "moderation")',
    )
    expect(moderation).not.toContain(
      "definition: $activeExactCommunityDefinition,\n         sectionName",
    )
  })
})
