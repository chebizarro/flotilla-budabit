import type {EventContent, TrustedEvent} from "@welshman/util"
import {getTagValue} from "@welshman/util"
import {randomId} from "@welshman/lib"
import {
  MAX_TARGET_COMMUNITIES_V2,
  TARGETED_PUBLICATION_KINDS,
  type CommunityPointer,
  type TargetedPublicationSourceV2,
  buildTargetedPublicationV2,
  makeCommunityPointer,
  normalizePubkey,
  parseTargetedPublicationV2,
  removeTargetedCommunityV2,
} from "@app/core/community"

export const TARGETING_TAG = "h"

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

export const makeTargetedPublicationForCommunityV2 = ({
  targetingId,
  originalKind,
  originalRef,
  community,
}: {
  targetingId: string
  originalKind: number
  originalRef?: TargetedPublicationSourceV2
  community: CommunityPointer
}): EventContent =>
  buildTargetedPublicationV2({
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
}): TargetedPublicationSourceV2 => ({
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
}): TargetedPublicationSourceV2 => ({type: "e", value: id, relay, pubkey})

export const upsertCommunityTarget = (
  event: TrustedEvent,
  target: CommunityPointer,
): EventContent | undefined => {
  const parsed = parseTargetedPublicationV2(event)
  if (!parsed) return undefined

  const pointer = makeCommunityPointer({
    controllerPubkey: target.controllerPubkey,
    communityId: target.communityId,
    relayHints: target.relayHints,
  })
  if (!pointer || pointer.address !== target.address || pointer.naddr !== target.naddr)
    return undefined

  const tags = event.tags.map(tag => [...tag])
  const existingIndex = tags.findIndex(
    tag => tag[0] === "a" && tag[1] === pointer.address && tag[3] === "community",
  )
  if (existingIndex >= 0) {
    tags[existingIndex] = ["a", pointer.address, pointer.relayHints[0] || "", "community"]
  } else {
    if (parsed.communities.length >= MAX_TARGET_COMMUNITIES_V2) return undefined
    tags.push(["h", pointer.communityId])
    tags.push(["a", pointer.address, pointer.relayHints[0] || "", "community"])
  }

  return {content: event.content, tags}
}

export const removeCommunityTarget = (
  event: TrustedEvent,
  definitionAddress: string,
): EventContent | undefined => removeTargetedCommunityV2(event, definitionAddress)
