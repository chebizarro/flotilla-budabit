import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("deletion UI copy contracts", () => {
  it("describes Git event deletion scope without promising erasure", () => {
    const issue = readProjectFile("../components/IssueDeleteConfirm.svelte")
    const pullRequest = readProjectFile("../components/PullRequestDeleteConfirm.svelte")
    const event = readProjectFile("../components/EventDeleteConfirm.svelte")

    expect(issue).toContain(
      "labels, description edits, statuses, direct-root comments, and reactions",
    )
    expect(issue).toContain("nested legacy replies, and unsupported metadata will remain")
    expect(pullRequest).toContain(
      "updates, labels, description edits, statuses, direct-root comments, and reactions",
    )
    expect(pullRequest).toContain("nested legacy replies, and unsupported metadata will remain")
    expect(event).toContain("Replies, reactions, and other related events will remain")
    expect(event).toContain("deletion request acknowledged by a relay")
  })

  it("describes repository deletion as scoped and potentially partial", () => {
    const modal = readProjectFile("../components/DeleteRepoConfirm.svelte")
    const settings = readProjectFile(
      "../../../packages/nostr-git-ui/src/lib/components/git/EditRepoPanel.svelte",
    )

    expect(modal).toContain("Deletion may be partial and cannot be undone")
    expect(modal).toContain("Foreign events, nested legacy replies, repository stars")
    expect(modal).toContain("unsafe addressable metadata are not targeted")
    expect(modal).toContain("announcement is requested last")
    expect(modal).toContain("No remote code hosts were found")
    expect(modal).toContain("remove the local clone")
    expect(modal).not.toContain("Only Nostr events will be deleted")
    expect(settings).toContain("Request deletion of supported Nostr events")
    expect(settings).not.toContain("Delete this repository and its related Nostr events")
  })

  it("does not promise effective community-state removal", () => {
    const access = readProjectFile("../../routes/c/[community]/access/+page.svelte")
    const badges = readProjectFile("../../routes/c/[community]/badges/+page.svelte")
    const moderation = readProjectFile("../components/community/ModerationReportCard.svelte")

    expect(access).toContain("an older submission may become active")
    expect(access).not.toContain("You can now submit a revised application")
    expect(badges).toContain("An older award may become active")
    expect(badges).not.toContain("Badge award revoked")
    expect(moderation).toContain("only if no other active report hides it")
    expect(moderation).not.toContain("Event uncensored")
    expect(moderation).not.toContain("Person unbanned")
  })

  it("identifies relay-admin removal as a single-relay action", () => {
    const reportMenu = readProjectFile("../components/ReportMenu.svelte")

    expect(reportMenu).toContain('title: "Remove Content From Relay"')
    expect(reportMenu).toContain("Copies on other relays and related events will remain")
    expect(reportMenu).toContain("Content removed from this relay")
    expect(reportMenu).not.toContain("successfully been deleted")
  })

  it("limits PR deletion to its author and interpolates the reset repository name", () => {
    const pullRequest = readProjectFile("../components/PRView.svelte")
    const reset = readProjectFile("../components/ResetRepoConfirm.svelte")

    expect(pullRequest).toContain("$pubkey === prEvent.pubkey")
    expect(pullRequest).not.toContain(
      "$pubkey && ($pubkey === prEvent.pubkey || $pubkey === repoOwnerPubkey)",
    )
    expect(reset).toContain("local repository '${repoName}'")
    expect(reset).not.toContain("local repository '{repoName}'")
  })
})
