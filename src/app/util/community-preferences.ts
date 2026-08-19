import type {TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  FORM_TEMPLATE_KIND,
  PROFILE_LIST_KIND,
  type CommunityDefinition,
  type CommunityPointer,
  isRenouncedCommunitiesListEvent,
  isProfileListDeclined,
  normalizePubkey,
  normalizeRelays,
  parseAddressRef,
  selectCurrentAddressableEvent,
  selectCurrentCommunityDefinitions,
} from "@app/core/community"
import {parseAdmissionForm} from "@app/core/community-forms"
import type {CommunityStarRef} from "@app/util/community-stars"

export const COMMUNITY_PREFERENCE_SCORE = {
  star: 1,
  member: 2,
  moderator: 4,
  admin: 8,
} as const

export const COMMUNITY_PREFERENCE_LIMIT = 200

export type PreferredCommunityRef = {
  communityPubkey: string
  communityAddress: string
  pointer: CommunityPointer
  relayHints: string[]
  score: number
  lastInteractedAt: number
  isStarred: boolean
  isMember: boolean
  isModerator: boolean
  isAdmin: boolean
  star?: CommunityStarRef
}

type MemberCommunityRefInput = {
  community: CommunityPointer
  relayHints?: string[]
  roles?: string[]
  definition?: Pick<CommunityDefinition, "event" | "pointer" | "relays">
}

type PreferenceInput = {
  stars?: CommunityStarRef[]
  memberCommunityRefs?: MemberCommunityRefInput[]
  adminDefinitionEvents?: TrustedEvent[]
  moderatorFormEvents?: TrustedEvent[]
  moderatorProfileListEvents?: TrustedEvent[]
  moderatorDefinitionEvents?: TrustedEvent[]
  excludedCommunityAddresses?: string[]
  author?: string
}

type MutablePreference = PreferredCommunityRef & {
  scoreParts: Set<keyof typeof COMMUNITY_PREFERENCE_SCORE>
}

const getDTag = (event: TrustedEvent) => event.tags.find(tag => tag[0] === "d")?.[1] || ""

const getAddress = (event: TrustedEvent) => {
  const identifier = getDTag(event)

  return identifier ? `${event.kind}:${event.pubkey}:${identifier}` : ""
}

export const makeCommunityAdminDefinitionFilter = (author: string) => {
  const pubkey = normalizePubkey(author)
  if (!pubkey) return undefined

  return {
    kinds: [COMMUNITY_DEFINITION_KIND],
    authors: [pubkey],
    limit: COMMUNITY_PREFERENCE_LIMIT,
  }
}

export const makeCommunityModeratorFormFilter = (author: string) => {
  const pubkey = normalizePubkey(author)
  if (!pubkey) return undefined

  return {kinds: [FORM_TEMPLATE_KIND], authors: [pubkey], limit: COMMUNITY_PREFERENCE_LIMIT}
}

export const makeCommunityModeratorProfileListFilter = (author: string) => {
  const pubkey = normalizePubkey(author)
  if (!pubkey) return undefined

  return {kinds: [PROFILE_LIST_KIND], authors: [pubkey], limit: COMMUNITY_PREFERENCE_LIMIT}
}

export const makeCommunityDefinitionProfileListRefFilters = (profileListEvents: TrustedEvent[]) => {
  const addresses = Array.from(
    new Set(
      profileListEvents
        .filter(event => event.kind === PROFILE_LIST_KIND)
        .filter(event => !isRenouncedCommunitiesListEvent(event))
        .map(getAddress)
        .filter(Boolean),
    ),
  )

  return addresses.map(address => ({
    kinds: [COMMUNITY_DEFINITION_KIND],
    "#a": [address],
    limit: COMMUNITY_PREFERENCE_LIMIT,
  }))
}

const addRole = (
  preferences: Map<string, MutablePreference>,
  pointer: CommunityPointer,
  role: keyof typeof COMMUNITY_PREFERENCE_SCORE,
  options: {
    relayHints?: string[]
    lastInteractedAt?: number
    star?: CommunityStarRef
  } = {},
) => {
  const normalizedCommunity = normalizePubkey(pointer.ownerPubkey)
  if (!normalizedCommunity) return
  const key = pointer.address

  const current = preferences.get(key) || {
    communityPubkey: normalizedCommunity,
    communityAddress: pointer.address,
    pointer,
    relayHints: [],
    score: 0,
    lastInteractedAt: 0,
    isStarred: false,
    isMember: false,
    isModerator: false,
    isAdmin: false,
    scoreParts: new Set(),
  }

  current.scoreParts.add(role)
  current.score = Array.from(current.scoreParts).reduce(
    (sum, part) => sum + COMMUNITY_PREFERENCE_SCORE[part],
    0,
  )
  current.relayHints = normalizeRelays([...current.relayHints, ...(options.relayHints || [])])
  current.lastInteractedAt = Math.max(current.lastInteractedAt, options.lastInteractedAt || 0)
  current.isStarred = current.scoreParts.has("star")
  current.isMember =
    current.scoreParts.has("member") &&
    !current.scoreParts.has("moderator") &&
    !current.scoreParts.has("admin")
  current.isModerator = current.scoreParts.has("moderator")
  current.isAdmin = current.scoreParts.has("admin")
  if (options.star) current.star = options.star

  preferences.set(key, current)
}

const getLatestDefinitionsByAddress = (events: TrustedEvent[]) => {
  return selectCurrentCommunityDefinitions(events)
}

