import {repository} from "@welshman/app"
import {getTagValue, type HashedEvent, type TrustedEvent} from "@welshman/util"

export const assertReplaceablePublicationIsCurrent = (event: HashedEvent) => {
  const identifier = getTagValue("d", event.tags)
  if (!identifier) throw new Error("Publication has no replaceable address")

  const candidates = repository.query(
    [{kinds: [event.kind], authors: [event.pubkey], "#d": [identifier]}],
    {shouldSort: false},
  ) as TrustedEvent[]
  const newer = candidates.find(
    candidate => candidate.id !== event.id && candidate.created_at >= event.created_at,
  )

  if (newer) throw new Error("A newer version of this publication already exists")
}
