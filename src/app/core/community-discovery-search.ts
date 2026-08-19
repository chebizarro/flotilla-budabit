import {get} from "svelte/store"
import {nip05} from "nostr-tools"
import {repository} from "@welshman/app"
import type {Filter, TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  normalizePubkey,
  normalizeRelays,
  parseCommunityNaddr,
  selectCurrentCommunityDefinitions,
  type CommunityDefinition,
} from "@app/core/community"
import {
  COMMUNITY_DISCOVERY_RELAYS,
  getPubkeyOutboxRelays,
  hydratePubkeyOutboxRelays,
  loadCommunityEvents,
} from "@app/core/community-state"
import {peopleDiscoverySearch} from "@app/core/people-discovery-search"
import {decodePeopleSearchPubkey} from "@app/util/people-search"

export const COMMUNITY_SEARCH_RESULT_LIMIT = 20
export const COMMUNITY_SEARCH_BOOTSTRAP_LIMIT = 80
export const COMMUNITY_SEARCH_CONTROLLER_LIMIT = 8
export const COMMUNITY_SEARCH_RELAYS_PER_CONTROLLER = 4

export type CommunitySearchQuery =
  | {type: "empty"}
  | {type: "exact"; value: NonNullable<ReturnType<typeof parseCommunityNaddr>>}
  | {type: "owner"; pubkey: string}
  | {type: "nip05"; identifier: string}
  | {type: "name"; text: string}

export type CommunitySearchResult = {
  definition: CommunityDefinition
  preferred: boolean
}

export type CommunitySearchBatch = {
  query: CommunitySearchQuery
  results: CommunitySearchResult[]
  incomplete: boolean
}

type Nip05Result = {pubkey: string; relays?: string[]}

export type CommunitySearchDependencies = {
  bootstrapRelays?: string[]
  preferredAddresses?: string[]
  localEvents?: TrustedEvent[]
  peopleCandidates?: string[]
  loadEvents?: (
    relays: string[],
    filters: Filter[],
    signal?: AbortSignal,
  ) => Promise<TrustedEvent[]>
  hydrateOutbox?: (pubkey: string, hints: string[]) => Promise<string[]>
  resolveNip05?: (identifier: string) => Promise<Nip05Result | undefined>
  signal?: AbortSignal
}

export const classifyCommunitySearchQuery = (value: string): CommunitySearchQuery => {
  const query = value.trim()
  if (!query) return {type: "empty"}

  const exact = parseCommunityNaddr(query)
  if (exact) return {type: "exact", value: exact}

  const pubkey = normalizePubkey(decodePeopleSearchPubkey(query) || "")
  if (pubkey) return {type: "owner", pubkey}

  if (/^[^\s@]+@[^\s@]+$/.test(query)) {
    return {type: "nip05", identifier: query.toLowerCase()}
  }

  return {type: "name", text: query}
}

const getTextScore = (definition: CommunityDefinition, query: string) => {
  const needle = query.trim().toLowerCase()
  const name = definition.metadata.name.toLowerCase()
  const description = definition.metadata.description?.toLowerCase() || ""
  if (name === needle) return 0
  if (name.startsWith(needle)) return 1
  if (name.includes(needle)) return 2
  if (description.includes(needle)) return 3
  return Number.POSITIVE_INFINITY
}

export const rankCommunitySearchDefinitions = ({
  definitions,
  query,
  preferredAddresses = [],
  candidateOwnerPubkeys = [],
}: {
  definitions: CommunityDefinition[]
  query?: string
  preferredAddresses?: string[]
  candidateOwnerPubkeys?: string[]
}) => {
  const preferred = new Set(preferredAddresses)
  const controllerRank = new Map(
    candidateOwnerPubkeys.map((owner, index) => [owner, index]),
  )
  return definitions
    .map(definition => ({
      definition,
      preferred: preferred.has(definition.pointer.address),
      score: query ? getTextScore(definition, query) : 0,
      trustRank:
        controllerRank.get(definition.ownerPubkey) ?? candidateOwnerPubkeys.length,
    }))
    .filter(result => Number.isFinite(result.score))
    .sort(
      (a, b) =>
        Number(b.preferred) - Number(a.preferred) ||
        a.score - b.score ||
        a.trustRank - b.trustRank ||
        b.definition.event.created_at - a.definition.event.created_at ||
        a.definition.pointer.address.localeCompare(b.definition.pointer.address),
    )
}

const defaultLoadEvents = (relays: string[], filters: Filter[], signal?: AbortSignal) =>
  loadCommunityEvents(relays, filters, {signal, timeout: 3000})

const defaultResolveNip05 = async (identifier: string): Promise<Nip05Result | undefined> => {
  const result = await nip05.queryProfile(identifier).catch(() => null)
  const pubkey = normalizePubkey(result?.pubkey || "")
  return pubkey ? {pubkey, relays: result?.relays} : undefined
}

const getDefinitions = (events: TrustedEvent[]) =>
  Array.from(selectCurrentCommunityDefinitions(events).values())

