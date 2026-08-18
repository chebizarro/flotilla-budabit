import {describe, expect, it} from "vitest"
import {getPublicKey} from "nostr-tools"
import {DELETE, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND_V2,
  FORM_TEMPLATE_KIND,
  PROFILE_LIST_KIND,
  RENOUNCED_COMMUNITIES_DTAG,
  buildCommunityDefinitionV2,
  makeCommunityPointer,
  parseCommunityDefinitionV2,
} from "@app/core/community"
import {COMMUNITY_STAR_CONTENT} from "@app/util/community-stars"
import {makeAdmissionFormTemplate} from "@app/core/community-forms"
import {selectPreferredCommunities} from "@app/util/community-preferences"

const userPubkey = getPublicKey(new Uint8Array(32).fill(1))
const moderatorCommunityPubkey = getPublicKey(new Uint8Array(32).fill(2))
const starredCommunityPubkey = getPublicKey(new Uint8Array(32).fill(3))
const otherCommunityPubkey = getPublicKey(new Uint8Array(32).fill(4))
const memberCommunityPubkey = getPublicKey(new Uint8Array(32).fill(5))
const communityPointer = (controllerPubkey: string) =>
  makeCommunityPointer({controllerPubkey, communityId: controllerPubkey})!

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: overrides.id || "event-id",
    pubkey: userPubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const makeDefinition = ({
  id,
  pubkey,
  created_at = 1,
  profileListPubkey = userPubkey,
  listIdentifier = "general-list",
}: {
  id: string
  pubkey: string
  created_at?: number
  profileListPubkey?: string
  listIdentifier?: string
}) => {
  const communityId = getPublicKey(
    new Uint8Array(32).fill(
      (Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 254) + 1,
    ),
  )
  return makeEvent({
    id,
    pubkey,
    created_at,
    kind: COMMUNITY_DEFINITION_KIND_V2,
    tags: buildCommunityDefinitionV2({
      communityId,
      name: id,
      relays: ["wss://community.example.com"],
      sections: [
        {
          name: "General",
          kinds: [{kind: 7}],
          profileLists: [{address: `${PROFILE_LIST_KIND}:${profileListPubkey}:${listIdentifier}`}],
        },
      ],
    }).tags,
  })
}

const makeProfileList = (identifier: string, created_at = 1) =>
  makeEvent({
    id: `profile-list-${identifier}`,
    pubkey: userPubkey,
    created_at,
    kind: PROFILE_LIST_KIND,
    tags: [["d", identifier]],
  })

const makeStar = (communityPubkey: string, created_at = 1) => {
  const reaction = makeEvent({
    id: `star-${communityPubkey}`,
    pubkey: userPubkey,
    created_at,
    kind: 7,
    content: COMMUNITY_STAR_CONTENT,
    tags: [["a", communityPointer(communityPubkey).address, "wss://star.example.com"]],
  })

  return {
    community: communityPointer(communityPubkey),
    reaction,
  }
}

const makeMemberCommunityRef = ({
  communityPubkey,
  roles = ["member"],
  created_at = 1,
}: {
  communityPubkey: string
  roles?: string[]
  created_at?: number
}) => {
  const definition = parseCommunityDefinitionV2(
    makeDefinition({id: `definition-${communityPubkey}`, pubkey: communityPubkey, created_at}),
  )!

  return {community: definition.pointer, relayHints: definition.relays, roles, definition}
}

