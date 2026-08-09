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
    expect(commands).toContain('preview: "rollback-on-failure"')
    expect(repoCollection).not.toContain("publishReactionOperation")
    expect(repoCollection).not.toContain("publishReactionDeleteOperation")
  })
})
