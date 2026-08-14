import {describe, expect, it} from "vitest"
import {DELETE, REACTION, makeEvent, type TrustedEvent} from "@welshman/util"
import {GIT_REPO_ANNOUNCEMENT, type RepoAnnouncementEvent} from "@nostr-git/core/events"
import {TARGETED_PUBLICATION_KIND} from "@app/core/community"
import {
  makeTargetedPublicationForCommunity,
  withPublicationTargetingId,
} from "@app/core/community-targeting"
import {makeRepoStarReaction} from "@app/util/repo-stars"
import {
  buildRepoCommunityStarCollections,
  getRepoCollectionStatus,
} from "./repo-collection-read-model"

const viewer = "a".repeat(64)
const community = "b".repeat(64)
const owner = "c".repeat(64)

const repo = {
  id: "d".repeat(64),
  pubkey: owner,
  created_at: 1,
  kind: GIT_REPO_ANNOUNCEMENT,
  tags: [
    ["d", "demo"],
    ["name", "demo"],
  ],
  content: "",
  sig: "e".repeat(128),
} as RepoAnnouncementEvent

const makeCollectionEvents = () => {
  const targetingId = "target-demo"
  const star = {
    ...withPublicationTargetingId(makeRepoStarReaction({event: repo}), targetingId),
    id: "f".repeat(64),
    pubkey: viewer,
    sig: "1".repeat(128),
  } as TrustedEvent
  const target = {
    ...makeEvent(TARGETED_PUBLICATION_KIND, {
      ...makeTargetedPublicationForCommunity({
        targetingId,
        originalKind: REACTION,
        communityPubkey: community,
        communityRelay: "wss://community.example",
      }),
    }),
    id: "2".repeat(64),
    pubkey: viewer,
    sig: "3".repeat(128),
  } as TrustedEvent

  return {star, target}
}

describe("repository collection read model", () => {
  it("keeps known collections while incomplete empty reads remain indeterminate", () => {
    expect(getRepoCollectionStatus(true, false)).toBe("collected")
    expect(getRepoCollectionStatus(false, false)).toBe("indeterminate")
    expect(getRepoCollectionStatus(false, true)).toBe("uncollected")
  })

  it("indexes one community collection from shared target and reaction events", () => {
    const {star, target} = makeCollectionEvents()
    const collections = buildRepoCommunityStarCollections({
      viewerPubkey: viewer,
      communityOptions: [{pubkey: community, label: "Community"}],
      targetEvents: [target, target],
      targetDeleteEvents: [],
      reactionEvents: [star, star],
    })

    expect(collections).toHaveLength(1)
    expect(collections[0]).toMatchObject({
      targetEvent: {id: target.id},
      star: {address: `${GIT_REPO_ANNOUNCEMENT}:${owner}:demo`},
      community: {pubkey: community},
    })
  })

  it("removes a collection after an authorized target deletion", () => {
    const {star, target} = makeCollectionEvents()
    const deletion = {
      ...makeEvent(DELETE, {tags: [["e", target.id]]}),
      id: "4".repeat(64),
      pubkey: viewer,
      sig: "5".repeat(128),
    } as TrustedEvent

    expect(
      buildRepoCommunityStarCollections({
        viewerPubkey: viewer,
        communityOptions: [{pubkey: community}],
        targetEvents: [target],
        targetDeleteEvents: [deletion],
        reactionEvents: [star],
      }),
    ).toEqual([])
  })

  it("allows viewer wrappers to curate external stars through explicit event and address refs", () => {
    const externalAuthor = "9".repeat(64)
    const eventStar = {
      ...makeRepoStarReaction({event: repo}),
      id: "6".repeat(64),
      pubkey: externalAuthor,
      sig: "7".repeat(128),
    } as TrustedEvent
    const addressStar = {
      ...makeRepoStarReaction({event: repo}),
      id: "8".repeat(64),
      pubkey: externalAuthor,
      tags: [...makeRepoStarReaction({event: repo}).tags, ["d", "external-star"]],
      sig: "9".repeat(128),
    } as TrustedEvent
    const makeExplicitTarget = (id: string, originalRef: {type: "e" | "a"; value: string}) =>
      ({
        ...makeEvent(TARGETED_PUBLICATION_KIND, {
          ...makeTargetedPublicationForCommunity({
            targetingId: `target-${id}`,
            originalKind: REACTION,
            originalRef,
            communityPubkey: community,
            communityRelay: "wss://community.example",
          }),
        }),
        id,
        pubkey: viewer,
        sig: "1".repeat(128),
      }) as TrustedEvent

    const collections = buildRepoCommunityStarCollections({
      viewerPubkey: viewer,
      communityOptions: [{pubkey: community}],
      targetEvents: [
        makeExplicitTarget("event-target", {type: "e", value: eventStar.id}),
        makeExplicitTarget("address-target", {
          type: "a",
          value: `${REACTION}:${externalAuthor}:external-star`,
        }),
      ],
      targetDeleteEvents: [],
      reactionEvents: [eventStar, addressStar],
    })

    expect(collections).toHaveLength(2)
    expect(collections.map(collection => collection.star.reaction.pubkey)).toEqual([
      externalAuthor,
      externalAuthor,
    ])
  })

  it("does not associate an implicit original signed by someone other than its wrapper", () => {
    const {star, target} = makeCollectionEvents()
    const externalStar = {...star, pubkey: "9".repeat(64)} as TrustedEvent

    expect(
      buildRepoCommunityStarCollections({
        viewerPubkey: viewer,
        communityOptions: [{pubkey: community}],
        targetEvents: [target],
        targetDeleteEvents: [],
        reactionEvents: [externalStar],
      }),
    ).toEqual([])
  })

  it("ignores events from another viewer or unknown community", () => {
    const {star, target} = makeCollectionEvents()

    expect(
      buildRepoCommunityStarCollections({
        viewerPubkey: "9".repeat(64),
        communityOptions: [{pubkey: community}],
        targetEvents: [target],
        targetDeleteEvents: [],
        reactionEvents: [star],
      }),
    ).toEqual([])
    expect(
      buildRepoCommunityStarCollections({
        viewerPubkey: viewer,
        communityOptions: [],
        targetEvents: [target],
        targetDeleteEvents: [],
        reactionEvents: [star],
      }),
    ).toEqual([])
  })
})
