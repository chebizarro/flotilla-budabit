import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("canonical community home contracts", () => {
  const home = readProjectFile("../../routes/c/[community]/+page.svelte")
  const communityLayout = readProjectFile("../../routes/c/[community]/+layout.svelte")
  const gitLayout = readProjectFile("../../routes/git/+layout.svelte")
  const topMenu = readProjectFile("../components/TopMenuWidgets.svelte")
  const homeSlot = readProjectFile("../components/community/CommunityHomeWidgetSlot.svelte")
  const launchers = readProjectFile("../components/community/CommunityWidgetSlotLaunchers.svelte")

  it("uses the active exact pointer instead of reparsing a legacy community identity", () => {
    for (const source of [home, topMenu, homeSlot, launchers]) {
      expect(source).toContain("activeExactCommunityPointer")
      expect(source).not.toContain("parseCommunityRouteParam")
    }

    expect(home).not.toContain("parseExactCommunityRouteParam")
    expect(topMenu).toContain("$activeExactCommunityPointer")
  })

  it("keeps navigation and home catalog ownership on the exact address", () => {
    expect(home).toContain("makeExactCommunityThreadPath(communityPointer)")
    expect(home).toMatch(/makeExactCommunityRoomPath\(communityPointer!?, room\.id\)/)
    expect(home).toMatch(/communityAddress: communityPointer!?\.address/)
    expect(home).toContain("owner: `community-home-rooms:${catalog.communityAddress}`")
    expect(home).not.toContain("makeCommunityThreadPath(")
    expect(home).not.toContain("makeCommunityRoomPath(")
  })

  it("preserves the established community menu on community and Git routes", () => {
    for (const source of [communityLayout, gitLayout]) {
      expect(source).toContain('import CommunityMenu from "@app/components/CommunityMenu.svelte"')
      expect(source).toContain("<CommunityMenu community={")
      expect(source).not.toContain("CommunityLegacyMenu")
    }
  })

  it("binds widget catalogs, modal context, and runtime authority to one exact pointer", () => {
    for (const source of [homeSlot, launchers]) {
      expect(source).toContain("$activeExactCommunityPointer?.address === communityAddress")
      expect(source).toContain("community: exactCommunity")
      expect(source).toContain("address: exactCommunity.address")
      expect(source).toContain("ownerPubkey: exactCommunity.ownerPubkey")
      expect(source).toContain("communityId: exactCommunity.communityId")
    }

    expect(homeSlot).toContain("communityRuntimeContext")
    expect(homeSlot).not.toContain("legacyAuthorizedPubkeys")
    expect(launchers).toContain("communityRuntimeContextProvider")
  })

  it("keeps community presentation metadata separate from owner profiles", () => {
    const admin = readProjectFile("../../routes/c/[community]/admin/+page.svelte")

    expect(home).not.toContain("deriveProfile")
    expect(home).toContain("routeCommunityDefinition?.metadata.name")
    expect(home).toContain("routeCommunityDefinition?.metadata.description")
    expect(home).toContain("routeCommunityDefinition?.metadata.picture")

    for (const source of [homeSlot, launchers]) {
      expect(source).not.toContain("deriveProfile")
      expect(source).not.toContain("ownerProfile")
    }

    expect(admin).toContain("const ownerProfileStore = $derived(")
    expect(admin).toContain("getStore(ownerProfileStore)")
    expect(admin).toContain("profile={ownerProfile}")
    expect(admin).toContain("community owner pubkey")
    expect(admin).not.toContain("this community pubkey")
  })
})
