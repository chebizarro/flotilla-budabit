import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("exact community identity source contracts", () => {
  it("keeps notification transport scopes keyed by definition address", () => {
    const source = readProjectFile("./notification-sources.ts")
    const repoWatchSource = readProjectFile("./repo-watch-notifications.ts")

    expect(source).toContain("communityAddress: string")
    expect(source).toContain("source.communityAddress")
    expect(source).not.toContain("source.communityPubkey")
    expect(source).not.toMatch(/communityPubkey:\s*(?:ref\.community|definition\.pointer)\.address/)
    expect(repoWatchSource).toMatch(
      /isRepoWatchCommunitySourceComplete\(\s*communityAddress,\s*\$definitionSources/,
    )
    expect(repoWatchSource).not.toMatch(
      /isRepoWatchCommunitySourceComplete\(\s*definition\.communityId/,
    )
  })

  it("does not treat a definition controller as its content scope", () => {
    const source = readProjectFile("../components/ContentLinkBlockImage.svelte")

    expect(source).toContain("definition?.communityId === communityId")
    expect(source).not.toMatch(/definition(?:\?\.)?\.pubkey\s*===\s*community/)
  })

  it("does not render a community ID or controller profile as a person identity", () => {
    const create = readProjectFile("../components/CommunityCreate.svelte")
    const menu = readProjectFile("../components/CommunityMenu.svelte")
    const roomCreate = readProjectFile("../components/community/CommunityRoomCreate.svelte")
    const gitItem = readProjectFile("../components/GitItem.svelte")
    const contentQuote = readProjectFile("../components/ContentQuote.svelte")

    expect(menu).toContain("exactDefinition?.metadata.name")
    expect(create).not.toContain("account becomes the community")
    expect(create).not.toContain("Community pubkey")
    expect(create).not.toContain("owns and publishes this community")
    expect(menu).not.toMatch(/\$activeCommunityProfile(?:\?|\.)/)
    expect(roomCreate).not.toMatch(/formatShortNpub\(community\.communityId\)/)
    for (const source of [menu, roomCreate]) {
      expect(source).toContain("community.naddr.slice")
      expect(source).not.toMatch(/community\.communityId\.slice/)
    }
    for (const source of [gitItem, contentQuote]) {
      expect(source).toContain("parseCommunityDefinitionAddress(community.address)")
      expect(source).toMatch(/pointer\.communityId\.slice/i)
      expect(source).not.toContain('community.address.split(":")')
    }
  })

  it("keeps auxiliary discovery V2-only", () => {
    const discovery = readProjectFile("../../../scripts/discover-relay-defaults.mjs")

    expect(discovery).toContain("COMMUNITY_DEFINITION_KIND_V2")
    expect(discovery).toContain("parseCommunityDefinitionV2")
    expect(discovery).not.toMatch(/COMMUNITY_DEFINITION_KIND\b|parseCommunityDefinition\b/)
  })

  it("renders community cards and suggestions from definition identity", () => {
    const preview = readProjectFile("../components/community/CommunityPreviewCard.svelte")
    const selector = readProjectFile("../components/community/CommunitySelectorCard.svelte")
    const suggestion = readProjectFile("../components/community/CommunitySuggestion.svelte")
    const explore = readProjectFile("../../routes/explore/+page.svelte")

    for (const source of [preview, selector]) {
      expect(source).toContain("definition?.metadata.name")
      expect(source).toContain("definition?.metadata.picture")
      expect(source).not.toContain("deriveBudabitProfile")
      expect(source).not.toContain("hydratePubkeyProfiles")
      expect(source).not.toContain("ProfileCircle")
    }
    expect(suggestion).toContain("definition?.metadata.name")
    expect(suggestion).toContain("pointer.naddr.slice")
    expect(explore).toContain("inputSuggestionDefinitions={communityDefinitions}")
    expect(preview).toContain("component: CommunitySuggestion")
    expect(preview).not.toContain("component: ProfileSuggestion")
  })

  it("uses exact community routes and definition identity for profile trust evidence", () => {
    const badges = readProjectFile("../components/ProfileTrustBadges.svelte")

    expect(badges).toContain("getExactCommunityReportTargetPath(item.definition.pointer, item)")
    expect(badges).toContain("item.definition.metadata.name")
    expect(badges).toContain("item.definition.metadata.picture")
    expect(badges).not.toContain("<ProfileName")
    expect(badges).not.toContain("<ProfileCircle")
  })
})
