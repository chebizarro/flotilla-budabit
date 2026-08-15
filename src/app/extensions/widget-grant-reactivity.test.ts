import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("widget grant reactivity contracts", () => {
  it("keeps the launcher runtime provider host-only and resolves it per bridge request", () => {
    const types = readProjectFile("./types.ts")
    const bridge = readProjectFile("./bridge.ts")
    const frame = readProjectFile("../components/WidgetFrame.svelte")
    const home = readProjectFile("../components/community/CommunityHomeWidgetSlot.svelte")
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
    expect(home).toContain("getCommunitySectionAuthorityPubkeys")
    expect(home).not.toContain("getSectionAuthorityPubkeysWithPendingRefs")
    expect(modal).toContain("{communityRuntimeContextProvider}")
    expect(launcher).toContain("communityRuntimeContextProvider: getCurrentCommunityRuntimeContext")
    expect(launcher).not.toContain("...(communityRuntimeContext ? {communityRuntimeContext} : {})")
  })

  it("keys home and prompt curation by current permission evidence", () => {
    const home = readProjectFile("../components/community/CommunityHomeWidgetSlot.svelte")
    const prompt = readProjectFile("../components/community/CommunityExtensionsPrompt.svelte")

    for (const source of [home, prompt]) {
      expect(source).toContain("getCommunityWidgetCurationEvidenceKey")
      expect(source).toContain("definitionEventId: definition.event.id")
      expect(source).toContain("evidenceKey: evidence.key")
      expect(source).toContain("profileListEvents: evidence.profileListEvents")
      expect(source).toContain("reportState: evidence.reportState")
      expect(source).toContain("lastLoadEvidenceKey !== evidence.key")
    }

    expect(home).toContain(
      'getLastValidatedCommunityCuratedWidgets(input, $pubkey || "", evidence.key)',
    )
    expect(home).not.toContain("getLastValidatedCommunityCuratedWidgets(initialCurationInput)")
  })

  it("keeps shared-config retries reactive to the relay-load effect", () => {
    const home = readProjectFile("../components/community/CommunityHomeWidgetSlot.svelte")
    const relayLoad = home.indexOf("loadCommunityEventsWithStatus(")
    const relayLoadEffect = home.lastIndexOf("$effect(() => {", relayLoad)

    expect(relayLoad).toBeGreaterThan(-1)
    expect(relayLoadEffect).toBeGreaterThan(-1)
    expect(home.slice(relayLoadEffect, relayLoad)).toContain("void loadRefreshNonce")
  })
})
