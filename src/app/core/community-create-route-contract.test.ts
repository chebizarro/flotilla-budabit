import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const source = readFileSync(
  new URL("../../routes/explore/create-community/+page.svelte", import.meta.url),
  "utf8",
)

describe("community create route contract", () => {
  it("delegates a resumable operation-scoped create flow to the controller", () => {
    expect(source).toContain("<CommunityCreate {operationId} />")
    expect(source).toContain('$page.url.searchParams.get("operation")')
    expect(source).toContain('url.searchParams.set("operation", operationId)')
    expect(source).toContain("replaceState(url, $page.state)")
    expect(source).not.toContain("loadCommunityDefinitionWithOutboxFallback")
    expect(source).not.toContain("communityAdminDefinitionEvents")
    expect(source).not.toContain("existingCommunity")
    expect(source).not.toContain("already has a community")
    expect(source).not.toContain("can only own one community")
  })
})
