import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const source = readFileSync(new URL("./community-alerts-state.ts", import.meta.url), "utf8")
const syncSource = readFileSync(new URL("./sync.ts", import.meta.url), "utf8")

describe("community alert state boundaries", () => {
  it("uses dedicated settings without Git delivery synchronization", () => {
    expect(source).toContain("COMMUNITY_ALERTS_SETTINGS_DTAG")
    expect(source).toContain("saveCommunityAlertDeliveryProfile")
    expect(source).not.toContain("publishEmailDigestSettings")
    expect(source).not.toContain("userEmailDigestSettings")
    expect(source).not.toContain("userRepoWatch")
    expect(source).not.toContain("repositories:")
  })

  it("guards signer identity around async cryptographic and persistence work", () => {
    expect(source).toContain("captureSession")
    expect(source).toContain("assertSessionActive(session)")
    expect(source).toContain("session.currentSigner.nip44.encrypt")
    expect(source).toContain("session.currentSigner.nip44.decrypt")
    expect(source).toContain("session.currentSigner.sign")
    expect(source).toContain("hydrateCommunityAlertSettings(session.userPubkey, {force: true})")
    expect(source).toContain("await hydrateCommunityPreferences()")
    expect(source).toContain("item?.sourceVersion === 1")
    expect(source).toContain(
      "publishSettingsForSession(session, item.values, item.event.created_at)",
    )
    expect(source).toContain("lastDeletionCreatedAt")
  })

  it("hydrates the encrypted aggregate from application sync", () => {
    expect(syncSource).toContain("hydrateCommunityAlertSettings")
    expect(syncSource).toContain("[community-alerts] Failed to hydrate encrypted settings")
  })
})
