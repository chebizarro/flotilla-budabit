import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("reaction publication source contracts", () => {
  it("routes ordinary reaction creation through publication operations", () => {
    const publishers = [
      "../components/ThreadActions.svelte",
      "../components/RoomItem.svelte",
      "../components/RepoFeedGitItem.svelte",
      "../components/PRView.svelte",
      "../components/NoteItem.svelte",
      "../components/GoalActions.svelte",
      "../components/EventActions.svelte",
      "../components/CommentActions.svelte",
      "../components/ChannelMessage.svelte",
      "../components/CalendarEventActions.svelte",
      "../components/ChannelMessageMenuMobile.svelte",
      "../components/ChannelMessageEmojiButton.svelte",
      "../components/RoomItemMenuMobile.svelte",
      "../components/RoomItemEmojiButton.svelte",
      "../../routes/git/[id=naddr]/issues/[issueid]/+page.svelte",
      "../../routes/git/[id=naddr]/commits/[commitid]/+page.svelte",
    ]

    for (const publisher of publishers) {
      const source = readProjectFile(publisher)
      expect(source, publisher).toContain("publishReactionOperation(")
      expect(source, publisher).not.toMatch(/\bpublishReaction\(/)
    }
  })

  it("routes exact reaction deletes through rollback operations", () => {
    const publishers = [
      "../components/ThreadActions.svelte",
      "../components/RoomItem.svelte",
      "../components/RepoFeedGitItem.svelte",
      "../components/PRView.svelte",
      "../components/NoteItem.svelte",
      "../components/GoalActions.svelte",
      "../components/CommentActions.svelte",
      "../components/ChannelMessage.svelte",
      "../components/CalendarEventActions.svelte",
      "../../routes/git/[id=naddr]/issues/[issueid]/+page.svelte",
      "../../routes/git/[id=naddr]/commits/[commitid]/+page.svelte",
    ]

    for (const publisher of publishers) {
      expect(readProjectFile(publisher), publisher).toContain("publishReactionDeleteOperation(")
    }
  })

  it("centralizes rollback projection without classifying repository collection stars", () => {
    const summary = readProjectFile("../components/ReactionSummary.svelte")
    const commands = readProjectFile("./commands.ts")
    const repoCollection = readProjectFile("../components/RepoCollectButton.svelte")

    expect(summary).toContain("projectReactionOperations({")
    expect(summary).toContain("pendingSemanticKeys.has(semanticKey)")
    expect(summary).toContain("getReplyFilters([event]")
    expect(commands).toContain('preview: "rollback-on-failure"')
    expect(repoCollection).not.toContain("publishReactionOperation")
    expect(repoCollection).not.toContain("publishReactionDeleteOperation")
  })

  it("keeps calendar reaction transport on community-definition relays", () => {
    const listRoute = readProjectFile("../../routes/c/[community]/calendar/+page.svelte")
    const detailRoute = readProjectFile("../../routes/c/[community]/calendar/[event]/+page.svelte")
    const item = readProjectFile("../components/CalendarEventItem.svelte")
    const actions = readProjectFile("../components/CalendarEventActions.svelte")
    const eventActions = readProjectFile("../components/EventActions.svelte")

    for (const route of [listRoute, detailRoute]) {
      expect(route).toContain("reactionRelays={$activeCommunityPublishRelays}")
      expect(route).toContain("$activeCommunityPublishRelays.length > 0")
      expect(route).toContain("reactionAllowedAuthors={reactionAuthorPubkeys}")
    }
    expect(item).toContain("{reactionRelays}")
    expect(actions).toContain("relays: reactionRelayTargets")
    expect(actions).toContain("operationRelays={reactionRelayTargets}")
    expect(actions).toContain("reactionRelays={reactionRelayTargets}")
    expect(eventActions).toContain("reactionRelays ?? relays")
    expect(actions).not.toContain(
      "publishReactionDeleteOperation({reaction, relays: actionRelays})",
    )
  })
})