export const getModeratorProfileListEventMap = (events: TrustedEvent[], author?: string) => {
  const normalizedAuthor = author ? normalizePubkey(author) : ""
  const profileLists = new Map<string, TrustedEvent>()
  const addresses = new Set<string>()

  for (const event of events) {
    if (event.kind !== PROFILE_LIST_KIND) continue
    if (isRenouncedCommunitiesListEvent(event)) continue
    if (normalizedAuthor && event.pubkey !== normalizedAuthor) continue

    const address = getAddress(event)
    if (!address) continue
    addresses.add(address)
  }

  for (const address of addresses) {
    const current = selectCurrentAddressableEvent(
      events,
      address,
      event => event.kind === PROFILE_LIST_KIND && !isRenouncedCommunitiesListEvent(event),
      event => {
        const deletedAddresses = event.tags.filter(tag => tag[0] === "a")
        return (
          deletedAddresses.length === 1 &&
          deletedAddresses[0].length === 2 &&
          deletedAddresses[0][1] === address
        )
      },
    )

    if (current && !isProfileListDeclined(current)) profileLists.set(address, current)
  }

  return profileLists
}

const getModeratorEvidence = ({
  definition,
  moderatorProfileListEvents,
  author,
}: {
  definition: CommunityDefinition
  moderatorProfileListEvents: Map<string, TrustedEvent>
  author: string
}) => {
  let latestAt = 0

  for (const section of definition.sections) {
    for (const profileList of section.profileLists) {
      if (parseAddressRef(profileList.address)?.pubkey !== author) continue
      const event = moderatorProfileListEvents.get(profileList.address)
      if (event) latestAt = Math.max(latestAt, event.created_at)
    }
  }

  return latestAt
}

export const selectPreferredCommunities = ({
  stars = [],
  memberCommunityRefs = [],
  adminDefinitionEvents = [],
  moderatorFormEvents = [],
  moderatorProfileListEvents = [],
  moderatorDefinitionEvents = [],
  excludedCommunityAddresses = [],
  author,
}: PreferenceInput): PreferredCommunityRef[] => {
  const normalizedAuthor = author ? normalizePubkey(author) : ""
  const preferences = new Map<string, MutablePreference>()
  const excludedCommunities = new Set(excludedCommunityAddresses)
  const definitions = getLatestDefinitionsByAddress([
    ...adminDefinitionEvents,
    ...moderatorDefinitionEvents,
  ])
  const moderatorProfileListEventMap = getModeratorProfileListEventMap(
    moderatorProfileListEvents,
    normalizedAuthor,
  )

  for (const star of stars) {
    addRole(preferences, star.community, "star", {
      relayHints: star.community.relayHints,
      lastInteractedAt: star.reaction.created_at,
      star,
    })
  }

  for (const definition of selectCurrentCommunityDefinitions(adminDefinitionEvents).values()) {
    if (normalizedAuthor && definition.ownerPubkey !== normalizedAuthor) continue

    addRole(preferences, definition.pointer, "admin", {
      relayHints: definition.relays,
      lastInteractedAt: definition.event.created_at,
    })
  }

  for (const event of moderatorFormEvents) {
    if (normalizedAuthor && event.pubkey !== normalizedAuthor) continue

    const form = parseAdmissionForm(event)
    if (!form) continue

    const definition = definitions.get(form.community.address)
    const hasCapability = definition
      ? getModeratorEvidence({
          definition,
          moderatorProfileListEvents: moderatorProfileListEventMap,
          author: normalizedAuthor,
        }) > 0
      : true

    if (!hasCapability) continue

    addRole(preferences, form.community, "moderator", {
      relayHints: normalizeRelays([...(form.relays || []), ...(definition?.relays || [])]),
      lastInteractedAt: form.event.created_at,
    })
  }

  for (const [address, definition] of definitions) {
    if (definition.ownerPubkey === normalizedAuthor) continue

    const latestAt = getModeratorEvidence({
      definition,
      moderatorProfileListEvents: moderatorProfileListEventMap,
      author: normalizedAuthor,
    })

    if (!latestAt) continue

    addRole(preferences, definition.pointer, "moderator", {
      relayHints: definition.relays,
      lastInteractedAt: latestAt,
    })
  }

  for (const ref of memberCommunityRefs) {
    const hasMemberRole = ref.roles?.includes("member")
    const hasHigherRole = ref.roles?.some(role => role === "admin" || role === "moderator")
    const pointer = ref.definition?.pointer
    const current = pointer ? preferences.get(pointer.address) : undefined

    if (!pointer || !hasMemberRole || hasHigherRole || current?.isAdmin || current?.isModerator)
      continue

    addRole(preferences, pointer, "member", {
      relayHints: normalizeRelays([...(ref.relayHints || []), ...(ref.definition?.relays || [])]),
      lastInteractedAt: ref.definition?.event.created_at,
    })
  }

  return Array.from(preferences.values())
    .filter(preference => {
      if (preference.isAdmin) return true
      if (preference.star && excludedCommunities.has(preference.star.community.address))
        return false
      if (excludedCommunities.has(preference.communityAddress)) {
        return false
      }
      return !definitions.has(preference.communityAddress)
        ? true
        : !excludedCommunities.has(preference.communityAddress)
    })
    .map(({scoreParts, ...preference}) => preference)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.lastInteractedAt !== a.lastInteractedAt) return b.lastInteractedAt - a.lastInteractedAt

      return (
        a.communityPubkey.localeCompare(b.communityPubkey) ||
        a.communityAddress.localeCompare(b.communityAddress)
      )
    })
}
