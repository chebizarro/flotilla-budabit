import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const source = readFileSync(
  new URL("../../routes/settings/notifications/+page.svelte", import.meta.url),
  "utf8",
)
const profileSource = readFileSync(new URL("../components/Profile.svelte", import.meta.url), "utf8")
const profileCircleSource = readFileSync(
  new URL("../components/ProfileCircle.svelte", import.meta.url),
  "utf8",
)
const communityAlertSource = readFileSync(
  new URL("../components/CommunityAlertSettings.svelte", import.meta.url),
  "utf8",
)
const communityAlertCoreSource = readFileSync(
  new URL("./community-alerts.ts", import.meta.url),
  "utf8",
)

describe("email digest notification settings UI", () => {
  it("uses profile identity and recommendation evidence instead of pubkeys in provider options", () => {
    expect(source).toContain('import Profile from "@app/components/Profile.svelte"')
    expect(source).toContain("showPubkey")
    expect(profileSource).toContain("Copy profile npub")
    expect(source).toContain("Community evidence")
    expect(source).toContain("<InlinePopover")
    expect(source).toContain("selectedProviderProfileRelays")
    expect(source).toContain("hydratePubkeyProfiles")
    expect(source).toContain("selectEmailDigestProviderIdentity")
    expect(source).toContain("fallbackName={selectedProviderIdentity?.name")
    expect(profileSource).toContain("fallbackName?: string")
    expect(profileSource).toContain("fallbackPicture?: string")
    expect(profileCircleSource).toContain("fallbackSrc?: string")
    expect(source).not.toContain("provider.servicePubkey.slice")
    expect(source).not.toContain("endorsed by")
  })

  it("centers spinner content in notification action buttons", () => {
    expect(source.match(/\[&>span\]:min-h-0/g)?.length).toBeGreaterThanOrEqual(5)
    expect(source.match(/\[&>span\]:w-full/g)?.length).toBeGreaterThanOrEqual(3)
  })

  it("explains disabled digest actions and keeps status content responsive", () => {
    expect(source).toContain("digestDisabledReason")
    expect(source).toContain("Enter a valid delivery email before enabling this digest.")
    expect(source).toContain("max-w-full shrink-0 whitespace-normal break-words")
  })

  it("keeps email verification guidance on the page after a successful subscription", () => {
    expect(source).toContain("verificationRequired")
    expect(source).toContain("Verify your delivery email")
    expect(source).toContain("We sent a verification email")
    expect(source).toContain("I've verified, refresh status")
  })

  it("shows a verification CTA for each pending community registration", () => {
    expect(communityAlertSource).toContain('label === "Pending confirmation"')
    expect(communityAlertSource).toContain("Verify your community delivery email")
    expect(communityAlertSource).toContain("$userCommunityAlertDeliveryProfile.email")
    expect(communityAlertSource).toContain("I've verified, refresh status")
    expect(communityAlertSource).toContain("onclick={() => refresh(group)}")
  })

  it("mounts independent community alerts between in-app and Git forms", () => {
    expect(source).toContain(
      'import CommunityAlertSettings from "@app/components/CommunityAlertSettings.svelte"',
    )
    expect(source).toContain("<CommunityAlertSettings />")
    expect(source.indexOf("<CommunityAlertSettings />")).toBeGreaterThan(
      source.indexOf("Save in-app settings"),
    )
    expect(source.indexOf("<CommunityAlertSettings />")).toBeLessThan(
      source.indexOf("Git email digest"),
    )
    expect(communityAlertCoreSource).toContain(
      'COMMUNITY_ALERTS_SETTINGS_DTAG = "budabit/community-alerts-settings"',
    )
    expect(communityAlertSource).toContain("This profile is encrypted separately from Git")
    expect(communityAlertSource).toContain("Git providers keep their own delivery email")
  })

  it("exposes density, every Anchor boolean, statuses, and provider selection", () => {
    expect(communityAlertSource).toContain('setDensity(group.communityAddress, "compact")')
    expect(communityAlertSource).toContain('setDensity(group.communityAddress, "expanded")')
    for (const preference of [
      "engagement.replies",
      "engagement.mentions",
      "engagement.reactions",
      "engagement.zaps",
      "access.membership",
      "access.publishing",
      "access.moderatorRequests",
      "moderation.reports",
      "moderation.actions",
      "highlights.rooms",
      "highlights.threads",
      "highlights.calendar",
      "highlights.goals",
    ]) {
      expect(communityAlertSource).toContain(`draft.preferences.${preference}`)
    }
    for (const status of [
      "Pending confirmation",
      "Active",
      "Ineligible",
      "Suppressed",
      "Error",
      "Inactive",
    ]) {
      expect(communityAlertSource).toContain(status)
    }
    expect(communityAlertSource).toContain("choices.length > 1")
  })

  it("resets by identity, guards stale requests, and avoids raw orphan pubkeys", () => {
    expect(communityAlertSource).toContain("identityKey")
    expect(communityAlertSource).toContain("identitySigner")
    expect(communityAlertSource).toContain("requestGeneration")
    expect(communityAlertSource).toContain("isCurrentRequest")
    expect(communityAlertSource).toContain("Unavailable registrations")
    expect(communityAlertSource).toContain("title={group.communityAddress}")
    expect(communityAlertSource).not.toContain("communityPubkey.slice")
    expect(communityAlertSource).toContain("pubkey={provider.servicePubkey}")
    expect(communityAlertSource).toContain("relays={group.definition.relays}")
  })
})
