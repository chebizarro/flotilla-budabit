import {describe, expect, it} from "vitest"
import {getPublicKey} from "nostr-tools/pure"
import {DELETE, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND_V2,
  buildCommunityDefinitionV2,
  makeCommunityPointer,
  parseCommunityDefinitionV2,
  parseCommunityId,
} from "./community"
import {
  MODERATOR_REQUEST_REACTION_KIND,
  MODERATOR_REQUEST_ROLE,
  getModeratorPromotionRequestStates,
  getModeratorPromotionRequests,
  makeModeratorGrantEditDefinitionUpdate,
  makeModeratorGrantRevokeDefinitionUpdate,
  makeModeratorProfileListRequest,
  makeModeratorPromotionDefinitionUpdate,
  makeModeratorRequestIdentifier,
  makeModeratorRequestReaction,
  makeModeratorRequestReactionDelete,
  parseModeratorRequestEvent,
} from "./community-moderator-requests"

const secret = (value: number) => new Uint8Array(32).fill(value)
const controllerPubkey = getPublicKey(secret(1))
const otherControllerPubkey = getPublicKey(secret(2))
const communityId = getPublicKey(secret(3))
const requesterPubkey = getPublicKey(secret(4))
const existingModeratorPubkey = getPublicKey(secret(5))
const community = makeCommunityPointer({
  controllerPubkey,
  communityId,
  relayHints: ["wss://relay.example"],
})!

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "a".repeat(64),
    pubkey: controllerPubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "b".repeat(128),
    ...overrides,
  }) as TrustedEvent

const rootRef = {
  address: `30000:${controllerPubkey}:budabit-${communityId}-general-root`,
  relay: "wss://relay.example",
}

const makeDefinition = () => {
  const template = buildCommunityDefinitionV2({
    communityId,
    name: "Builders",
    description: "A community",
    relays: ["wss://relay.example"],
    sections: [
      {
        name: "General",
        kinds: [{kind: 1111}],
        profileLists: [rootRef],
      },
      {
        name: "Rooms",
        kinds: [{kind: 42}],
        profileLists: [rootRef],
      },
    ],
  })
  const tags = template.tags.flatMap(tag =>
    tag[0] === "name"
      ? [tag, ["x-top", "opaque"]]
      : tag[0] === "k" && tag[1] === "1111"
        ? [tag, ["x-section", "opaque"]]
        : [tag],
  )
  return parseCommunityDefinitionV2(makeEvent({kind: COMMUNITY_DEFINITION_KIND_V2, tags}))!
}

const makeRequestEvent = (pointer = community, created_at = 1) => {
  const template = makeModeratorProfileListRequest({
    community: pointer,
    requesterPubkey,
    sectionName: "General",
    relays: ["wss://relay.example"],
  })
  return makeEvent({
    id: `request-${created_at}`,
    pubkey: requesterPubkey,
    created_at,
    kind: template.kind,
    tags: template.tags,
  })
}

const getRequest = (event = makeRequestEvent()) =>
  getModeratorPromotionRequests({profileListEvents: [event], community})[0]

const findSamePrefixCommunityId = (value: string) => {
  const prefix = value.slice(0, 12)
  let suffix = BigInt(`0x${value.slice(12)}`) + 1n
  while (suffix < 1n << 208n) {
    const candidate = `${prefix}${suffix.toString(16).padStart(52, "0")}`
    if (candidate !== value && parseCommunityId(candidate)) return candidate
    suffix += 1n
  }
  throw new Error("Unable to make colliding community ID.")
}

