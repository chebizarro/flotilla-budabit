import {describe, expect, it} from "vitest"
import {getPublicKey} from "nostr-tools/pure"
import {
  COMMUNITY_DEFINITION_KIND_V2,
  PROFILE_LIST_KIND,
  buildCommunityDefinitionV2,
  parseCommunityDefinitionV2,
} from "@app/core/community"
import {
  buildPeopleSearchCandidates,
  buildPeopleSearchResults,
  getCommunityPeoplePubkeys,
  searchPeopleCandidates,
} from "./people-search"

describe("people-search", () => {
  const makeDefinition = ({
    controllerPubkey,
    communityId,
    listOwner,
  }: {
    controllerPubkey: string
    communityId: string
    listOwner: string
  }) =>
    parseCommunityDefinitionV2({
      id: communityId,
      kind: COMMUNITY_DEFINITION_KIND_V2,
      pubkey: controllerPubkey,
      created_at: 1,
      content: "",
      sig: "f".repeat(128),
      tags: buildCommunityDefinitionV2({
        communityId,
        name: "Builders",
        relays: ["wss://relay.example"],
        sections: [
          {
            name: "General",
            kinds: [{kind: 1111}],
            profileLists: [{address: `${PROFILE_LIST_KIND}:${listOwner}:members`}],
          },
        ],
      }).tags,
    } as any)!

  it("orders community matches ahead of direct follows", () => {
    const communityMember = "a".repeat(64)
    const directFollow = "b".repeat(64)
    const profiles = new Map([
      [communityMember, {name: "Alice Builder"}],
      [directFollow, {name: "Alice Social"}],
    ])

    const results = buildPeopleSearchResults({
      query: "alice",
      communityPubkeys: [communityMember],
      directFollowPubkeys: [directFollow],
      knownPubkeys: [communityMember, directFollow],
      communityAssessments: new Map([
        [
          communityMember,
          {
            category: "community_member",
            score: 4,
            evidence: [{type: "community_member", label: "Community member"}],
            displayLabels: ["Community member"],
            suppressed: false,
          },
        ],
      ]),
      getProfile: pubkey => profiles.get(pubkey),
    })

    expect(results.map(result => result.pubkey)).toEqual([communityMember, directFollow])
    expect(results[0]).toMatchObject({bucket: "community", label: "Community member"})
    expect(results[1]).toMatchObject({bucket: "direct_follow", label: "You follow"})
  })

  it("keeps repository authority ahead of community and text relevance", () => {
    const owner = "1".repeat(64)
    const maintainer = "2".repeat(64)
    const communityMember = "3".repeat(64)
    const directFollow = "4".repeat(64)
    const profiles = new Map([
      [owner, {name: "Alice Owner"}],
      [maintainer, {name: "Alice Maintainer"}],
      [communityMember, {name: "Alice Community"}],
      [directFollow, {display_name: "alice", name: "alice", nip05: "alice"}],
    ])

    const results = buildPeopleSearchResults({
      query: "alice",
      repoOwnerPubkeys: [owner],
      repoMaintainerPubkeys: [maintainer],
      communityPubkeys: [communityMember],
      directFollowPubkeys: [directFollow],
      knownPubkeys: [owner, maintainer, communityMember, directFollow],
      communityAssessments: new Map([
        [
          communityMember,
          {
            category: "community_member",
            score: 4,
            evidence: [{type: "community_member", label: "Community member"}],
            displayLabels: ["Community member"],
            suppressed: false,
          },
        ],
      ]),
      getProfile: pubkey => profiles.get(pubkey),
    })

    expect(results.map(result => result.pubkey)).toEqual([
      owner,
      maintainer,
      communityMember,
      directFollow,
    ])
    expect(results.map(result => result.bucket)).toEqual([
      "repo_owner",
      "repo_maintainer",
      "community",
      "direct_follow",
    ])
  })

  it("places matching repository authority inside the first bounded scan", () => {
    const owner = "b".repeat(64)
    const profileMatches = Array.from({length: 400}, (_, index) =>
      index.toString(16).padStart(64, "0"),
    )
    const candidates = buildPeopleSearchCandidates({
      query: "alice",
      repoOwnerPubkeys: [owner],
      profileMatches,
    })
    const batch = searchPeopleCandidates({
      query: "alice",
      candidates,
      getProfile: pubkey => (pubkey === owner ? {name: "Alice Owner"} : {name: "Alice"}),
      scanLimit: 1,
    })

    expect(batch.results).toEqual([expect.objectContaining({pubkey: owner, bucket: "repo_owner"})])
  })

  it("uses community-first discovery for empty-query suggestions", () => {
    const communityMember = "5".repeat(64)
    const directFollow = "6".repeat(64)
    const known = "7".repeat(64)

    const results = buildPeopleSearchResults({
      query: "",
      allowEmptyQuery: true,
      communityPubkeys: [communityMember],
      directFollowPubkeys: [directFollow],
      knownPubkeys: [known],
      communityAssessments: new Map([
        [
          communityMember,
          {
            category: "community_member",
            score: 4,
            evidence: [{type: "community_member", label: "Community member"}],
            displayLabels: ["Community member"],
            suppressed: false,
          },
        ],
      ]),
    })

    expect(results.map(result => result.pubkey)).toEqual([communityMember, directFollow, known])
  })

  it("demotes direct mutes without using them as discovery candidates", () => {
    const unmuted = "8".repeat(64)
    const muted = "9".repeat(64)
    const muteOnly = "a".repeat(64)

    const results = buildPeopleSearchResults({
      query: "alice",
      knownPubkeys: [muted, unmuted],
      directMutePubkeys: [muted, muteOnly],
      getProfile: pubkey =>
        pubkey === muted || pubkey === unmuted ? {name: "Alice"} : {name: "Alice muted only"},
    })

    expect(results.map(result => result.pubkey)).toEqual([unmuted, muted])
    expect(results[1]?.evidenceLabels).toContain("Muted by you")
  })

  it("returns exact identity matches without a profile", () => {
    const pubkey = "c".repeat(64)

    expect(buildPeopleSearchResults({query: pubkey})).toEqual([
      expect.objectContaining({pubkey, bucket: "identity", label: "Exact match"}),
    ])
  })

  it("does not label unvalidated community candidates as members", () => {
    const candidate = "d".repeat(64)

    const results = buildPeopleSearchResults({
      query: "alice",
      communityPubkeys: [candidate],
      profileMatches: [candidate],
      getProfile: pubkey => (pubkey === candidate ? {name: "Alice Maybe"} : null),
    })

    expect(results).toEqual([
      expect.objectContaining({pubkey: candidate, bucket: "known_profile", label: "Known profile"}),
    ])
  })

  it("collects people from community profile lists", () => {
    const listOwner = "e".repeat(64)
    const member = "f".repeat(64)
    const unrelated = "0".repeat(64)

    const pubkeys = getCommunityPeoplePubkeys({
      profileListEvents: [
        {
          id: "profile-list",
          kind: PROFILE_LIST_KIND,
          pubkey: listOwner,
          tags: [["p", member]],
        } as any,
        {
          id: "not-profile-list",
          kind: 1,
          pubkey: unrelated,
          tags: [["p", unrelated]],
        } as any,
      ],
    })

    expect(pubkeys).toEqual([listOwner, member])
  })

  it("uses V2 controllers and profile lists as people without admitting community IDs", () => {
    const allowedController = getPublicKey(new Uint8Array(32).fill(1))
    const renouncedController = getPublicKey(new Uint8Array(32).fill(2))
    const allowedCommunityId = getPublicKey(new Uint8Array(32).fill(3))
    const renouncedCommunityId = getPublicKey(new Uint8Array(32).fill(4))
    const allowedListOwner = getPublicKey(new Uint8Array(32).fill(5))
    const renouncedListOwner = getPublicKey(new Uint8Array(32).fill(6))
    const allowedMember = getPublicKey(new Uint8Array(32).fill(7))
    const renouncedMember = getPublicKey(new Uint8Array(32).fill(8))
    const allowedDefinition = makeDefinition({
      controllerPubkey: allowedController,
      communityId: allowedCommunityId,
      listOwner: allowedListOwner,
    })
    const renouncedDefinition = makeDefinition({
      controllerPubkey: renouncedController,
      communityId: renouncedCommunityId,
      listOwner: renouncedListOwner,
    })

    const pubkeys = getCommunityPeoplePubkeys({
      excludedCommunityAddresses: [renouncedDefinition.pointer.address],
      definitions: [allowedDefinition, renouncedDefinition],
      profileListEvents: [
        {
          id: "allowed-profile-list",
          kind: PROFILE_LIST_KIND,
          pubkey: allowedListOwner,
          tags: [
            ["d", "members"],
            ["p", allowedMember],
          ],
        } as any,
        {
          id: "renounced-profile-list",
          kind: PROFILE_LIST_KIND,
          pubkey: renouncedListOwner,
          tags: [
            ["d", "members"],
            ["p", renouncedMember],
          ],
        } as any,
      ],
    })

    expect(pubkeys).toEqual([allowedController, allowedListOwner, allowedMember])
    expect(pubkeys).not.toContain(allowedCommunityId)
    expect(pubkeys).not.toContain(renouncedCommunityId)
  })

  it("keeps people with evidence from another branch when one exact branch is excluded", () => {
    const sharedController = getPublicKey(new Uint8Array(32).fill(10))
    const allowedCommunityId = getPublicKey(new Uint8Array(32).fill(11))
    const excludedCommunityId = getPublicKey(new Uint8Array(32).fill(12))
    const allowedListOwner = getPublicKey(new Uint8Array(32).fill(13))
    const excludedListOwner = getPublicKey(new Uint8Array(32).fill(14))
    const sharedMember = getPublicKey(new Uint8Array(32).fill(15))
    const allowedDefinition = makeDefinition({
      controllerPubkey: sharedController,
      communityId: allowedCommunityId,
      listOwner: allowedListOwner,
    })
    const excludedDefinition = makeDefinition({
      controllerPubkey: sharedController,
      communityId: excludedCommunityId,
      listOwner: excludedListOwner,
    })

    const pubkeys = getCommunityPeoplePubkeys({
      excludedCommunityAddresses: [excludedDefinition.pointer.address],
      definitions: [allowedDefinition, excludedDefinition],
      profileListEvents: [
        {
          id: "allowed-profile-list",
          kind: PROFILE_LIST_KIND,
          pubkey: allowedListOwner,
          tags: [
            ["d", "members"],
            ["p", sharedMember],
          ],
        } as any,
        {
          id: "excluded-profile-list",
          kind: PROFILE_LIST_KIND,
          pubkey: excludedListOwner,
          tags: [
            ["d", "members"],
            ["p", sharedMember],
          ],
        } as any,
      ],
    })

    expect(pubkeys).toEqual([sharedController, allowedListOwner, sharedMember])
    expect(pubkeys).not.toContain(allowedCommunityId)
    expect(pubkeys).not.toContain(excludedCommunityId)
  })

  it("returns bounded batches with a resumable cursor", () => {
    const pubkeys = ["1".repeat(64), "2".repeat(64), "3".repeat(64)]
    const profiles = new Map(pubkeys.map((pubkey, index) => [pubkey, {name: `Alice ${index}`}]))
    const candidates = buildPeopleSearchCandidates({query: "alice", knownPubkeys: pubkeys})

    const firstBatch = searchPeopleCandidates({
      query: "alice",
      candidates,
      getProfile: pubkey => profiles.get(pubkey),
      scanLimit: 2,
    })

    expect(firstBatch.results).toHaveLength(2)
    expect(firstBatch.cursor).toBe(2)
    expect(firstBatch.hasMore).toBe(true)

    const secondBatch = searchPeopleCandidates({
      query: "alice",
      candidates,
      getProfile: pubkey => profiles.get(pubkey),
      cursor: firstBatch.cursor,
      scanLimit: 2,
    })

    expect(secondBatch.results).toHaveLength(1)
    expect(secondBatch.cursor).toBe(3)
    expect(secondBatch.hasMore).toBe(false)
  })

  it("builds community trust only for candidates that match text", () => {
    const matching = "4".repeat(64)
    const nonMatching = "5".repeat(64)
    const profiles = new Map([
      [matching, {name: "Alice Builder"}],
      [nonMatching, {name: "Bob Builder"}],
    ])
    const candidates = buildPeopleSearchCandidates({
      query: "alice",
      communityPubkeys: [nonMatching, matching],
    })
    const assessedPubkeys: string[] = []

    const results = searchPeopleCandidates({
      query: "alice",
      candidates,
      getProfile: pubkey => profiles.get(pubkey),
      getCommunityAssessments: pubkeys => {
        assessedPubkeys.push(...pubkeys)
        return new Map(
          pubkeys.map(pubkey => [
            pubkey,
            {
              category: "community_member",
              score: 4,
              evidence: [{type: "community_member", label: "Community member"}],
              displayLabels: ["Community member"],
              suppressed: false,
            },
          ]),
        )
      },
    }).results

    expect(assessedPubkeys).toEqual([matching])
    expect(results).toEqual([
      expect.objectContaining({pubkey: matching, bucket: "community", label: "Community member"}),
    ])
  })
})
