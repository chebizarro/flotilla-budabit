import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const source = readFileSync(
  new URL("../../routes/people/[profile]/+page.svelte", import.meta.url),
  "utf8",
)
const communitySection = source.slice(source.indexOf("Communities"), source.indexOf("Repositories"))

describe("people profile exact community UI", () => {
  it("discovers and preserves exact kind 32222 definitions by address", () => {
    expect(source).toContain("COMMUNITY_DEFINITION_KIND_V2")
    expect(source).toContain("selectCurrentCommunityDefinitionsV2")
    expect(source).toMatch(
      /kinds:\s*\[COMMUNITY_DEFINITION_KIND_V2\],\s*authors:\s*\[targetPubkey\]/,
    )
    expect(source).toMatch(/kinds:\s*\[COMMUNITY_DEFINITION_KIND_V2\],\s*"#a":\s*\[address\]/)
    expect(communitySection).toContain("(ref.address)")
    expect(communitySection).not.toContain("(ref.communityPubkey)")
  })

  it("navigates exact naddr cards and renders community definition metadata", () => {
    expect(communitySection).toContain("makeExactCommunityPath(ref.definition.pointer)")
    expect(communitySection).toContain("ref.definition.metadata.name")
    expect(communitySection).toContain("ref.definition.metadata.picture")
    expect(communitySection).not.toContain("<ProfileCircle")
    expect(communitySection).not.toContain("<ProfileName")
  })

  it("does not present bounded relay discovery as complete", () => {
    expect(communitySection).toContain("Community discovery is bounded and may be incomplete.")
  })
})
