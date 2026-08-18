import type {Filter, TrustedEvent} from "@welshman/util"
import {
  COMMENT,
  EVENT_DATE,
  EVENT_TIME,
  MESSAGE,
  REACTION,
  THREAD,
  ZAP_GOAL,
  getTag,
  getTagValue,
} from "@welshman/util"
import {
  TARGETED_PUBLICATION_KIND_V2,
  TARGETED_PUBLICATION_KINDS,
  normalizePubkey,
  normalizeRelays,
  parseCommunityId,
  parseTargetedPublicationV2,
} from "@app/core/community"
import {GIT_REPO_ANNOUNCEMENT} from "@nostr-git/core/events"

export const GIT_PERMALINK_KIND = 1623
export const SMART_WIDGET_KIND = 30033

export const COMMUNITY_EXCLUSIVE_KINDS = [THREAD, MESSAGE, COMMENT, REACTION, 1985, 5, 1984]
export const COMMUNITY_TARGETABLE_KINDS = [
  EVENT_DATE,
  EVENT_TIME,
  ZAP_GOAL,
  GIT_REPO_ANNOUNCEMENT,
  GIT_PERMALINK_KIND,
  SMART_WIDGET_KIND,
] as const

export type CommunityContentFilterPlan = {
  relayFilters: Filter[]
  localFilters: Filter[]
}

export type TargetedPublicationOriginalRelayHintPlan = CommunityContentFilterPlan & {
  relays: string[]
}

export const makeCommunityContentFilterPlan = (
  structuralFilters: Filter[],
  allowedAuthors: string[],
): CommunityContentFilterPlan => {
  if (allowedAuthors.length === 0) return {relayFilters: [], localFilters: []}

  return {
    relayFilters: structuralFilters.map(filter => {
      const {authors: _policyAuthors, ...structuralFilter} = filter
      void _policyAuthors

      return structuralFilter
    }),
    localFilters: structuralFilters.map(filter => ({...filter, authors: allowedAuthors})),
  }
}

export const makeCommunityScopedFilterPlan = (
  structuralFilters: Filter[],
  scopeH: string,
  allowedAuthors?: string[],
): CommunityContentFilterPlan => {
  const scopedFilters = scopeH
    ? structuralFilters.map(filter => ({...filter, "#h": [scopeH]}))
    : structuralFilters

  if (allowedAuthors === undefined) {
    return {relayFilters: scopedFilters, localFilters: scopedFilters}
  }
  if (allowedAuthors.length === 0) {
    return {relayFilters: [], localFilters: []}
  }
  if (scopeH) {
    return makeCommunityContentFilterPlan(scopedFilters, allowedAuthors)
  }

  const localFilters = scopedFilters.map(filter => ({...filter, authors: allowedAuthors}))

  return {relayFilters: localFilters, localFilters}
}

export const makeCommunityExclusiveFilter = (
  communityPubkey: string,
  kinds: number[] = COMMUNITY_EXCLUSIVE_KINDS,
  extra: Filter = {},
): Filter => ({
  kinds,
  "#h": [communityPubkey],
  ...extra,
})

export const makeCommunityRoomRootsFilter = (communityPubkey: string, extra: Filter = {}): Filter =>
  makeCommunityExclusiveFilter(communityPubkey, [THREAD], extra)

export const makeCommunityThreadsFilter = (communityPubkey: string, extra: Filter = {}): Filter =>
  makeCommunityExclusiveFilter(communityPubkey, [THREAD], extra)

export const makeCommunityThreadRepliesFilter = (
  communityPubkey: string,
  extra: Filter = {},
): Filter =>
  makeCommunityExclusiveFilter(communityPubkey, [COMMENT], {"#K": [String(THREAD)], ...extra})

export const makeCommunityRoomMessagesFilter = (
  communityPubkey: string,
  roomRootId: string,
  extra: Filter = {},
): Filter =>
  makeCommunityExclusiveFilter(communityPubkey, [MESSAGE], {"#E": [roomRootId], ...extra})

export const makeCommunityRepositoryFilter = (
  communityPubkey: string,
  extra: Filter = {},
): Filter => makeCommunityExclusiveFilter(communityPubkey, [GIT_REPO_ANNOUNCEMENT], extra)

export const makeCommunityTargetingFilter = (
  communityId: string,
  originalKinds: readonly number[] = TARGETED_PUBLICATION_KINDS,
  extra: Filter = {},
): Filter => ({
  kinds: [TARGETED_PUBLICATION_KIND_V2],
  "#h": [communityId],
  "#k": originalKinds.map(String),
  ...extra,
})

export const eventTargetsCommunity = (event: TrustedEvent, communityIdValue: string) => {
  const communityId = parseCommunityId(communityIdValue)
  const hTags = event.tags.filter(tag => tag[0] === "h")
  if (!communityId || hTags.length !== 1 || hTags[0].length !== 2) return false
  if (event.tags.some(tag => tag[0] === "p" && tag[1] === communityId)) return false

  return parseCommunityId(hTags[0][1] || "") === communityId
}

