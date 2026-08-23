import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const source = readFileSync("src/routes/c/[community]/+layout.svelte", "utf8")

describe("community layout request lifecycle", () => {
  it("guards every finite request terminal path by controller identity", () => {
    expect(source.match(/communityHistoryLoadController !== controller/g)).toHaveLength(2)
    expect(source.match(/communityFollowUpLoadController !== controller/g)).toHaveLength(2)
    expect(source.match(/communityDeleteLoadController !== controller/g)).toHaveLength(2)
  })

  it("keeps aborts quiet and schedules retryable failures", () => {
    expect(source).toContain(
      "controller.signal.aborted || communityHistoryLoadController !== controller",
    )
    expect(source).toContain(
      "controller.signal.aborted || communityFollowUpLoadController !== controller",
    )
    expect(source).toContain(
      "controller.signal.aborted || communityDeleteLoadController !== controller",
    )
    expect(source).toContain("communityHistoryRetryVersion += 1")
    expect(source).toContain("communityFollowUpRetryVersion += 1")
    expect(source).toContain("communityDeleteRetryVersion += 1")
  })
})
