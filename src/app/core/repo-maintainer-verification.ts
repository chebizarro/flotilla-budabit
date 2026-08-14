import {
  GIT_STATUS_APPLIED,
  type PullRequestEvent,
  type RepoAnnouncementEvent,
  type StatusEvent,
} from "@nostr-git/core/events"
import {getTagValue} from "@welshman/util"
import {nip19} from "nostr-tools"
import {getRepoDeclaredMaintainers} from "@app/core/repo-authority"

const normalizePubkey = (value: string) => {
  if (/^[0-9a-f]{64}$/i.test(value)) return value
  if (!value.startsWith("npub")) return ""

  try {
    const decoded = nip19.decode(value)
    return decoded.type === "npub" && typeof decoded.data === "string" ? decoded.data : ""
  } catch {
    return ""
  }
}

export const getStatusRootId = (status: Pick<StatusEvent, "tags">) =>
  status.tags.find(tag => tag[0] === "e" && tag[3] === "root")?.[1] ||
  getTagValue("e", status.tags) ||
  ""

export const groupStatusEventsByRoot = (events: StatusEvent[] | undefined | null) => {
  const byId = new Map<string, StatusEvent>()

  for (const event of events || []) byId.set(event.id, event)

  const byRoot = new Map<string, StatusEvent[]>()
  for (const event of byId.values()) {
    const rootId = getStatusRootId(event)
    if (!rootId) continue

    const statuses = byRoot.get(rootId) || []
    statuses.push(event)
    byRoot.set(rootId, statuses)
  }

  return byRoot
}

export const getVerifiedRepoMaintainers = ({
  repoEvent,
  pullRequests = [],
  statusEventsByRoot = new Map<string, StatusEvent[]>(),
}: {
  repoEvent?: RepoAnnouncementEvent | null
  pullRequests?: PullRequestEvent[]
  statusEventsByRoot?: ReadonlyMap<string, StatusEvent[]>
}) => {
  const owner = normalizePubkey(repoEvent?.pubkey || "")
  const declaredMaintainers = new Set(getRepoDeclaredMaintainers(repoEvent))
  const verified = new Set<string>()

  if (!owner || declaredMaintainers.size === 0) return verified

  for (const pullRequest of pullRequests) {
    const author = normalizePubkey(pullRequest.pubkey || "")
    if (!declaredMaintainers.has(author)) continue

    const ownerMerged = (statusEventsByRoot.get(pullRequest.id) || []).some(
      status =>
        status.kind === GIT_STATUS_APPLIED &&
        normalizePubkey(status.pubkey || "") === owner &&
        getStatusRootId(status) === pullRequest.id,
    )

    if (ownerMerged) verified.add(author)
  }

  return verified
}
