import type {Filter, TrustedEvent} from "@welshman/util"
import {
  TARGETED_PUBLICATION_KIND,
  normalizeRelays,
  type TargetedPublicationSource,
} from "@app/core/community"

export type LegacyTargetedPublication = {
  id: string
  kind: number
  communityPubkey: string
  source?: TargetedPublicationSource
}

export const makeLegacyCommunityTargetingFilter = (
  communityPubkey: string,
  originalKinds: readonly number[],
): Filter => ({
  kinds: [TARGETED_PUBLICATION_KIND],
  "#p": [communityPubkey],
  "#k": originalKinds.map(String),
})

export const parseLegacyTargetedPublication = (
  event: TrustedEvent,
): LegacyTargetedPublication | undefined => {
  if (event.kind !== TARGETED_PUBLICATION_KIND || event.content !== "") return undefined

  const dTags = event.tags.filter(tag => tag[0] === "d")
  const kTags = event.tags.filter(tag => tag[0] === "k")
  const pTags = event.tags.filter(tag => tag[0] === "p")
  if (dTags.length !== 1 || dTags[0].length !== 2 || !dTags[0][1]) return undefined
  if (kTags.length !== 1 || kTags[0].length !== 2) return undefined
  if (pTags.length !== 1 || pTags[0].length !== 2 || !pTags[0][1]) return undefined

  const kind = Number.parseInt(kTags[0][1], 10)
  if (!Number.isInteger(kind) || String(kind) !== kTags[0][1]) return undefined

  const sourceTags = event.tags.filter(tag => tag[0] === "a" || tag[0] === "e")
  if (sourceTags.length > 1) return undefined

  const sourceTag = sourceTags[0]
  const source = sourceTag
    ? {
        type: sourceTag[0] as "a" | "e",
        value: sourceTag[1] || "",
        ...(sourceTag[2] ? {relay: sourceTag[2]} : {}),
        ...(sourceTag[0] === "e" && sourceTag[3] ? {pubkey: sourceTag[3]} : {}),
      }
    : undefined
  if (source && !source.value) return undefined

  return {
    id: dTags[0][1],
    kind,
    communityPubkey: pTags[0][1],
    ...(source ? {source} : {}),
  }
}

export const selectCurrentLegacyTargetedPublicationEvents = (events: TrustedEvent[]) => {
  const selected = new Map<string, TrustedEvent>()

  for (const event of events) {
    const targeting = parseLegacyTargetedPublication(event)
    if (!targeting) continue

    const address = `${event.kind}:${event.pubkey}:${targeting.id}`
    const current = selected.get(address)
    if (
      !current ||
      event.created_at > current.created_at ||
      (event.created_at === current.created_at && event.id < current.id)
    ) {
      selected.set(address, event)
    }
  }

  return Array.from(selected.values())
}

export const makeLegacyTargetedPublicationOriginalFilterPlan = (events: TrustedEvent[]) => {
  const relayFilters: Filter[] = []
  const localFilters: Filter[] = []

  for (const event of events) {
    const targeting = parseLegacyTargetedPublication(event)
    if (!targeting) continue

    let filter: Filter | undefined
    if (!targeting.source) {
      filter = {
        kinds: [targeting.kind],
        authors: [event.pubkey],
        "#h": [targeting.id],
        limit: 1,
      }
    } else if (targeting.source.type === "e") {
      filter = {kinds: [targeting.kind], ids: [targeting.source.value], limit: 1}
    } else {
      const [kindValue, author, ...identifierParts] = targeting.source.value.split(":")
      const kind = Number.parseInt(kindValue || "", 10)
      const identifier = identifierParts.join(":")

      if (Number.isInteger(kind) && kind === targeting.kind && author && identifier) {
        filter = {kinds: [kind], authors: [author], "#d": [identifier], limit: 1}
      }
    }

    if (filter) {
      relayFilters.push(filter)
      localFilters.push(filter)
    }
  }

  return {relayFilters, localFilters}
}

export const makeLegacyTargetedPublicationOriginalRelayHintPlans = (events: TrustedEvent[]) => {
  const eventsByRelay = new Map<string, TrustedEvent[]>()

  for (const event of events) {
    const source = parseLegacyTargetedPublication(event)?.source
    if (!source?.relay) continue

    const relay = normalizeRelays([source.relay])[0]
    if (!relay) continue

    const relayEvents = eventsByRelay.get(relay) || []
    relayEvents.push(event)
    eventsByRelay.set(relay, relayEvents)
  }

  return Array.from(eventsByRelay, ([relay, relayEvents]) => ({
    relays: [relay],
    ...makeLegacyTargetedPublicationOriginalFilterPlan(relayEvents),
  }))
}
