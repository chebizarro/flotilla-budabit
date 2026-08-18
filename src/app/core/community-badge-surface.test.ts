import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("exact community badge surface contracts", () => {
  it("retains the route pointer in badge component and naddr navigation payloads", () => {
    const route = readProjectFile("../../routes/c/[community]/badges/+page.svelte")

    expect(route).toContain("<CommunityBadgeAwardForm community={routeCommunity}")
    expect(route).toContain("<CommunityMenuButton community={routeCommunity.naddr}")
    expect(route).not.toContain("<CommunityMenuButton community={communityControllerPubkey}")
  })

  it("keys badge retries and stored Blossom upload context by exact definition address", () => {
    const route = readProjectFile("../../routes/c/[community]/badges/+page.svelte")
    const awardForm = readProjectFile("../components/CommunityBadgeAwardForm.svelte")

    expect(route).toContain("const communityAddress = routeCommunity?.address")
    expect(route).toContain('blossomContext: {type: "badge", communityAddress}')
    expect(route).not.toContain('blossomContext: {type: "badge", communityPubkey:')
    expect(awardForm).toContain("communityAddress: community.address")
    expect(awardForm).toContain("community: CommunityPointer")
  })
})
