import {type EventContent, type TrustedEvent} from "@welshman/util"
import {
  PROFILE_LIST_KIND,
  PROFILE_LIST_STATUS_DECLINED,
  getProfileListStatus,
  getProfileListPubkeys,
  getCommunitySectionPurpose,
  isProfileListDeclined,
  normalizePubkey,
  normalizeRelays,
  parseAddressRef,
  selectCurrentAddressableEvent,
} from "@app/core/community"
import {
  COMMUNITY_DEFINITION_KIND,
  makeCommunityProfileListIdentifier,
  normalizeCommunityRelay,
  updateCommunityDefinition,
  type CommunityDefinition,
  type CommunityDefinitionProfileListRef,
  type CommunityDefinitionSectionInput,
} from "@app/core/community-protocol"

export type CommunityBootstrapGrantRole = "member" | "moderator"

export type CommunityBootstrapGrantDraft = {
  pubkey: string
  role: CommunityBootstrapGrantRole
  sectionNames: string[]
}

export type CommunityProfileListDraftUpdate = {
  profileList: CommunityDefinitionProfileListRef
  pubkeys: string[]
}

export type CommunityModeratorInviteStatus = "pending" | "accepted" | "declined"

export type CommunityModeratorInviteState = {
  moderatorPubkey: string
  sectionName: string
  displayName: string
  profileList: CommunityDefinitionProfileListRef
  status: CommunityModeratorInviteStatus
  response?: TrustedEvent
}

export type PendingCommunityModeratorInvite = CommunityModeratorInviteState & {status: "pending"}

export const findCommunityProfileListEvent = (
  profileListRef: CommunityDefinitionProfileListRef | undefined,
  events: TrustedEvent[],
) => {
  if (!profileListRef) return undefined
  const address = parseAddressRef(profileListRef.address)
  if (!address) return undefined

  return selectCurrentAddressableEvent(
    events,
    profileListRef.address,
    event => event.kind === address.kind,
    event => {
      const addresses = event.tags.filter(tag => tag[0] === "a")
      return (
        addresses.length === 1 &&
        addresses[0].length === 2 &&
        addresses[0][1] === profileListRef.address
      )
    },
  )
}

export const isActiveCommunityProfileListEvent = (event: TrustedEvent | undefined) =>
  Boolean(event && !isProfileListDeclined(event))

export const isActiveCommunityProfileListRef = (
  ref: CommunityDefinitionProfileListRef | undefined,
  profileListEvents: TrustedEvent[] | undefined,
) => {
  if (!ref || !profileListEvents) return false

  return isActiveCommunityProfileListEvent(findCommunityProfileListEvent(ref, profileListEvents))
}

export const makeManualModeratorProfileListRef = ({
  communityId,
  moderatorPubkey,
  sectionName,
  relays = [],
}: {
  communityId: string
  moderatorPubkey: string
  sectionName: string
  relays?: string[]
}): CommunityDefinitionProfileListRef => {
  const pubkey = normalizePubkey(moderatorPubkey)
  const purpose = getCommunitySectionPurpose(communityId, {name: sectionName, profileLists: []})
  const identifier = purpose ? makeCommunityProfileListIdentifier(communityId, purpose) : undefined
  const relay = normalizeRelays(relays)[0]
  if (!pubkey || !identifier) throw new Error("Invalid moderator profile-list reference.")

  return {
    address: `${PROFILE_LIST_KIND}:${pubkey}:${identifier}`,
    ...(relay ? {relay} : {}),
  }
}

export const makeModeratorInviteResponseProfileList = ({
  profileList,
  declined = false,
}: {
  profileList: CommunityDefinitionProfileListRef
  declined?: boolean
}): EventContent & {kind: typeof PROFILE_LIST_KIND} => ({
  kind: PROFILE_LIST_KIND,
  content: "",
  tags: [
    ["d", parseAddressRef(profileList.address)?.identifier || ""],
    ...(declined ? [["status", PROFILE_LIST_STATUS_DECLINED]] : []),
  ],
})

export const isDeclinedModeratorInviteProfileList = (event: TrustedEvent | undefined) =>
  getProfileListStatus(event) === PROFILE_LIST_STATUS_DECLINED

export const getCommunityModeratorInviteProfileListRefs = ({
  definition,
  moderatorPubkey,
}: {
  definition: CommunityDefinition | undefined
  moderatorPubkey: string | undefined
}) => {
  const pubkey = normalizePubkey(moderatorPubkey || "")
  if (!definition || !pubkey || pubkey === definition.ownerPubkey) return []

  return definition.sections.flatMap(section =>
    section.profileLists.filter(
      profileList => parseAddressRef(profileList.address)?.pubkey === pubkey,
    ),
  )
}

