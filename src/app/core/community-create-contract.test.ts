import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("Communikeys create source contract", () => {
  it("routes create and edit through kind-32222 publication only", () => {
    const component = readProjectFile("../components/CommunityCreate.svelte")

    expect(component).toContain("createCommunity({")
    expect(component).toContain("operationId: communityCreateOperationId")
    expect(component).toContain("buildCommunityDefinition({")
    expect(component).toContain("updateCommunityDefinition(")
    expect(component).toContain("if (!isEdit) {")
    expect(component).toContain("await performCommunityCreate(validated, reportStatus)")
    expect(component).not.toContain("createProfile")
    expect(component).not.toMatch(/\bkind\s*:\s*0\b/)
    expect(component).not.toContain("makeCommunityNcommunity")
  })

  it("requires the exact active definition and retains exact readback/navigation", () => {
    const component = readProjectFile("../components/CommunityCreate.svelte")

    expect(component).toContain("activeExactCommunityDefinition")
    expect(component).toContain("validated.community.pubkey !== exactDefinition.ownerPubkey")
    expect(component).toContain("communityId: exactDefinition.communityId")
    expect(component).toContain("getNextReplacementCreatedAt([exactDefinition.event]")
    expect(component).toContain("parseCommunityDefinition(verifiedDefinition)")
    expect(component).toContain("goto(makeExactCommunityPath(parsedDefinition.pointer))")
  })

  it("initializes edit metadata only from the exact definition", () => {
    const component = readProjectFile("../components/CommunityCreate.svelte")
    const originalDraftState = component.slice(
      component.indexOf("const makeOriginalDraftState"),
      component.indexOf("const parseSectionDraftKind"),
    )

    expect(originalDraftState).not.toContain("communityProfile")
    expect(component).toContain("makeOriginalDraftState(definition)")
  })

  it("preserves unfamiliar valid services when rebuilding an edited definition", () => {
    const component = readProjectFile("../components/CommunityCreate.svelte")
    const editPublish = component.slice(
      component.indexOf("const performCommunitySettingsPublish"),
      component.indexOf("const cancel"),
    )

    expect(editPublish).toContain("...exactDefinition.services.filter(")
    expect(editPublish).toMatch(
      /service\s*=>\s*service\.name\s*!==\s*"email-digest"\s*&&\s*service\.name\s*!==\s*"community-alerts"/,
    )
  })

  it("evicts bootstrap state by exact definition address after create and edit", () => {
    const component = readProjectFile("../components/CommunityCreate.svelte")

    expect(component).toContain("clearCommunityBootstrapCache(parsedDefinition.pointer.address)")
    expect(component).toContain("clearCommunityBootstrapCache(exactDefinition.pointer.address)")
    expect(component).not.toContain("clearCommunityBootstrapCache(result.communityId)")
    expect(component).not.toContain("clearCommunityBootstrapCache(exactDefinition.communityId)")
  })

  it("does not gate creation on another community owned by the owner", () => {
    const component = readProjectFile("../components/CommunityCreate.svelte")
    const page = readProjectFile("../../routes/explore/create-community/+page.svelte")

    expect(component).not.toContain("ensureCreateAllowed")
    expect(component).not.toContain("already has a community")
    expect(page).toContain("<CommunityCreate {operationId} />")
    expect(page).not.toContain("existingCommunityDefinition")
  })
})
