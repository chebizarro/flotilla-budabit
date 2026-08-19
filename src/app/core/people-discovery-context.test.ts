import {describe, expect, it} from "vitest"
import {getPublicKey} from "nostr-tools/pure"
import {
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  buildCommunityDefinition,
  buildTargetedPublication,
  makeCommunityPointer,
  parseCommunityDefinition,
} from "./community"
import {
  resolveCommunityPeopleDiscoveryContext,
  resolveRepoPeopleDiscoveryContext,
} from "./people-discovery-context"

const key = (value: number) => getPublicKey(new Uint8Array(32).fill(value))
const owner = key(1)
const maintainer = key(2)
const community = key(3)
const communityId = key(4)
const listOwner = key(5)
const siblingController = key(6)
const communityAddress = `${COMMUNITY_DEFINITION_KIND}:${community}:${communityId}`
const pointer = makeCommunityPointer({ownerPubkey: community, communityId})!

const makeRepoEvent = (communityPubkey = communityId) =>
  ({
    id: "repo",
    kind: 30617,
    pubkey: owner,
    created_at: 10,
    content: "",
    sig: "",
    tags: [
      ["d", "demo"],
      ["h", communityPubkey],
      ["maintainers", owner, maintainer, maintainer],
    ],
  }) as any

const definitionEvent = {
  id: "definition",
  kind: COMMUNITY_DEFINITION_KIND,
  pubkey: community,
  created_at: 1,
  content: "",
  sig: "",
  tags: buildCommunityDefinition({
    communityId,
    name: "Builders",
    relays: ["wss://relay.example"],
    sections: [
      {
        name: "Repositories",
        kinds: [{kind: 30617}],
        profileLists: [{address: `${PROFILE_LIST_KIND}:${listOwner}:${communityId}-repositories`}],
      },
    ],
  }).tags,
} as any

const profileListEvent = {
  id: "list",
  kind: PROFILE_LIST_KIND,
  pubkey: listOwner,
  created_at: 1,
  content: "",
  sig: "",
  tags: [
    ["d", `${communityId}-repositories`],
    ["p", owner],
  ],
} as any

const definition = parseCommunityDefinition(definitionEvent)!
const siblingDefinition = parseCommunityDefinition({
  ...definitionEvent,
  id: "sibling-definition",
  pubkey: siblingController,
})!
const associationEvent = {
  id: "association",
  pubkey: owner,
  created_at: 2,
  sig: "",
  ...buildTargetedPublication({
    id: "repo-association",
    kind: 30617,
    source: {type: "a", value: `30617:${owner}:demo`},
    communities: [pointer],
  }),
} as any

describe("people discovery contexts", () => {
  it("keeps standalone community context free of repository authority", () => {
    expect(
      resolveCommunityPeopleDiscoveryContext(
        {scope: "community", communityPubkey: community, communityAddress},
        owner,
      ),
    ).toEqual({
      trustContext: {
        scope: "community",
        viewerPubkey: owner,
        communityPubkey: community,
        communityAddress,
      },
      communityPubkey: community,
      communityAddress,
      repoOwnerPubkeys: [],
      repoMaintainerPubkeys: [],
    })
  })

  it("combines owner-declared repository authority with an explicit community", () => {
    const result = resolveRepoPeopleDiscoveryContext(
      {
        scope: "repo",
        authority: {source: "announcement", event: makeRepoEvent()},
        community: {scope: "community", communityPubkey: community, communityAddress},
      },
      {definitions: new Map(), profileListEvents: [], reportStates: new Map()},
      owner,
    )

    expect(result.repoOwnerPubkeys).toEqual([owner])
    expect(result.repoMaintainerPubkeys).toEqual([maintainer])
    expect(result.trustContext).toMatchObject({
      scope: "repo",
      communityPubkey: community,
      communityAddress,
      repoAddress: `30617:${owner}:demo`,
    })
  })

  it("uses an announcement community only when the association is endorsed", () => {
    const endorsed = resolveRepoPeopleDiscoveryContext(
      {
        scope: "repo",
        authority: {source: "announcement", event: makeRepoEvent("e".repeat(64))},
        associationEvents: [associationEvent],
      },
      {
        definitions: new Map([
          [definition.pointer.address, definition],
          [siblingDefinition.pointer.address, siblingDefinition],
        ]),
        profileListEvents: [profileListEvent],
        reportStates: new Map([
          [
            siblingDefinition.pointer.address,
            {
              eventReports: [],
              personReports: [{targetPubkey: owner}],
            } as any,
          ],
        ]),
      },
    )
    const unvalidated = resolveRepoPeopleDiscoveryContext(
      {
        scope: "repo",
        authority: {source: "announcement", event: makeRepoEvent("e".repeat(64))},
      },
      {
        definitions: new Map([[definition.pointer.address, definition]]),
        profileListEvents: [],
        reportStates: new Map(),
      },
    )

    expect(endorsed.communityPubkey).toBe(community)
    expect(endorsed.trustContext.communityAddress).toBe(communityAddress)
    expect(unvalidated.communityPubkey).toBe("")
    expect(unvalidated.trustContext.communityPubkey).toBeUndefined()
  })

  it("infers an authorized direct repository community without targeting events", () => {
    const direct = resolveRepoPeopleDiscoveryContext(
      {
        scope: "repo",
        authority: {source: "announcement", event: makeRepoEvent()},
      },
      {
        definitions: new Map([[definition.pointer.address, definition]]),
        profileListEvents: [profileListEvent],
        reportStates: new Map(),
      },
    )
    const duplicateScope = resolveRepoPeopleDiscoveryContext(
      {
        scope: "repo",
        authority: {
          source: "announcement",
          event: {...makeRepoEvent(), tags: [...makeRepoEvent().tags, ["h", communityId]]},
        },
      },
      {
        definitions: new Map([[definition.pointer.address, definition]]),
        profileListEvents: [profileListEvent],
        reportStates: new Map(),
      },
    )

    expect(direct.communityPubkey).toBe(community)
    expect(direct.communityAddress).toBe(communityAddress)
    expect(duplicateScope.communityPubkey).toBe("")
  })

  it("normalizes draft owner declarations without mixing in community authority", () => {
    const result = resolveRepoPeopleDiscoveryContext(
      {
        scope: "repo",
        authority: {
          source: "draft",
          ownerPubkey: owner,
          maintainerPubkeys: [owner, maintainer, maintainer],
        },
      },
      {definitions: new Map(), profileListEvents: [], reportStates: new Map()},
    )

    expect(result.repoOwnerPubkeys).toEqual([owner])
    expect(result.repoMaintainerPubkeys).toEqual([maintainer])
    expect(result.communityPubkey).toBe("")
  })
})
