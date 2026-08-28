import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {
  GIT_DELETION_KINDS,
  classifyGitDeleteEvent,
  mergePlannedDeleteTarget,
  sortPlannedDeleteTargets,
  type GitDeletionContext,
} from "./git-deletion-policy"

const owner = "a".repeat(64)
const outsider = "b".repeat(64)
const repo = `30617:${owner}:project`
let sequence = 0
const event = (
  kind: number,
  tags: string[][] = [],
  pubkey = owner,
  extra: Partial<TrustedEvent> = {},
): TrustedEvent => ({
  id: String(++sequence).padStart(64, "0"),
  pubkey,
  kind,
  tags,
  created_at: 10,
  content: "",
  sig: "c".repeat(128),
  ...extra,
})

const issue = event(GIT_DELETION_KINDS.issue, [["a", repo]])
const issueContext: GitDeletionContext = {
  rootType: "issue",
  root: issue,
  repositoryAddress: repo,
  ownerPubkey: owner,
}
const reasonOf = (result: ReturnType<typeof classifyGitDeleteEvent>) =>
  result.disposition === "included" ? undefined : result.reason

describe("Git deletion policy", () => {
  it("allows an issue author to delete their events in another owner's repository", () => {
    const repositoryAddress = `30617:${"d".repeat(64)}:project`
    const authoredIssue = event(GIT_DELETION_KINDS.issue, [["a", repositoryAddress]])
    const result = classifyGitDeleteEvent(
      {
        rootType: "issue",
        root: authoredIssue,
        repositoryAddress,
        ownerPubkey: authoredIssue.pubkey,
      },
      event(GIT_DELETION_KINDS.label, [["e", authoredIssue.id]]),
    )

    expect(result.disposition).toBe("included")
  })

  it("classifies every issue secondary policy row and keeps the required root last", () => {
    const candidates = [
      [GIT_DELETION_KINDS.label, [["e", issue.id]], "label"],
      [GIT_DELETION_KINDS.coverLetter, [["e", issue.id]], "cover-letter"],
      [GIT_DELETION_KINDS.statusOpen, [["e", issue.id]], "status"],
      [GIT_DELETION_KINDS.statusAppliedOrComplete, [["e", issue.id]], "status"],
      [GIT_DELETION_KINDS.statusClosed, [["e", issue.id]], "status"],
      [GIT_DELETION_KINDS.statusDraft, [["e", issue.id]], "status"],
      [GIT_DELETION_KINDS.comment, [["E", issue.id]], "comment"],
      [GIT_DELETION_KINDS.comment, [["e", issue.id]], "comment"],
    ] as const
    const targets = candidates.map(([kind, tags, relation]) => {
      const result = classifyGitDeleteEvent(
        issueContext,
        event(
          kind,
          tags.map(tag => [...tag]),
        ),
        1,
        "wss://one",
      )
      expect(result.disposition).toBe("included")
      if (result.disposition !== "included") throw new Error("not included")
      expect(result.target.relation).toBe(relation)
      return result.target
    })
    const root = classifyGitDeleteEvent(issueContext, issue)
    if (root.disposition !== "included") throw new Error("root not included")
    expect(sortPlannedDeleteTargets([root.target, ...targets]).at(-1)?.policy).toBe("required")
  })

  it("supports PR updates through modern E and legacy direct e only", () => {
    const pullRequest = event(GIT_DELETION_KINDS.pullRequest, [["a", repo]])
    const context = {...issueContext, rootType: "pull-request" as const, root: pullRequest}
    for (const tag of ["E", "e"]) {
      const result = classifyGitDeleteEvent(
        context,
        event(GIT_DELETION_KINDS.pullRequestUpdate, [[tag, pullRequest.id]]),
      )
      expect(result.disposition === "included" && result.target.relation).toBe("pr-update")
    }
    expect(
      reasonOf(
        classifyGitDeleteEvent(context, event(GIT_DELETION_KINDS.comment, [["e", "parent"]])),
      ),
    ).toBe("nested-legacy-comment")
    expect(
      reasonOf(
        classifyGitDeleteEvent(
          context,
          event(GIT_DELETION_KINDS.comment, [
            ["E", pullRequest.id],
            ["E", "other"],
          ]),
        ),
      ),
    ).toBe("conflicting-root-reference")
  })

  it("matches canonical statuses with multiple e references or the repository address", () => {
    for (const tags of [
      [
        ["e", "parent"],
        ["e", issue.id],
      ],
      [["a", repo]],
    ]) {
      const result = classifyGitDeleteEvent(
        issueContext,
        event(GIT_DELETION_KINDS.statusOpen, tags),
      )
      expect(result.disposition).toBe("included")
    }
  })

  it("rejects foreign, conflicting repository, unsafe addressable, and malformed reaction events", () => {
    expect(
      classifyGitDeleteEvent(issueContext, event(1985, [["e", issue.id]], outsider)).disposition,
    ).toBe("foreign")
    expect(
      reasonOf(
        classifyGitDeleteEvent(
          issueContext,
          event(1985, [
            ["e", issue.id],
            ["a", `30617:${owner}:other`],
          ]),
        ),
      ),
    ).toBe("conflicting-repository-reference")
    for (const kind of [30410, 30411, 30412]) {
      expect(reasonOf(classifyGitDeleteEvent(issueContext, event(kind, [["d", ""]])))).toBe(
        "unsupported-address-kind",
      )
    }
    expect(
      reasonOf(
        classifyGitDeleteEvent(
          issueContext,
          event(7, [
            ["e", issue.id],
            ["e", "other"],
          ]),
        ),
      ),
    ).toBe("invalid-reaction-target")
    expect(
      reasonOf(
        classifyGitDeleteEvent(
          issueContext,
          event(7, [
            ["e", issue.id],
            ["k", "1618"],
          ]),
        ),
      ),
    ).toBe("reaction-kind-mismatch")
    expect(
      classifyGitDeleteEvent(
        issueContext,
        event(7, [
          ["e", issue.id],
          ["k", "1621"],
        ]),
      ).disposition,
    ).toBe("included")
  })

  it("validates repository authority and collapses address versions by DeleteKey", () => {
    const root = event(30617, [["d", "project"]], owner, {created_at: 5})
    const context: GitDeletionContext = {
      rootType: "repository",
      root,
      repositoryAddress: repo,
      ownerPubkey: owner,
    }
    const oldState = event(30618, [["d", "project"]], owner, {created_at: 10})
    const newState = event(30618, [["d", "project"]], owner, {created_at: 20})
    const first = classifyGitDeleteEvent(context, oldState, 1, "wss://one")
    const second = classifyGitDeleteEvent(context, newState, 2, "wss://two")
    if (first.disposition !== "included" || second.disposition !== "included")
      throw new Error("state not included")
    const targets = new Map()
    mergePlannedDeleteTarget(targets, first.target)
    mergePlannedDeleteTarget(targets, second.target)
    expect([...targets.values()]).toEqual([
      expect.objectContaining({
        key: `a:30618:${owner}:project`,
        event: newState,
        sourceRound: 1,
        sourceRelays: ["wss://one", "wss://two"],
      }),
    ])
    expect(
      reasonOf(classifyGitDeleteEvent(context, event(30618, [["d", "project"]], outsider))),
    ).toBe("invalid-address")
    expect(reasonOf(classifyGitDeleteEvent(issueContext, event(42, [["e", issue.id]])))).toBe(
      "unsupported-kind",
    )
    expect(
      classifyGitDeleteEvent(
        {...context, repositoryAddresses: [`30617:${outsider}:project`]},
        root,
      ),
    ).toMatchObject({disposition: "unsupported", reason: "invalid-address"})
  })
})
