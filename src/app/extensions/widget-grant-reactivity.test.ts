import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("widget grant reactivity contracts", () => {
  it("keeps the launcher runtime provider host-only and resolves it per bridge request", () => {
    const types = readProjectFile("./types.ts")
    const bridge = readProjectFile("./bridge.ts")
    const frame = readProjectFile("../components/WidgetFrame.svelte")
    const home = readProjectFile("../components/community/CommunityHomeWidgetSlot.svelte")
    const recovery = readProjectFile("../components/community/CommunityHomeWidgetRecovery.svelte")
    const modal = readProjectFile("../components/WidgetModal.svelte")
    const launcher = readProjectFile("../components/community/CommunityWidgetSlotLaunchers.svelte")

    expect(types).toContain("communityRuntimeContextProvider?: () =>")
    expect(bridge).toContain(
      "if (ext.communityRuntimeContextProvider) return ext.communityRuntimeContextProvider()",
    )
    expect(frame).toContain("communityRuntimeContextProvider?: () =>")
    expect(frame).toContain("communityRuntimeContextProvider: communityRuntimeContextProvider")
    expect(frame).toContain("delete publicContext.communityRuntimeContext")
    expect(types).toContain("authorityEvidenceSettled?: boolean")
    expect(home).toContain("authorityEvidenceSettled: true")
    expect(recovery).toContain("getCommunitySectionAuthorityPubkeys")
    expect(recovery).not.toContain("getSectionAuthorityPubkeysWithPendingRefs")
    expect(modal).toContain("{communityRuntimeContextProvider}")
    expect(launcher).toContain("communityRuntimeContextProvider: getCurrentCommunityRuntimeContext")
    expect(launcher).not.toContain("...(communityRuntimeContext ? {communityRuntimeContext} : {})")
    expect(launcher).toContain("isCommunityDescriptorReady(descriptor, community.address)")
    expect(launcher).toContain("{#if communityReady && slotWidgets.length > 0}")
  })

  it("keys home and prompt curation by current permission evidence", () => {
    const recovery = readProjectFile("../components/community/CommunityHomeWidgetRecovery.svelte")
    const prompt = readProjectFile("../components/community/CommunityExtensionsPrompt.svelte")

    for (const source of [recovery, prompt]) {
      expect(source).toContain("getCommunityWidgetCurationEvidenceKey")
      expect(source).toContain("definitionEventId: definition.event.id")
      expect(source).toContain("evidenceKey: evidence.key")
      expect(source).toContain("profileListEvents: evidence.profileListEvents")
      expect(source).toContain("reportState: evidence.reportState")
    }

    expect(recovery).toContain("lastEvidenceKey !== evidence.key")
    expect(prompt).toContain("lastLoadEvidenceKey !== evidence.key")
    expect(recovery).toContain(
      'getLastValidatedCommunityCuratedWidgets(input, $pubkey || "", evidence.key)',
    )
    expect(recovery).not.toContain("getLastValidatedCommunityCuratedWidgets(initialCurationInput)")
  })

  it("keeps shared-config retries reactive to the relay-load effect", () => {
    const recovery = readProjectFile("../components/community/CommunityHomeWidgetRecovery.svelte")
    const relayLoad = recovery.indexOf("loadCommunityEventsWithStatus(")
    const relayLoadEffect = recovery.lastIndexOf("$effect(() => {", relayLoad)

    expect(relayLoad).toBeGreaterThan(-1)
    expect(relayLoadEffect).toBeGreaterThan(-1)
    expect(recovery.slice(relayLoadEffect, relayLoad)).toContain("void refreshNonce")
  })

  it("keeps remote recovery and page lifecycle ownership out of each slot", () => {
    const page = readProjectFile("../../routes/c/[community]/+page.svelte")
    const home = readProjectFile("../components/community/CommunityHomeWidgetSlot.svelte")
    const recovery = readProjectFile("../components/community/CommunityHomeWidgetRecovery.svelte")

    expect(page.match(/<CommunityHomeWidgetRecovery/g)).toHaveLength(1)
    expect(page.match(/recovery=\{\$homeWidgetRecovery\}/g)).toHaveLength(2)
    expect(page).toMatch(
      /\{#key communityPointer\.address\}[\s\S]*<CommunityHomeWidgetRecovery[\s\S]*\{\/key\}/,
    )
    expect(recovery).toContain("loadCachedCommunityCuratedWidgets(")
    expect(recovery).toContain("loadCommunityEventsWithStatus(")
    expect(recovery).toContain('window.addEventListener("pageshow"')
    expect(home).not.toContain("loadCachedCommunityCuratedWidgets(")
    expect(home).not.toContain("loadCommunityEventsWithStatus(")
    expect(home).not.toContain("window.addEventListener(")
  })
})
