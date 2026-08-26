import type {EventContent, TrustedEvent} from "@welshman/util"
import {getTagValue} from "@welshman/util"
import {randomId} from "@welshman/lib"
import {
  MAX_TARGET_COMMUNITIES,
  TARGETED_PUBLICATION_KINDS,
  type CommunityPointer,
  type TargetedPublicationSource,
  buildTargetedPublication,
  makeCommunityPointer,
  normalizeTargetedPublicationTags,
  normalizePubkey,
  parseTargetedPublication,
  removeTargetedCommunity,
} from "@app/core/community"

export const TARGETING_TAG = "h"

export const makeCommunityTargetedPublicationSemanticKey = (
  communityAddress: string,
  kind: number,
) => `community-targeted:${communityAddress}:${kind}`

export const shouldTargetPublicationKind = (kind: number) =>
  TARGETED_PUBLICATION_KINDS.includes(kind as (typeof TARGETED_PUBLICATION_KINDS)[number])

export const getPublicationTargetingId = (event: TrustedEvent | EventContent) =>
  getTagValue(TARGETING_TAG, event.tags || []) || ""

export const withPublicationTargetingId = <T extends EventContent>(
  template: T,
  targetingId = randomId(),
): T & {targetingId: string} => ({
  ...template,
  tags: [
    [TARGETING_TAG, targetingId],
    ...(template.tags || []).filter(tag => tag[0] !== TARGETING_TAG),
  ],
  targetingId,
})

export const makeTargetedPublicationForCommunity = ({
  targetingId,
  originalKind,
  originalRef,
  community,
}: {
  targetingId: string
  originalKind: number
  originalRef?: TargetedPublicationSource
  community: CommunityPointer
}): EventContent =>
  buildTargetedPublication({
    id: targetingId,
    kind: originalKind,
    source: originalRef,
    communities: [community],
  })

export const makeAddressablePublicationRef = ({
  kind,
  pubkey,
  identifier,
  relay,
}: {
  kind: number
  pubkey: string
  identifier: string
  relay?: string
}): TargetedPublicationSource => ({
  type: "a",
  value: `${kind}:${normalizePubkey(pubkey)}:${identifier}`,
  relay,
})

export const makeEventPublicationRef = ({
  id,
  relay,
  pubkey,
}: {
  id: string
  relay?: string
  pubkey?: string
}): TargetedPublicationSource => ({type: "e", value: id, relay, pubkey})

export const upsertCommunityTarget = (
  event: TrustedEvent,
  target: CommunityPointer,
): EventContent | undefined => {
  const parsed = parseTargetedPublication(event)
  if (!parsed) return undefined

  const pointer = makeCommunityPointer({
    ownerPubkey: target.ownerPubkey,
    communityId: target.communityId,
    relayHints: target.relayHints,
  })
  if (!pointer || pointer.address !== target.address || pointer.naddr !== target.naddr)
    return undefined

  const tags = normalizeTargetedPublicationTags(event.tags)
  const existingIndex = tags.findIndex(
    (tag, index) => tag[0] === "a" && tag[1] === pointer.address && tags[index - 1]?.[0] === "h",
  )
  if (existingIndex >= 0) {
    tags[existingIndex] = pointer.relayHints[0]
      ? ["a", pointer.address, pointer.relayHints[0]]
      : ["a", pointer.address]
  } else {
    if (parsed.communities.length >= MAX_TARGET_COMMUNITIES) return undefined
    tags.push(["h", pointer.communityId])
    tags.push(
      pointer.relayHints[0]
        ? ["a", pointer.address, pointer.relayHints[0]]
        : ["a", pointer.address],
    )
  }

  return {content: event.content, tags}
}

export const removeCommunityTarget = (
  event: TrustedEvent,
  definitionAddress: string,
): EventContent | undefined => removeTargetedCommunity(event, definitionAddress)
