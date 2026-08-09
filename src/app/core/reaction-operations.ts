import {
  DELETE,
  REACTION,
  getEmojiTag,
  getTag,
  getTagValue,
  getTagValues,
  normalizeRelayUrl,
  type EventContent,
  type TrustedEvent,
} from "@welshman/util"
import type {PublicationSnapshot} from "@app/core/publication-operations"

const REACTION_OPERATION_PREFIX = "reaction:"

export const getReactionIdentity = (event: EventContent) =>
  getEmojiTag(event.content, event.tags)?.join("") || event.content

export const getReactionTargetEventId = (reaction: EventContent) =>
  getTagValue("e", reaction.tags) || ""

export const getReactionOperationSemanticKey = (targetEventId: string, reaction: EventContent) =>
  `${REACTION_OPERATION_PREFIX}${targetEventId}:${encodeURIComponent(getReactionIdentity(reaction))}`

const getReactionOperationTargetPrefix = (targetEventId: string) =>
  `${REACTION_OPERATION_PREFIX}${targetEventId}:`

const normalizeRelay = (relay: string) => {
  try {
    return normalizeRelayUrl(relay)
  } catch {
    return ""
  }
}

const operationMatchesRelays = (operation: PublicationSnapshot, relays: string[]) => {
  const relaySet = new Set(relays.map(normalizeRelay).filter(Boolean))
  if (relaySet.size === 0) return true

  return Object.keys(operation.results).some(relay => relaySet.has(normalizeRelay(relay)))
}

const operationIsVisibleReactionMutation = ({
  operation,
  ownerPubkey,
  targetEventId,
  relays,
  scopeH,
  allowedAuthorSet,
}: {
  operation: PublicationSnapshot
  ownerPubkey: string
  targetEventId: string
  relays: string[]
  scopeH: string
  allowedAuthorSet?: Set<string>
}) =>
  operation.ownerPubkey === ownerPubkey &&
  operation.phase === "publishing" &&
  operation.preview === "rollback-on-failure" &&
  operation.semanticKey?.startsWith(getReactionOperationTargetPrefix(targetEventId)) &&
  operationMatchesRelays(operation, relays) &&
  (!scopeH || getTag("h", operation.event.tags)?.[1] === scopeH) &&
  (!allowedAuthorSet || allowedAuthorSet.has(operation.ownerPubkey.toLowerCase()))

export const projectReactionOperations = ({
  reactions,
  operations,
  targetEventId,
  ownerPubkey,
  relays = [],
  scopeH = "",
  allowedAuthors,
}: {
  reactions: TrustedEvent[]
  operations: Iterable<PublicationSnapshot>
  targetEventId: string
  ownerPubkey: string
  relays?: string[]
  scopeH?: string
  allowedAuthors?: string[]
}) => {
  const allowedAuthorSet = allowedAuthors
    ? new Set(allowedAuthors.map(author => author.toLowerCase()).filter(Boolean))
    : undefined
  const matchingOperations = Array.from(operations).filter(operation =>
    operationIsVisibleReactionMutation({
      operation,
      ownerPubkey,
      targetEventId,
      relays,
      scopeH,
      allowedAuthorSet,
    }),
  )
  const reactionsById = new Map(reactions.map(reaction => [reaction.id, reaction]))
  const pendingSemanticKeys = new Set<string>()

  for (const operation of matchingOperations) {
    if (operation.semanticKey) pendingSemanticKeys.add(operation.semanticKey)
    if (
      operation.event.kind === REACTION &&
      getReactionTargetEventId(operation.event) === targetEventId
    ) {
      reactionsById.set(operation.event.id, operation.event as TrustedEvent)
    }
  }

  for (const operation of matchingOperations) {
    if (operation.event.kind !== DELETE) continue
    for (const reactionId of getTagValues("e", operation.event.tags)) {
      reactionsById.delete(reactionId)
    }
  }

  return {
    reactions: Array.from(reactionsById.values()),
    pendingSemanticKeys,
  }
}
