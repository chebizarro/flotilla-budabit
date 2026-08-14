import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("community room and thread route transport", () => {
  it("keeps home and menu room selection local while home requests structural filters", () => {
    const home = readProjectFile("../../routes/c/[community]/+page.svelte")
    const menu = readProjectFile("../components/CommunityMenu.svelte")

    expect(home).toContain("makeCommunityContentFilterPlan")
    expect(home).toContain("const roomFilters = $derived(roomFilterPlan.localFilters)")
    expect(home).toContain("loadBoundedCommunityHistory({")
    expect(home).toContain("relayFilters,")
    expect(home).toContain("localFilters: filters")
    expect(home).toContain("roomRootsComplete = result.complete")
    expect(home).toContain("rooms.length > 0 && roomRootsIncomplete")
    expect(home).toContain("Room history is incomplete; some rooms may be missing.")
    expect(home).toContain("onclick={retryRoomHistory}")
    expect(menu).toContain("const roomFilters = $derived(roomFilterPlan.localFilters)")
  })

  it("uses broad thread feeds and hydration with author-qualified projections", () => {
    const list = readProjectFile("../../routes/c/[community]/threads/+page.svelte")
    const detail = readProjectFile("../../routes/c/[community]/threads/[thread]/+page.svelte")

    expect(list).toContain("relayFilters: feedRelayFilters")
    expect(list).toContain('feedLoadStatus = complete ? "complete" : "incomplete"')
    expect(list).toContain("threadAuthorPubkeys.includes(event.pubkey)")
    expect(list).toContain("replyAuthorPubkeys.includes(event.pubkey)")
    expect(detail).toContain("const threadFilters = $derived(threadFilterPlan.localFilters)")
    expect(detail).toContain("const replyFilters = $derived(replyFilterPlan.localFilters)")
    expect(detail).toContain("loadBoundedCommunityHistory({")
    expect(detail).toContain("relayFilters,")
    expect(detail).toContain("localFilters,")
    expect(detail).toContain('threadLoadStatus = result.complete ? "complete" : "incomplete"')
    expect(detail).toContain("threadAuthorPubkeys.includes(event.pubkey)")
    expect(detail).toContain("replyAuthorPubkeys.includes(event.pubkey)")
    expect(detail).toContain("Reply history is incomplete; some replies may be missing.")
    expect(detail).not.toContain(
      'replies.length === 0 && (threadLoadStatus === "incomplete" || threadLoadStatus === "failed")',
    )
  })

  it("uses broad room lookup, message feed, and hash recovery with local admission", () => {
    const room = readProjectFile("../../routes/c/[community]/rooms/[room]/+page.svelte")

    expect(room).toContain("const roomFilters = $derived(roomFilterPlan.localFilters)")
    expect(room).toContain("const messageFilters = $derived(messageFilterPlan.localFilters)")
    expect(room).toContain("filters: roomRelayFilters")
    expect(room).toContain("relayFilters: messageRelayFilters")
    expect(room).toContain("filters: relayFilters")
    expect(room).toContain("matchFilters(localFilters, cachedTarget)")
    expect(room).toContain("matchFilters(localFilters, event)")
    expect(room).toContain('feedLoadStatus = complete ? "complete" : "incomplete"')
  })

  it("uses bounded direct repository history while retaining targeted exact loads", () => {
    const communityGit = readProjectFile("../../routes/c/[community]/git/+page.svelte")
    const globalGit = readProjectFile("../../routes/git/+page.svelte")

    expect(communityGit).toContain("loadBoundedCommunityHistory({")
    expect(communityGit).toContain("relayFilters,")
    expect(communityGit).toContain("localFilters,")
    expect(communityGit).toContain("filters: filters as any")
    expect(communityGit).toContain("Repository history is incomplete")
    expect(communityGit).toContain("onclick={retryDirectRepoHistory}")
    expect(communityGit.indexOf("Repository history is incomplete")).toBeLessThan(
      communityGit.indexOf("{#each repos as repo"),
    )
    expect(globalGit).toContain("loadBoundedCommunityHistory({")
    expect(globalGit).toContain("relayFilters,")
    expect(globalGit).toContain("localFilters,")
    expect(globalGit).toContain("communityRepoHistoryIncomplete = !result.complete")
    expect(globalGit).toContain("Community repository history is incomplete")
    expect(globalGit).toContain("onclick={retryCommunityRepoHistory}")
    expect(globalGit.indexOf("Community repository history is incomplete")).toBeLessThan(
      globalGit.indexOf("{:else if hasRenderedRepoCardsForCurrentScope}"),
    )
  })
})