export const getCommunityModeratorInviteStates = ({
  definition,
  moderatorPubkey,
  profileListEvents = [],
}: {
  definition: CommunityDefinition | undefined
  moderatorPubkey?: string
  profileListEvents?: TrustedEvent[]
}): CommunityModeratorInviteState[] => {
  if (!definition) return []

  const ownerPubkey = definition.ownerPubkey
  const requestedModeratorPubkey = normalizePubkey(moderatorPubkey || "")

  return definition.sections.flatMap(section => {
    const displayName = section.name

    return section.profileLists.flatMap(profileList => {
      const inviteePubkey = parseAddressRef(profileList.address)?.pubkey || ""
      if (!inviteePubkey || inviteePubkey === ownerPubkey) return []
      if (requestedModeratorPubkey && inviteePubkey !== requestedModeratorPubkey) return []

      const response = findCommunityProfileListEvent(profileList, profileListEvents)
      const status: CommunityModeratorInviteStatus = response
        ? isDeclinedModeratorInviteProfileList(response)
          ? "declined"
          : "accepted"
        : "pending"

      return [
        {
          moderatorPubkey: inviteePubkey,
          sectionName: section.name,
          displayName,
          profileList,
          status,
          response,
        },
      ]
    })
  })
}

export const getOwnerMembershipGrantProfileList = ({
  definition,
  sectionName,
  relays = [],
}: {
  definition: CommunityDefinition
  sectionName: string
  relays?: string[]
}): {
  profileList?: CommunityDefinitionProfileListRef
  definitionUpdate?: EventContent & {kind: typeof COMMUNITY_DEFINITION_KIND}
} => {
  const section = definition.sections.find(item => item.name === sectionName)
  const owner = normalizePubkey(definition.ownerPubkey)
  if (!section || !owner) return {}

  const toProfileListRef = (
    address: string,
    relay?: string,
  ): CommunityDefinitionProfileListRef | undefined => {
    const [kindValue, pubkey, ...identifierParts] = address.split(":")
    const identifier = identifierParts.join(":")
    if (
      kindValue !== String(PROFILE_LIST_KIND) ||
      normalizePubkey(pubkey) !== pubkey ||
      !identifier
    ) {
      return undefined
    }
    return {address, ...(relay ? {relay} : {})}
  }
  const existing = section.profileLists
    .map(ref => toProfileListRef(ref.address, ref.relay))
    .find(ref => parseAddressRef(ref?.address || "")?.pubkey === owner)
  if (existing) return {profileList: existing}

  const purpose = getCommunitySectionPurpose(definition.communityId, section)
  const identifier = purpose
    ? makeCommunityProfileListIdentifier(definition.communityId, purpose)
    : undefined
  if (!identifier) return {}
  const relay = relays.map(normalizeCommunityRelay).find(Boolean)
  const address = `${PROFILE_LIST_KIND}:${owner}:${identifier}`
  const profileList: CommunityDefinitionProfileListRef = {
    address,
    ...(relay ? {relay} : {}),
  }
  const base = updateCommunityDefinition(definition, {})
  const tags = base.tags.map(tag => [...tag])
  const sectionStart = tags.findIndex(tag => tag[0] === "content" && tag[1] === section.name)
  if (sectionStart < 0) return {}
  const nextSection = tags.findIndex((tag, index) => index > sectionStart && tag[0] === "content")
  const insertionIndex = nextSection < 0 ? tags.length : nextSection
  tags.splice(insertionIndex, 0, relay ? ["a", address, relay] : ["a", address])

  return {
    profileList,
    definitionUpdate: {...base, tags},
  }
}

export const getPendingCommunityModeratorInvites = ({
  definition,
  moderatorPubkey,
  profileListEvents = [],
}: {
  definition: CommunityDefinition | undefined
  moderatorPubkey: string | undefined
  profileListEvents?: TrustedEvent[]
}): PendingCommunityModeratorInvite[] => {
  return getCommunityModeratorInviteStates({
    definition,
    moderatorPubkey,
    profileListEvents,
  }).filter((invite): invite is PendingCommunityModeratorInvite => invite.status === "pending")
}

const uniquePubkeys = (pubkeys: string[]) =>
  Array.from(new Set(pubkeys.map(normalizePubkey).filter(Boolean)))

const addGrantBySection = (
  grantsBySection: Map<string, string[]>,
  sectionName: string,
  pubkey: string,
) => {
  grantsBySection.set(
    sectionName,
    uniquePubkeys([...(grantsBySection.get(sectionName) || []), pubkey]),
  )
}