export const isRoomRoot = (event: TrustedEvent, communityPubkey?: string) => {
  if (event.kind !== THREAD) return false
  if (communityPubkey && !eventTargetsCommunity(event, communityPubkey)) return false

  return Boolean(getTag("room", event.tags))
}

export const isThreadRoot = (event: TrustedEvent, communityPubkey?: string) => {
  if (event.kind !== THREAD) return false
  if (communityPubkey && !eventTargetsCommunity(event, communityPubkey)) return false

  return !getTag("room", event.tags)
}

export const filterRoomRoots = (events: TrustedEvent[], communityPubkey?: string) =>
  events.filter(event => isRoomRoot(event, communityPubkey))

export const filterThreadRoots = (events: TrustedEvent[], communityPubkey?: string) =>
  events.filter(event => isThreadRoot(event, communityPubkey))

export const getRoomRootIdForMessage = (event: TrustedEvent) => {
  if (event.kind !== MESSAGE) return ""

  return getTagValue("E", event.tags) || getTagValue("e", event.tags) || ""
}

export const isRoomMessage = (
  event: TrustedEvent,
  communityPubkey?: string,
  roomRootId?: string,
) => {
  if (event.kind !== MESSAGE) return false
  if (communityPubkey && !eventTargetsCommunity(event, communityPubkey)) return false
  if (roomRootId && getRoomRootIdForMessage(event) !== roomRootId) return false

  return Boolean(getRoomRootIdForMessage(event))
}

export const makeTargetedPublicationOriginalFilters = (
  targetingEvents: TrustedEvent[],
  allowedAuthors?: string[],
): Filter[] => {
  const filters: Filter[] = []
  const allowedAuthorSet = allowedAuthors?.length
    ? new Set(allowedAuthors.map(normalizePubkey).filter(Boolean))
    : undefined

  for (const event of targetingEvents) {
    const targeting = parseTargetedPublicationV2(event)
    if (!targeting) continue

    if (!targeting.source) {
      filters.push({
        kinds: [targeting.kind],
        "#h": [targeting.id],
        limit: 1,
        ...(allowedAuthors?.length ? {authors: allowedAuthors} : {}),
      })
      continue
    }

    if (targeting.source.type === "e") {
      filters.push({
        kinds: [targeting.kind],
        ids: [targeting.source.value],
        limit: 1,
        ...(allowedAuthors?.length ? {authors: allowedAuthors} : {}),
      })
      continue
    }

    const [kindValue, author, ...identifierParts] = targeting.source.value.split(":")
    const kind = Number.parseInt(kindValue || "", 10)
    const identifier = identifierParts.join(":")

    if (!Number.isInteger(kind) || !author || !identifier) continue
    if (allowedAuthorSet && !allowedAuthorSet.has(normalizePubkey(author))) continue

    filters.push({kinds: [kind], authors: [author], "#d": [identifier], limit: 1})
  }

  return filters
}

export const makeTargetedPublicationOriginalFilterPlan = (
  authorizedTargetingEvents: TrustedEvent[],
): CommunityContentFilterPlan => {
  const relayFilters: Filter[] = []
  const localFilters: Filter[] = []

  for (const event of authorizedTargetingEvents) {
    const targeting = parseTargetedPublicationV2(event)
    if (!targeting) continue

    if (!targeting.source) {
      const filter = {
        kinds: [targeting.kind],
        authors: [event.pubkey],
        "#h": [targeting.id],
        limit: 1,
      }
      relayFilters.push(filter)
      localFilters.push(filter)
      continue
    }

    if (targeting.source.type === "e") {
      const filter = {kinds: [targeting.kind], ids: [targeting.source.value], limit: 1}
      relayFilters.push(filter)
      localFilters.push(filter)
      continue
    }

    const [kindValue, author, ...identifierParts] = targeting.source.value.split(":")
    const kind = Number.parseInt(kindValue || "", 10)
    const identifier = identifierParts.join(":")

    if (!Number.isInteger(kind) || kind !== targeting.kind || !author || !identifier) continue

    const filter = {kinds: [kind], authors: [author], "#d": [identifier], limit: 1}
    relayFilters.push(filter)
    localFilters.push(filter)
  }

  return {relayFilters, localFilters}
}

export const makeTargetedPublicationOriginalRelayHintPlans = (
  authorizedTargetingEvents: TrustedEvent[],
): TargetedPublicationOriginalRelayHintPlan[] => {
  const eventsByRelay = new Map<string, TrustedEvent[]>()

  for (const event of authorizedTargetingEvents) {
    const source = parseTargetedPublicationV2(event)?.source
    if (!source?.relay) continue

    const relay = normalizeRelays([source.relay])[0]
    if (!relay) continue

    const events = eventsByRelay.get(relay) || []
    events.push(event)
    eventsByRelay.set(relay, events)
  }

  return Array.from(eventsByRelay, ([relay, events]) => ({
    relays: [relay],
    ...makeTargetedPublicationOriginalFilterPlan(events),
  }))
}
