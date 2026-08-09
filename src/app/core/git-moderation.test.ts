import {describe, expect, it} from "vitest"
import {REPORT, type TrustedEvent} from "@welshman/util"
import {
  getHiddenRepoEventIds,
  getOwnerSpamReportTargetId,
  getReportReason,
} from "./git-moderation"

const owner = "a".repeat(64)
const outsider = "b".repeat(64)
const target = "c".repeat(64)

const makeReport = (pubkey: string, tags: string[][]): TrustedEvent =>
  ({
    id: `${pubkey.slice(0, 8)}${tags.length}`.padEnd(64, "0"),
    kind: REPORT,
    pubkey,
    created_at: 1,
    content: "",
    tags,
    sig: "d".repeat(128),
  }) as TrustedEvent

describe("repository spam moderation", () => {
  it("reads reasons from both supported e-tag positions", () => {
    expect(getReportReason(["e", target, "spam"])).toBe("spam")
    expect(getReportReason(["e", target, "wss://relay.example", "SPAM"])).toBe("spam")
    expect(getReportReason(["e", target, "wss://relay.example"])).toBe("")
  })

  it("accepts only owner-authored spam reports", () => {
    expect(getOwnerSpamReportTargetId(makeReport(owner, [["e", target, "spam"]]), owner)).toBe(
      target,
    )
    expect(
      getOwnerSpamReportTargetId(makeReport(outsider, [["e", target, "spam"]]), owner),
    ).toBe("")
    expect(getOwnerSpamReportTargetId(makeReport(owner, [["e", target, "illegal"]]), owner)).toBe(
      "",
    )
  })

  it("collects only targets hidden by the repository owner", () => {
    const hidden = getHiddenRepoEventIds(
      [
        makeReport(owner, [["e", target, "spam"]]),
        makeReport(outsider, [["e", "e".repeat(64), "spam"]]),
      ],
      owner,
    )

    expect(hidden).toEqual(new Set([target]))
  })
})