export const applyCommunityBootstrapGrants = ({
  sections,
  communityId,
  ownerPubkey,
  profileListPubkey = ownerPubkey,
  relays = [],
  profileListEvents = [],
  grants = [],
}: {
  sections: CommunityDefinitionSectionInput[]
  communityId: string
  ownerPubkey: string
  profileListPubkey?: string
  relays?: string[]
  profileListEvents?: TrustedEvent[]
  grants?: CommunityBootstrapGrantDraft[]
}): {
  sections: CommunityDefinitionSectionInput[]
  profileListUpdates: CommunityProfileListDraftUpdate[]
} => {
  const normalizedOwnerPubkey = normalizePubkey(ownerPubkey)
  const normalizedProfileListPubkey = normalizePubkey(profileListPubkey)
  const normalizedRelays = normalizeRelays(relays)
  const memberGrantsBySection = new Map<string, string[]>()
  const moderatorGrantsBySection = new Map<string, string[]>()
  const profileListUpdates = new Map<string, CommunityProfileListDraftUpdate>()

  for (const grant of grants) {
    const pubkey = normalizePubkey(grant.pubkey)
    if (!pubkey) continue

    for (const sectionName of grant.sectionNames) {
      const trimmedSectionName = sectionName.trim()
      if (!trimmedSectionName) continue

      addGrantBySection(
        grant.role === "moderator" ? moderatorGrantsBySection : memberGrantsBySection,
        trimmedSectionName,
        pubkey,
      )
    }
  }

  const nextSections = sections.map(section => {
    let profileLists = [...section.profileLists]
    const memberPubkeys = memberGrantsBySection.get(section.name) || []
    const moderatorPubkeys = moderatorGrantsBySection.get(section.name) || []

    if (memberPubkeys.length > 0 && normalizedOwnerPubkey) {
      let profileList = profileLists.find(
        ref => parseAddressRef(ref.address)?.pubkey === normalizedProfileListPubkey,
      )

      if (!profileList) {
        const purpose = getCommunitySectionPurpose(communityId, section)
        const identifier = purpose
          ? makeCommunityProfileListIdentifier(communityId, purpose)
          : undefined
        if (!identifier) return section
        profileList = {
          address: `${PROFILE_LIST_KIND}:${normalizedProfileListPubkey}:${identifier}`,
          ...(normalizedRelays[0] ? {relay: normalizedRelays[0]} : {}),
        }
        profileLists = [...profileLists, profileList]
      }

      const profileListEvent = findCommunityProfileListEvent(profileList, profileListEvents)
      const existingPubkeys = getProfileListPubkeys(profileListEvent)
      const basePubkeys =
        existingPubkeys.length > 0 ? existingPubkeys : [normalizedProfileListPubkey]

      profileListUpdates.set(profileList.address, {
        profileList,
        pubkeys: uniquePubkeys([...basePubkeys, ...memberPubkeys]),
      })
    }

    for (const moderatorPubkey of moderatorPubkeys) {
      const profileList = makeManualModeratorProfileListRef({
        communityId,
        moderatorPubkey,
        sectionName: section.name,
        relays: normalizedRelays,
      })

      if (!profileLists.some(ref => ref.address === profileList.address)) {
        profileLists = [...profileLists, profileList]
      }
    }

    return {...section, profileLists}
  })

  return {sections: nextSections, profileListUpdates: Array.from(profileListUpdates.values())}
}

export const makeCommunityProfileList = ({
  profileList,
  pubkeys,
}: {
  profileList: CommunityDefinitionProfileListRef
  pubkeys: string[]
}): EventContent & {kind: typeof PROFILE_LIST_KIND} => {
  const ref = parseAddressRef(profileList.address)
  if (ref?.kind !== PROFILE_LIST_KIND) throw new Error("Invalid community profile list address.")

  return {
    kind: PROFILE_LIST_KIND,
    content: "",
    tags: [
      ["d", ref.identifier],
      ...Array.from(new Set(pubkeys.map(normalizePubkey).filter(Boolean))).map(pubkey => [
        "p",
        pubkey,
      ]),
    ],
  }
}

export const addPubkeyToCommunityProfileList = ({
  profileList,
  event,
  pubkey,
}: {
  profileList: CommunityDefinitionProfileListRef
  event?: TrustedEvent
  pubkey: string
}) => makeCommunityProfileList({profileList, pubkeys: [...getProfileListPubkeys(event), pubkey]})

export const removePubkeyFromCommunityProfileList = ({
  profileList,
  event,
  pubkey,
}: {
  profileList: CommunityDefinitionProfileListRef
  event?: TrustedEvent
  pubkey: string
}) => {
  const normalized = normalizePubkey(pubkey)

  return makeCommunityProfileList({
    profileList,
    pubkeys: getProfileListPubkeys(event).filter(existing => existing !== normalized),
  })
}

export const makeCommunityGrantEvent = ({
  profileList,
  profileListEvent,
  pubkey,
}: {
  profileList: CommunityDefinitionProfileListRef
  profileListEvent?: TrustedEvent
  pubkey: string
}) => addPubkeyToCommunityProfileList({profileList, event: profileListEvent, pubkey})

export const makeCommunityRevokeEvent = ({
  profileList,
  profileListEvent,
  pubkey,
}: {
  profileList: CommunityDefinitionProfileListRef
  profileListEvent?: TrustedEvent
  pubkey: string
}) => removePubkeyFromCommunityProfileList({profileList, event: profileListEvent, pubkey})