describe("community preferences", () => {
  it("sorts admin, moderator, member, and star communities by score", () => {
    const adminDefinition = makeDefinition({id: "admin", pubkey: userPubkey, created_at: 1})
    const moderatorDefinition = makeDefinition({
      id: "moderator",
      pubkey: moderatorCommunityPubkey,
      created_at: 2,
      listIdentifier: "moderator-list",
    })
    const moderatorProfileList = makeProfileList("moderator-list", 3)
    const starred = makeStar(starredCommunityPubkey, 10)
    const memberRef = makeMemberCommunityRef({
      communityPubkey: memberCommunityPubkey,
      created_at: 6,
    })

    expect(
      selectPreferredCommunities({
        stars: [starred],
        memberCommunityRefs: [
          makeMemberCommunityRef({communityPubkey: userPubkey, roles: ["admin", "member"]}),
          makeMemberCommunityRef({
            communityPubkey: moderatorCommunityPubkey,
            roles: ["moderator", "member"],
          }),
          memberRef,
        ],
        adminDefinitionEvents: [adminDefinition],
        moderatorProfileListEvents: [moderatorProfileList],
        moderatorDefinitionEvents: [moderatorDefinition],
        author: userPubkey,
      }),
    ).toEqual([
      expect.objectContaining({
        communityPubkey: userPubkey,
        score: 8,
        isAdmin: true,
        isMember: false,
      }),
      expect.objectContaining({
        communityPubkey: moderatorCommunityPubkey,
        score: 4,
        isModerator: true,
        isMember: false,
      }),
      expect.objectContaining({
        communityPubkey: memberCommunityPubkey,
        score: 2,
        isMember: true,
      }),
      expect.objectContaining({
        communityPubkey: starredCommunityPubkey,
        score: 1,
        isStarred: true,
      }),
    ])
  })

  it("does not combine roles from different definitions owned by the same controller", () => {
    const adminDefinition = makeDefinition({id: "admin", pubkey: userPubkey, created_at: 1})
    const starred = makeStar(userPubkey, 5)

    expect(
      selectPreferredCommunities({
        stars: [starred],
        adminDefinitionEvents: [adminDefinition],
        author: userPubkey,
      }),
    ).toEqual([
      expect.objectContaining({
        communityPubkey: userPubkey,
        score: 8,
        isAdmin: true,
        isStarred: false,
      }),
      expect.objectContaining({
        communityPubkey: userPubkey,
        score: 1,
        isAdmin: false,
        isStarred: true,
        lastInteractedAt: 5,
      }),
    ])
  })

  it("keeps authored sibling definitions as separate preferences", () => {
    const first = makeDefinition({id: "first", pubkey: userPubkey, created_at: 1})
    const second = makeDefinition({id: "second", pubkey: userPubkey, created_at: 2})

    expect(
      selectPreferredCommunities({
        adminDefinitionEvents: [first, second],
        author: userPubkey,
      }).map(preference => preference.communityAddress),
    ).toEqual([
      parseCommunityDefinitionV2(second)!.pointer.address,
      parseCommunityDefinitionV2(first)!.pointer.address,
    ])
  })

  it("uses user-authored admission forms as moderator evidence", () => {
    const form = makeEvent({
      id: "form",
      pubkey: userPubkey,
      created_at: 4,
      kind: FORM_TEMPLATE_KIND,
      tags: makeAdmissionFormTemplate({
        identifier: "repo-application",
        community: communityPointer(moderatorCommunityPubkey),
        sectionName: "Repositories",
        name: "Repository application",
        fields: [],
      }).tags,
    })

    expect(selectPreferredCommunities({moderatorFormEvents: [form], author: userPubkey})).toEqual([
      expect.objectContaining({
        communityPubkey: moderatorCommunityPubkey,
        score: 4,
        isModerator: true,
      }),
    ])
  })

  it("excludes renounced non-admin communities from preferences", () => {
    const adminDefinition = makeDefinition({id: "admin", pubkey: userPubkey, created_at: 1})
    const memberRef = makeMemberCommunityRef({
      communityPubkey: memberCommunityPubkey,
      created_at: 6,
    })
    const starred = makeStar(starredCommunityPubkey, 10)

    expect(
      selectPreferredCommunities({
        stars: [starred],
        memberCommunityRefs: [
          makeMemberCommunityRef({communityPubkey: userPubkey, roles: ["admin"]}),
          memberRef,
        ],
        adminDefinitionEvents: [adminDefinition],
        excludedCommunityAddresses: [
          communityPointer(userPubkey).address,
          memberRef.definition.pointer.address,
          communityPointer(starredCommunityPubkey).address,
        ],
        author: userPubkey,
      }).map(community => community.communityPubkey),
    ).toEqual([userPubkey])
  })

  it("ignores renounced-community lists as moderator list evidence", () => {
    const definition = makeDefinition({
      id: "definition",
      pubkey: moderatorCommunityPubkey,
      listIdentifier: RENOUNCED_COMMUNITIES_DTAG,
    })
    const renouncedList = makeEvent({
      id: "renounced-list",
      pubkey: userPubkey,
      kind: PROFILE_LIST_KIND,
      tags: [["d", RENOUNCED_COMMUNITIES_DTAG]],
    })

    expect(
      selectPreferredCommunities({
        moderatorProfileListEvents: [renouncedList],
        moderatorDefinitionEvents: [definition],
        author: userPubkey,
      }),
    ).toEqual([])
  })

  it("ignores definitions that reference non-grant-capable user lists", () => {
    const definition = makeDefinition({
      id: "not-moderator",
      pubkey: otherCommunityPubkey,
      profileListPubkey: otherCommunityPubkey,
      listIdentifier: "general-list",
    })
    const profileList = makeProfileList("general-list", 3)

    expect(
      selectPreferredCommunities({
        moderatorProfileListEvents: [profileList],
        moderatorDefinitionEvents: [definition],
        author: userPubkey,
      }),
    ).toEqual([])
  })

  it("drops deleted moderator-list authority and accepts a later recreation", () => {
    const definition = makeDefinition({
      id: "moderator-authority",
      pubkey: moderatorCommunityPubkey,
      listIdentifier: "moderator-list",
    })
    const list = makeProfileList("moderator-list", 2)
    const address = `${PROFILE_LIST_KIND}:${userPubkey}:moderator-list`
    const deletion = makeEvent({
      id: "delete-moderator-list",
      pubkey: userPubkey,
      created_at: 2,
      kind: DELETE,
      tags: [["a", address]],
    })
    const recreated = {...list, id: "recreated-moderator-list", created_at: 3}
    const select = (events: TrustedEvent[]) =>
      selectPreferredCommunities({
        moderatorProfileListEvents: events,
        moderatorDefinitionEvents: [definition],
        author: userPubkey,
      })

    expect(select([list, deletion])).toEqual([])
    expect(select([list, deletion, recreated])).toHaveLength(1)
    expect(select([list, {...deletion, pubkey: otherCommunityPubkey}])).toHaveLength(1)
    expect(
      select([
        list,
        {
          ...deletion,
          tags: [
            ["a", address],
            ["a", `${address}-other`],
          ],
        },
      ]),
    ).toHaveLength(1)
  })
})