export const searchCommunities = async (
  value: string,
  dependencies: CommunitySearchDependencies = {},
): Promise<CommunitySearchBatch> => {
  const query = classifyCommunitySearchQuery(value)
  const bootstrapRelays = normalizeRelays(
    dependencies.bootstrapRelays || COMMUNITY_DISCOVERY_RELAYS,
  )
  const loadEvents = dependencies.loadEvents || defaultLoadEvents
  const hydrateOutbox = dependencies.hydrateOutbox || hydratePubkeyOutboxRelays
  const resolveNip05 = dependencies.resolveNip05 || defaultResolveNip05
  const localEvents =
    dependencies.localEvents || repository.query([{kinds: [COMMUNITY_DEFINITION_KIND]}])
  const preferredAddresses = dependencies.preferredAddresses || []
  const loadedEvents = [...localEvents]
  let incomplete = false

  if (query.type === "empty") {
    return {
      query,
      results: rankCommunitySearchDefinitions({
        definitions: getDefinitions(loadedEvents),
        preferredAddresses,
      }).slice(0, COMMUNITY_SEARCH_RESULT_LIMIT),
      incomplete: false,
    }
  }

  let ownerPubkeys: string[] = []
  let controllerHints: string[] = []
  let textQuery: string | undefined
  let filters: Filter[] = []

  if (query.type === "exact") {
    ownerPubkeys = [query.value.ownerPubkey]
    controllerHints = query.value.relayHints
    filters = [
      {
        kinds: [COMMUNITY_DEFINITION_KIND],
        authors: [query.value.ownerPubkey],
        "#d": [query.value.communityId],
        limit: COMMUNITY_SEARCH_BOOTSTRAP_LIMIT,
      },
    ]
  } else if (query.type === "owner") {
    ownerPubkeys = [query.pubkey]
    filters = [
      {
        kinds: [COMMUNITY_DEFINITION_KIND],
        authors: ownerPubkeys,
        limit: COMMUNITY_SEARCH_BOOTSTRAP_LIMIT,
      },
    ]
  } else if (query.type === "nip05") {
    const resolved = await resolveNip05(query.identifier)
    if (!resolved || dependencies.signal?.aborted) return {query, results: [], incomplete: false}
    ownerPubkeys = [resolved.pubkey]
    controllerHints = resolved.relays || []
    filters = [
      {
        kinds: [COMMUNITY_DEFINITION_KIND],
        authors: ownerPubkeys,
        limit: COMMUNITY_SEARCH_BOOTSTRAP_LIMIT,
      },
    ]
  } else {
    textQuery = query.text
    const peopleCandidates =
      dependencies.peopleCandidates ||
      get(peopleDiscoverySearch).searchValues(query.text, {
        resultLimit: COMMUNITY_SEARCH_CONTROLLER_LIMIT,
        scanLimit: 320,
      })
    ownerPubkeys = peopleCandidates
      .map(normalizePubkey)
      .filter(Boolean)
      .slice(0, COMMUNITY_SEARCH_CONTROLLER_LIMIT)
    filters = [
      {
        kinds: [COMMUNITY_DEFINITION_KIND],
        search: query.text,
        limit: COMMUNITY_SEARCH_BOOTSTRAP_LIMIT,
      },
      {kinds: [COMMUNITY_DEFINITION_KIND], limit: COMMUNITY_SEARCH_BOOTSTRAP_LIMIT},
      ...(ownerPubkeys.length
        ? [
            {
              kinds: [COMMUNITY_DEFINITION_KIND],
              authors: ownerPubkeys,
              limit: COMMUNITY_SEARCH_BOOTSTRAP_LIMIT,
            },
          ]
        : []),
    ]
  }

  const discoveryRelays = normalizeRelays([...bootstrapRelays, ...controllerHints])
  const bootstrapEvents = await loadEvents(discoveryRelays, filters, dependencies.signal)
  if (dependencies.signal?.aborted) return {query, results: [], incomplete: false}
  loadedEvents.push(...bootstrapEvents)
  if (bootstrapEvents.length >= COMMUNITY_SEARCH_BOOTSTRAP_LIMIT) incomplete = true

  if (textQuery) {
    const matchingControllers = rankCommunitySearchDefinitions({
      definitions: getDefinitions(loadedEvents),
      query: textQuery,
      preferredAddresses,
    }).map(result => result.definition.ownerPubkey)
    ownerPubkeys = Array.from(new Set([...matchingControllers, ...ownerPubkeys])).slice(
      0,
      COMMUNITY_SEARCH_CONTROLLER_LIMIT,
    )
  }

  await Promise.all(
    ownerPubkeys.map(async owner => {
      const relays = normalizeRelays([
        ...getPubkeyOutboxRelays([owner]),
        ...(await hydrateOutbox(
          owner,
          normalizeRelays([...bootstrapRelays, ...controllerHints]),
        )),
      ])
        .filter(relay => !discoveryRelays.includes(relay))
        .slice(0, COMMUNITY_SEARCH_RELAYS_PER_CONTROLLER)
      if (relays.length === 0 || dependencies.signal?.aborted) return
      const events = await loadEvents(
        relays,
        [
          query.type === "exact"
            ? filters[0]
            : {
                kinds: [COMMUNITY_DEFINITION_KIND],
                authors: [owner],
                limit: COMMUNITY_SEARCH_BOOTSTRAP_LIMIT,
              },
        ],
        dependencies.signal,
      )
      loadedEvents.push(...events)
    }),
  )
  if (dependencies.signal?.aborted) return {query, results: [], incomplete: false}

  let definitions = getDefinitions(loadedEvents)
  if (query.type === "exact") {
    definitions = definitions.filter(
      definition => definition.pointer.address === query.value.address,
    )
  } else if (query.type === "owner" || query.type === "nip05") {
    definitions = definitions.filter(definition =>
      ownerPubkeys.includes(definition.ownerPubkey),
    )
  }
  const ranked = rankCommunitySearchDefinitions({
    definitions,
    query: textQuery,
    preferredAddresses,
    candidateOwnerPubkeys: ownerPubkeys,
  })
  if (ranked.length > COMMUNITY_SEARCH_RESULT_LIMIT) incomplete = true

  return {
    query,
    results: ranked.slice(0, COMMUNITY_SEARCH_RESULT_LIMIT).map(({definition, preferred}) => ({
      definition,
      preferred,
    })),
    incomplete,
  }
}
