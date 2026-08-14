import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const source = readFileSync(
  new URL("../components/RepoCollectButton.svelte", import.meta.url),
  "utf8",
)
const modalSource = readFileSync(
  new URL("../components/RepoCollectModal.svelte", import.meta.url),
  "utf8",
)
const globalGitSource = readFileSync(
  new URL("../../routes/git/+page.svelte", import.meta.url),
  "utf8",
)

describe("repository collection button reads", () => {
  it("uses split targeted-original filters and external relay hints", () => {
    expect(source).toContain("makeTargetedPublicationOriginalFilterPlan(")
    expect(source).not.toContain("makeTargetedPublicationOriginalFilters")
    expect(source).toContain("makeCommunityContentFilterPlan(")
    expect(source).toContain("userCommunityStarTargetFilterPlan.relayFilters")
    expect(source).toContain("userCommunityStarTargetFilterPlan.localFilters")
    expect(source).toContain("userCommunityStarReactionFilterPlan.relayFilters")
    expect(source).toContain("userCommunityStarReactionFilterPlan.localFilters")
    expect(source).toContain("parseTargetedPublication(event)?.ref?.relay")
    expect(source).toContain("loadBoundedCommunityHistory({")
    expect(source).toContain("localFilters,")
  })

  it("shares bounded requests while retaining their completion result", () => {
    expect(source).toContain("const loadedFilterRequests = new Map<string, Promise<boolean>>()")
    expect(source).toContain(".then(result => result.complete)")
    expect(source).toContain("localTargetHistoryComplete = complete")
    expect(source).toContain("localDeleteHistoryComplete = complete")
    expect(source).toContain("localOriginalHistoryComplete = complete")
    expect(source).toContain("loadedFilterRequests.delete(key)")
  })

  it("represents incomplete empty reads as indeterminate and preserves known collections", () => {
    expect(source).toContain("getRepoCollectionStatus(collected, communityHistoryComplete)")
    expect(source).toContain("data-collection-status={collectionStatus}")
    expect(source).toContain("Community collection history is incomplete")
    expect(source).toContain("lockedCommunityPubkeys: communityHistoryCompleteAtOpen")
    expect(modalSource).toContain("lockedCommunities.has(option.pubkey)")
  })

  it("passes global target and original completion through the shared read state", () => {
    expect(globalGitSource).toContain("repoCollectionTargetHistoryComplete = result.complete")
    expect(globalGitSource).toContain("repoCollectionDeleteHistoryComplete = result.complete")
    expect(globalGitSource).toContain(
      "repoCollectionOriginalHistoryComplete = results.every(result => result.complete)",
    )
    expect(globalGitSource).toContain("communityHistoryComplete:")
  })

  it("does not truncate authoritative global collection relay coverage", () => {
    const collectionRelaySource = globalGitSource.slice(
      globalGitSource.indexOf("const repoCollectionRelays"),
      globalGitSource.indexOf("const repoCollectionTargetFilters"),
    )

    expect(collectionRelaySource).toContain("...repoCollectionCommunityOptions.flatMap")
    expect(collectionRelaySource).toContain("...bookmarkRelays")
    expect(collectionRelaySource).not.toContain("bookmarkListRelays")
    expect(collectionRelaySource).not.toContain("REPO_LIST_MAX_RELAYS")
    expect(collectionRelaySource).not.toContain(".slice(")
  })
})
