import {DELETE, REACTION, type TrustedEvent} from "@welshman/util"
import type {CommunityPointer} from "@app/core/community"
import type {PublicationSnapshot} from "@app/core/publication-operations"
import {parseCommunityStarReaction, type CommunityStarRef} from "@app/util/community-stars"

const COMMUNITY_STAR_OPERATION_PREFIX = "community-star:"

export const getCommunityStarOperationSemanticKey = (community: CommunityPointer) =>
  `${COMMUNITY_STAR_OPERATION_PREFIX}${community.address}`

export const projectCommunityStarOperation = ({
  star,
  operations,
  ownerPubkey,
  community,
}: {
  star?: CommunityStarRef
  operations: Iterable<PublicationSnapshot>
  ownerPubkey: string
  community: CommunityPointer
}) => {
  const semanticKey = getCommunityStarOperationSemanticKey(community)
  const operation = Array.from(operations).find(
    candidate =>
      candidate.ownerPubkey === ownerPubkey &&
      candidate.semanticKey === semanticKey &&
      (candidate.phase === "publishing" || candidate.phase === "unconfirmed") &&
      candidate.preview === "rollback-on-failure",
  )

  if (!operation) {
    return {star, pending: false, operationId: undefined, retryOperationId: undefined}
  }
  if (operation.phase === "unconfirmed") {
    return {
      star,
      pending: false,
      operationId: undefined,
      retryOperationId: operation.operationId,
      retryDesiredStarred: operation.event.kind === REACTION,
      retryEventId: operation.event.id,
    }
  }

  if (operation.event.kind === REACTION) {
    const pendingStar = parseCommunityStarReaction(operation.event as TrustedEvent)
    if (pendingStar?.community.address === community.address) {
      return {
        star: pendingStar,
        pending: true,
        operationId: operation.operationId,
        retryOperationId: undefined,
        retryDesiredStarred: undefined,
        retryEventId: undefined,
      }
    }
  }

  if (operation.event.kind === DELETE) {
    return {
      star: undefined,
      pending: true,
      operationId: operation.operationId,
      retryOperationId: undefined,
      retryDesiredStarred: undefined,
      retryEventId: undefined,
    }
  }

  return {
    star,
    pending: false,
    operationId: undefined,
    retryOperationId: undefined,
    retryDesiredStarred: undefined,
    retryEventId: undefined,
  }
}
