import {getTagValue} from "@welshman/util"
import {parseRepoCommunityBinding, type RepoAnnouncementEvent} from "@nostr-git/core/events"
import {getRepoDeclaredMaintainers} from "@app/core/repo-authority"
import {getDeclaredRepoRelays} from "@app/core/repo-publication"
import {getCanonicalRepoKeyFromEvent, getRepoAddressFromEvent} from "@app/util/bookmarks"

export type RepoListCardSource = {
  first?: RepoAnnouncementEvent | null
  euc?: string
  owner?: string
  title?: string
}

export type RepoListCardModel<T extends RepoListCardSource = RepoListCardSource> = {
  card: T
  event: RepoAnnouncementEvent
  announcementId: string
  address: string
  stableKey: string
  owner: string
  maintainers: string[]
  communityAddress: string
  communityRelay: string
  declaredRelays: string[]
  canonicalKeys: string[]
}

const buildStableKey = (card: RepoListCardSource, event: RepoAnnouncementEvent) => {
  const euc = card.euc || ""
  const d = getTagValue("d", event.tags)
  if (d) return `${event.kind}:${event.pubkey}:${d}:${euc}`

  const eucTag = event.tags.find(tag => tag[0] === "r" && tag[2] === "euc")?.[1] || ""
  if (eucTag) return `${event.kind}:${event.pubkey}:euc:${eucTag}:${euc}`
  if (event.id) return `${event.kind}:${event.pubkey}:id:${event.id}:${euc}`
  return `${euc}:${card.title || ""}`
}

export const createRepoListCardProjector = (maxEntries = 100) => {
  const cache = new Map<string, RepoListCardModel>()

  return <T extends RepoListCardSource>(card: T): RepoListCardModel<T> | undefined => {
    const event = card.first
    if (!event) return undefined

    const cacheKey = `${event.id}:${card.euc || ""}`
    const existing = cache.get(cacheKey)
    if (existing) {
      cache.delete(cacheKey)
      cache.set(cacheKey, existing)
      const current = existing as RepoListCardModel<T>
      current.card = card
      return current
    }

    const canonicalKey = getCanonicalRepoKeyFromEvent(event)
    const community = parseRepoCommunityBinding(event)
    const model: RepoListCardModel<T> = {
      card,
      event,
      announcementId: event.id,
      address: getRepoAddressFromEvent(event),
      stableKey: buildStableKey(card, event),
      owner: card.owner || event.pubkey,
      maintainers: getRepoDeclaredMaintainers(event),
      communityAddress: community?.address || "",
      communityRelay: community?.relay || "",
      declaredRelays: getDeclaredRepoRelays(event),
      canonicalKeys: canonicalKey ? [canonicalKey] : [],
    }
    cache.set(cacheKey, model)
    while (cache.size > Math.max(1, maxEntries)) {
      cache.delete(cache.keys().next().value as string)
    }
    return model
  }
}
