import {describe, expect, it} from "vitest"
import {DELETE, REACTION, makeEvent, type TrustedEvent} from "@welshman/util"
import {GIT_REPO_ANNOUNCEMENT, type RepoAnnouncementEvent} from "@nostr-git/core/events"
import {getPublicKey} from "nostr-tools/pure"
import {TARGETED_PUBLICATION_KIND, makeCommunityPointer} from "@app/core/community"
import {
  makeTargetedPublicationForCommunityV2,
  withPublicationTargetingId,
} from "@app/core/community-targeting"
import {makeRepoStarReaction} from "@app/util/repo-stars"
import {
  buildRepoCommunityStarCollections,
  getRepoCollectionStatus,
} from "./repo-collection-read-model"

const viewer = getPublicKey(new Uint8Array(32).fill(21))
const community = getPublicKey(new Uint8Array(32).fill(22))
const communityPointer = makeCommunityPointer({
  controllerPubkey: getPublicKey(new Uint8Array(32).fill(23)),
  communityId: community,
  relayHints: ["wss://community.example"],
})!
const owner = getPublicKey(new Uint8Array(32).fill(24))

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
      ...makeTargetedPublicationForCommunityV2({
        targetingId,
        originalKind: REACTION,
        community: communityPointer,
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
      communityOptions: [
        {
          controllerPubkey: community,
          address: communityPointer.address,
          communityId: community,
          label: "Community",
        },
      ],
      targetEvents: [target, target],
      targetDeleteEvents: [],
      reactionEvents: [star, star],
    })

    expect(collections).toHaveLength(1)
    expect(collections[0]).toMatchObject({
      targetEvent: {id: target.id},
      star: {address: `${GIT_REPO_ANNOUNCEMENT}:${owner}:demo`},
      community: {
        controllerPubkey: community,
        address: communityPointer.address,
        communityId: community,
      },
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
        communityOptions: [
          {controllerPubkey: community, address: communityPointer.address, communityId: community},
        ],
        targetEvents: [target],
        targetDeleteEvents: [deletion],
        reactionEvents: [star],
      }),
    ).toEqual([])
  })

  it("allows viewer wrappers to curate external stars through explicit event refs", () => {
    const externalAuthor = getPublicKey(new Uint8Array(32).fill(25))
    const eventStar = {
      ...makeRepoStarReaction({event: repo}),
      id: "6".repeat(64),
      pubkey: externalAuthor,
      sig: "7".repeat(128),
    } as TrustedEvent
    const makeExplicitTarget = (id: string, originalRef: {type: "e"; value: string}) =>
      ({
        ...makeEvent(TARGETED_PUBLICATION_KIND, {
          ...makeTargetedPublicationForCommunityV2({
            targetingId: `target-${id}`,
            originalKind: REACTION,
            originalRef,
            community: communityPointer,
          }),
        }),
        id,
        pubkey: viewer,
        sig: "1".repeat(128),
      }) as TrustedEvent

    const collections = buildRepoCommunityStarCollections({
      viewerPubkey: viewer,
      communityOptions: [
        {controllerPubkey: community, address: communityPointer.address, communityId: community},
      ],
      targetEvents: [makeExplicitTarget("event-target", {type: "e", value: eventStar.id})],
      targetDeleteEvents: [],
      reactionEvents: [eventStar],
    })

    expect(collections).toHaveLength(1)
    expect(collections[0].star.reaction.pubkey).toBe(externalAuthor)
  })

  it("does not associate an implicit original signed by someone other than its wrapper", () => {
    const {star, target} = makeCollectionEvents()
    const externalStar = {...star, pubkey: "9".repeat(64)} as TrustedEvent

    expect(
      buildRepoCommunityStarCollections({
        viewerPubkey: viewer,
        communityOptions: [
          {controllerPubkey: community, address: communityPointer.address, communityId: community},
        ],
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
        communityOptions: [
          {controllerPubkey: community, address: communityPointer.address, communityId: community},
        ],
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