describe("Communikeys V2 moderator requests", () => {
  it("builds a full-ID request coordinate with one exact authority pair and role marker", () => {
    const template = makeModeratorProfileListRequest({
      community,
      requesterPubkey,
      sectionName: "General",
      relays: ["wss://relay.example"],
    })

    expect(makeModeratorRequestIdentifier({community, sectionName: "General"})).toBe(
      `budabit-${communityId}-general-moderator`,
    )
    expect(template.tags.filter(tag => tag[0] === "h")).toEqual([["h", communityId]])
    expect(template.tags.filter(tag => tag[0] === "a" && tag[3] === "community")).toEqual([
      ["a", community.address, "wss://relay.example", "community"],
    ])
    expect(template.tags).toContainEqual(["role", MODERATOR_REQUEST_ROLE])
    expect(parseModeratorRequestEvent(makeRequestEvent(), community)?.community.address).toBe(
      community.address,
    )
  })

  it("rejects authority mismatches, duplicate scope, wrong role, and another exact branch", () => {
    const valid = makeRequestEvent()
    const otherBranch = makeCommunityPointer({
      controllerPubkey: otherControllerPubkey,
      communityId,
    })!
    const replaceTag = (name: string, replacement: string[]) =>
      valid.tags.map(tag => (tag[0] === name ? replacement : tag))

    expect(
      parseModeratorRequestEvent(
        makeEvent({...valid, tags: replaceTag("h", ["h", getPublicKey(secret(8))])}),
        community,
      ),
    ).toBeUndefined()
    expect(
      parseModeratorRequestEvent(
        makeEvent({...valid, tags: [...valid.tags, ["h", communityId]]}),
        community,
      ),
    ).toBeUndefined()
    expect(
      parseModeratorRequestEvent(
        makeEvent({...valid, tags: replaceTag("role", ["role", "member-request"])}),
        community,
      ),
    ).toBeUndefined()
    expect(parseModeratorRequestEvent(makeRequestEvent(otherBranch), community)).toBeUndefined()
  })

  it("does not collide when two community IDs share their first 12 hex characters", () => {
    const collidingId = findSamePrefixCommunityId(communityId)
    const sibling = makeCommunityPointer({controllerPubkey, communityId: collidingId})!

    expect(collidingId.slice(0, 12)).toBe(communityId.slice(0, 12))
    expect(makeModeratorRequestIdentifier({community: sibling, sectionName: "General"})).not.toBe(
      makeModeratorRequestIdentifier({community, sectionName: "General"}),
    )
    expect(parseModeratorRequestEvent(makeRequestEvent(sibling), community)).toBeUndefined()
  })

  it("accepts only controller-authored exact-branch decisions and deletes", () => {
    const definition = makeDefinition()
    const request = getRequest()
    const decisionTemplate = makeModeratorRequestReaction({
      request,
      target: request.profileList,
      content: "-",
    })
    const decision = makeEvent({
      id: "decision",
      kind: MODERATOR_REQUEST_REACTION_KIND,
      pubkey: controllerPubkey,
      content: "-",
      tags: decisionTemplate.tags,
    })
    const deleteTemplate = makeModeratorRequestReactionDelete({community, reactionId: decision.id})
    const deletion = makeEvent({
      id: "deletion",
      kind: DELETE,
      pubkey: controllerPubkey,
      tags: deleteTemplate.tags,
    })
    const otherBranch = makeCommunityPointer({
      controllerPubkey: otherControllerPubkey,
      communityId,
    })!
    const wrongBranchDecision = {
      ...decision,
      tags: decision.tags.map(tag =>
        tag[0] === "a" && tag[3] === "community"
          ? ["a", otherBranch.address, "", "community"]
          : tag,
      ),
    } as TrustedEvent
    const mismatchedDelete = {
      ...deletion,
      tags: deletion.tags.map(tag => (tag[0] === "h" ? ["h", getPublicKey(secret(8))] : tag)),
    } as TrustedEvent

    for (const template of [decisionTemplate, deleteTemplate]) {
      expect(template.tags.filter(tag => tag[0] === "h")).toHaveLength(1)
      expect(template.tags.filter(tag => tag[0] === "a" && tag[3] === "community")).toHaveLength(1)
    }
    expect(
      getModeratorPromotionRequestStates({
        definition,
        requests: [request],
        reactionEvents: [decision],
      })[0].status,
    ).toBe("rejected")
    expect(
      getModeratorPromotionRequestStates({
        definition,
        requests: [request],
        reactionEvents: [decision],
        deleteEvents: [deletion],
      })[0].status,
    ).toBe("pending")
    expect(
      getModeratorPromotionRequestStates({
        definition,
        requests: [request],
        reactionEvents: [{...decision, pubkey: communityId} as TrustedEvent],
      })[0].status,
    ).toBe("pending")
    expect(
      getModeratorPromotionRequestStates({
        definition,
        requests: [request],
        reactionEvents: [wrongBranchDecision],
      })[0].status,
    ).toBe("pending")
    expect(
      getModeratorPromotionRequestStates({
        definition,
        requests: [request],
        reactionEvents: [decision],
        deleteEvents: [mismatchedDelete],
      })[0].status,
    ).toBe("rejected")
  })

  it("promotes, edits, and revokes refs losslessly with full-ID coordinates", () => {
    const definition = makeDefinition()
    const request = getRequest()
    const promotedTemplate = makeModeratorPromotionDefinitionUpdate({definition, request})
    const promoted = parseCommunityDefinitionV2(
      makeEvent({kind: COMMUNITY_DEFINITION_KIND_V2, tags: promotedTemplate.tags}),
    )!

    expect(promotedTemplate.tags).toContainEqual(["x-top", "opaque"])
    expect(promotedTemplate.tags).toContainEqual(["x-section", "opaque"])
    expect(promoted.sections[0].profileLists).toContainEqual(request.profileListRef)
    expect(
      getModeratorPromotionRequestStates({definition: promoted, requests: [request]})[0].status,
    ).toBe("accepted")

    const editedTemplate = makeModeratorGrantEditDefinitionUpdate({
      definition: promoted,
      moderatorPubkey: requesterPubkey,
      sectionNames: ["General", "Rooms"],
    })
    const edited = parseCommunityDefinitionV2(
      makeEvent({kind: COMMUNITY_DEFINITION_KIND_V2, tags: editedTemplate.tags}),
    )!
    const roomsRef = edited.sections[1].profileLists.find(ref =>
      ref.address.includes(requesterPubkey),
    )!
    expect(roomsRef.address).toContain(`${communityId}-rooms`)
    expect(editedTemplate.tags).toContainEqual(["x-top", "opaque"])
    expect(editedTemplate.tags).toContainEqual(["x-section", "opaque"])

    const revokedTemplate = makeModeratorGrantRevokeDefinitionUpdate({
      definition: edited,
      sectionName: "General",
      moderatorPubkey: requesterPubkey,
    })
    const revoked = parseCommunityDefinitionV2(
      makeEvent({kind: COMMUNITY_DEFINITION_KIND_V2, tags: revokedTemplate.tags}),
    )!
    expect(revoked.sections[0].profileLists).toEqual([rootRef])
    expect(revoked.sections[1].profileLists).toContainEqual(roomsRef)
    expect(revokedTemplate.tags).toContainEqual(["x-top", "opaque"])
    expect(revokedTemplate.tags).toContainEqual(["x-section", "opaque"])
  })
})
