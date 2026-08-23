import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const menu = readFileSync("src/app/components/CommunityMenu.svelte", "utf8")
const layout = readFileSync("src/routes/c/[community]/+layout.svelte", "utf8")

describe("community menu evidence ownership", () => {
  it("keeps inline evidence behind route admission without frame-only release", () => {
    expect(layout).toContain("evidenceReady={communityMaintenanceAdmission.menu}")
    expect(menu).toContain("const remoteEvidenceReady = $derived(evidenceReady || replaceState)")
    expect(menu).not.toContain("waitForPostPaintHydration")
    expect(menu).not.toContain("menuBackgroundHydrationReady")
  })

  it("uses drawer interaction as immediate evidence demand", () => {
    expect(menu).toContain('replaceState = Boolean(element?.closest(".drawer"))')
    expect(menu).toContain("evidenceReady = true")
  })

  it("requires a viewer for personal evidence and capability for moderation evidence", () => {
    expect(menu.match(/!remoteEvidenceReady \|\| !canModerate/g)).toHaveLength(2)
    expect(menu).toContain("if (!remoteEvidenceReady || !$pubkey) return")
    expect(menu).toContain("...(canModerate ? admissionResponseFilters : [])")
  })
})
