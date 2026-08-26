import type {TrustedEvent} from "@welshman/util"
import {
  isPublicationPreviewVisible,
  type PublicationSnapshot,
} from "@app/core/publication-operations"

export const projectAuthoredPublicationEvents = ({
  events,
  operations,
  ownerPubkey,
  matches,
  matchesOperation,
}: {
  events: TrustedEvent[]
  operations: Iterable<PublicationSnapshot>
  ownerPubkey: string
  matches: (event: TrustedEvent) => boolean
  matchesOperation?: (event: TrustedEvent, operation: PublicationSnapshot) => boolean
}) => {
  const eventsById = new Map(events.map(event => [event.id, event]))
  const operationIds = new Map<string, string>()

  for (const operation of operations) {
    if (
      operation.ownerPubkey !== ownerPubkey ||
      operation.preview !== "retain-on-failure" ||
      !isPublicationPreviewVisible(operation)
    )
      continue

    const event = operation.event as TrustedEvent
    if (!matches(event) && !matchesOperation?.(event, operation)) continue

    if (!eventsById.has(event.id)) eventsById.set(event.id, event)
    operationIds.set(event.id, operation.operationId)
  }

  return {events: Array.from(eventsById.values()), operationIds}
}
