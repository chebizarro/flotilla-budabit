import type {TrustedEvent} from "@welshman/util"
import {
  PROFILE_LIST_KIND,
  getProfileListPubkeys,
  isRenouncedCommunitiesListEvent,
  isProfileListDeclined,
  normalizePubkey,
  selectCurrentAddressableEvent,
  selectCurrentCommunityDefinitionsV2,
  type CommunityDefinitionV2,
  type CommunityPointer,
  type CommunityProfileListRefV2,
} from "@app/core/community"
import {
  isCommunityPersonBanned,
  type EffectiveCommunityReportState,
} from "@app/core/community-reports"

export type ActiveUserCommunityRole = "admin" | "moderator" | "member"

export type ActiveUserCommunityRef = {
  community: CommunityPointer
  definition: CommunityDefinitionV2
  relayHints: string[]
  roles: ActiveUserCommunityRole[]
  writableSections: string[]
}

export type UserCommunityReportStates =
  | Map<string, EffectiveCommunityReportState | undefined>
  | Record<string, EffectiveCommunityReportState | undefined>

export type CommunityMemberSectionRef = {
  sectionName: string
  displayName: string
  profileListAddresses: string[]
}

export type CommunityMemberListItem = {
  pubkey: string
  isOwner: boolean
  isAdmin: boolean
  isModerator: boolean
  isPendingModerator: boolean
  isDeclinedModerator: boolean
  moderatorSections: CommunityMemberSectionRef[]
  pendingModeratorSections: CommunityMemberSectionRef[]
  declinedModeratorSections: CommunityMemberSectionRef[]
  sectionGrants: CommunityMemberSectionRef[]
  moderatorSectionCount: number
  pendingModeratorSectionCount: number
  declinedModeratorSectionCount: number
  grantCount: number
}

export type SelectUserCommunityRefsOptions = {
  author?: string
  definitions?: CommunityDefinitionV2[]
  definitionEvents?: TrustedEvent[]
  profileListEvents?: TrustedEvent[]
  reportStates?: UserCommunityReportStates
  excludedCommunityAddresses?: string[]
}

const roleOrder: ActiveUserCommunityRole[] = ["admin", "moderator", "member"]

const getDTag = (event: TrustedEvent) => event.tags.find(tag => tag[0] === "d")?.[1] || ""

const getAddress = (event: TrustedEvent) => {
  const identifier = getDTag(event)

  return identifier ? `${event.kind}:${event.pubkey}:${identifier}` : ""
}

const isPreferredEvent = (candidate: TrustedEvent, current: TrustedEvent | undefined) => {
  if (!current) return true
  if (candidate.created_at !== current.created_at) return candidate.created_at > current.created_at

  return candidate.id < current.id
}

const getLatestDefinitionsByAddress = (definitions: CommunityDefinitionV2[]) => {
  const latest = new Map<string, CommunityDefinitionV2>()

  for (const definition of definitions) {
    const address = definition.pointer.address
    const current = latest.get(address)
    if (isPreferredEvent(definition.event, current?.event)) latest.set(address, definition)
  }

  return Array.from(latest.values())
}

const getLatestProfileListEventsByAddress = (events: TrustedEvent[]) => {
  const latest = new Map<string, TrustedEvent>()
  const addresses = new Set<string>()

  for (const event of events) {
    if (event.kind !== PROFILE_LIST_KIND) continue
    if (isRenouncedCommunitiesListEvent(event)) continue

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
        const addresses = event.tags.filter(tag => tag[0] === "a")
        return addresses.length === 1 && addresses[0].length === 2 && addresses[0][1] === address
      },
    )
    if (current) latest.set(address, current)
  }

  return latest
}

const getReportState = (states: UserCommunityReportStates | undefined, communityAddress: string) =>
  states instanceof Map ? states.get(communityAddress) : states?.[communityAddress]

const getProfileListOwner = (ref: CommunityProfileListRefV2) =>
  normalizePubkey(ref.address.split(":")[1] || "")

const hasValidatedModeratorRef = (
  ref: CommunityProfileListRefV2,
  userPubkey: string,
  profileListsByAddress: Map<string, TrustedEvent>,
) => {
  if (getProfileListOwner(ref) !== userPubkey) return false

  const event = profileListsByAddress.get(ref.address)

  return Boolean(event && event.pubkey === userPubkey && !isProfileListDeclined(event))
}

const hasMemberRef = (
  ref: CommunityProfileListRefV2,
  userPubkey: string,
  profileListsByAddress: Map<string, TrustedEvent>,
) => getProfileListPubkeys(profileListsByAddress.get(ref.address)).includes(userPubkey)

const hasModeratorRef = (definition: CommunityDefinitionV2, userPubkey: string) => {
  const normalizedUser = normalizePubkey(userPubkey)
  const ownerPubkey = definition.controllerPubkey
  if (!normalizedUser || normalizedUser === ownerPubkey) return false

  return definition.sections.some(section =>
    section.profileLists.some(ref => getProfileListOwner(ref) === normalizedUser),
  )
}

const upsertSectionRef = (
  refs: CommunityMemberSectionRef[],
  sectionRef: CommunityMemberSectionRef,
) => {
  const existing = refs.find(ref => ref.sectionName === sectionRef.sectionName)

  if (!existing) {
    refs.push(sectionRef)
    return
  }

  existing.profileListAddresses = Array.from(
    new Set([...existing.profileListAddresses, ...sectionRef.profileListAddresses]),
  ).sort((a, b) => a.localeCompare(b))
}

export const selectCommunityMemberList = ({
  definition,
  profileListEvents = [],
  reportState,
}: {
  definition?: CommunityDefinitionV2
  profileListEvents?: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
}): CommunityMemberListItem[] => {
  if (!definition) return []

  const ownerPubkey = definition.controllerPubkey
  const profileListsByAddress = getLatestProfileListEventsByAddress(profileListEvents)
  const people = new Map<string, CommunityMemberListItem>()
  const moderatorRefAddressesByPubkey = new Map<string, string[]>()
  const allSectionRefs = definition.sections.map(section => ({
    sectionName: section.name,
    displayName: section.name,
  }))
  const getPerson = (pubkey: string) => {
    const normalized = normalizePubkey(pubkey)
    if (!normalized) return undefined
    if (normalized !== ownerPubkey && isCommunityPersonBanned(reportState, normalized))
      return undefined

    const existing = people.get(normalized)
    if (existing) return existing

    const person = {
      pubkey: normalized,
      isOwner: normalized === ownerPubkey,
      isAdmin: normalized === ownerPubkey,
      isModerator: false,
      isPendingModerator: false,
      isDeclinedModerator: false,
      moderatorSections: [],
      pendingModeratorSections: [],
      declinedModeratorSections: [],
      sectionGrants: [],
      moderatorSectionCount: 0,
      pendingModeratorSectionCount: 0,
      declinedModeratorSectionCount: 0,
      grantCount: 0,
    } satisfies CommunityMemberListItem

    people.set(normalized, person)

    return person
  }

  getPerson(ownerPubkey)

  for (const section of definition.sections) {
    const sectionRef = {
      sectionName: section.name,
      displayName: section.name,
    }

    for (const profileList of section.profileLists) {
      const event = profileListsByAddress.get(profileList.address)
      const moderatorPubkey = getProfileListOwner(profileList)
      const isModeratorRef = moderatorPubkey && moderatorPubkey !== ownerPubkey

      if (isModeratorRef) {
        moderatorRefAddressesByPubkey.set(
          moderatorPubkey,
          Array.from(
            new Set([
              ...(moderatorRefAddressesByPubkey.get(moderatorPubkey) || []),
              profileList.address,
            ]),
          ).sort((a, b) => a.localeCompare(b)),
        )

        if (event && !isProfileListDeclined(event)) {
          const moderator = getPerson(moderatorPubkey)
          if (!moderator) continue

          moderator.isModerator = true
          upsertSectionRef(moderator.moderatorSections, {
            ...sectionRef,
            profileListAddresses: [profileList.address],
          })
        } else if (!event) {
          const moderator = getPerson(moderatorPubkey)
          if (!moderator) continue

          moderator.isPendingModerator = true
          upsertSectionRef(moderator.pendingModeratorSections, {
            ...sectionRef,
            profileListAddresses: [profileList.address],
          })
        } else if (isProfileListDeclined(event)) {
          const moderator = getPerson(moderatorPubkey)
          if (!moderator) continue

          moderator.isDeclinedModerator = true
          upsertSectionRef(moderator.declinedModeratorSections, {
            ...sectionRef,
            profileListAddresses: [profileList.address],
          })
        }
      }

      for (const memberPubkey of getProfileListPubkeys(event)) {
        const member = getPerson(memberPubkey)
        if (!member) continue

        upsertSectionRef(member.sectionGrants, {
          ...sectionRef,
          profileListAddresses: [profileList.address],
        })
      }
    }
  }

  for (const [moderatorPubkey, profileListAddresses] of moderatorRefAddressesByPubkey) {
    const member = getPerson(moderatorPubkey)
    if (!member) continue

    for (const sectionRef of allSectionRefs) {
      upsertSectionRef(member.sectionGrants, {...sectionRef, profileListAddresses})
    }
  }

  return Array.from(people.values())
    .map(person => ({
      ...person,
      moderatorSections: person.moderatorSections.sort((a, b) =>
        a.displayName.localeCompare(b.displayName),
      ),
      pendingModeratorSections: person.pendingModeratorSections.sort((a, b) =>
        a.displayName.localeCompare(b.displayName),
      ),
      declinedModeratorSections: person.declinedModeratorSections.sort((a, b) =>
        a.displayName.localeCompare(b.displayName),
      ),
      sectionGrants: person.sectionGrants.sort((a, b) =>
        a.displayName.localeCompare(b.displayName),
      ),
    }))
    .map(person => ({
      ...person,
      moderatorSectionCount: person.moderatorSections.length,
      pendingModeratorSectionCount: person.pendingModeratorSections.length,
      declinedModeratorSectionCount: person.declinedModeratorSections.length,
      grantCount: person.sectionGrants.length,
    }))
    .sort((a, b) => {
      const aGroup = a.isOwner
        ? 0
        : a.isModerator
          ? 1
          : a.isPendingModerator
            ? 2
            : a.isDeclinedModerator
              ? 3
              : 4
      const bGroup = b.isOwner
        ? 0
        : b.isModerator
          ? 1
          : b.isPendingModerator
            ? 2
            : b.isDeclinedModerator
              ? 3
              : 4

      if (aGroup !== bGroup) return aGroup - bGroup
      if (aGroup === 0) return a.pubkey.localeCompare(b.pubkey)
      if (a.grantCount !== b.grantCount) return b.grantCount - a.grantCount
      if (a.moderatorSectionCount !== b.moderatorSectionCount) {
        return b.moderatorSectionCount - a.moderatorSectionCount
      }
      if (a.pendingModeratorSectionCount !== b.pendingModeratorSectionCount) {
        return b.pendingModeratorSectionCount - a.pendingModeratorSectionCount
      }
      if (a.declinedModeratorSectionCount !== b.declinedModeratorSectionCount) {
        return b.declinedModeratorSectionCount - a.declinedModeratorSectionCount
      }

      return a.pubkey.localeCompare(b.pubkey)
    })
}

export const selectUserCommunityRefs = ({
  author,
  definitions = [],
  definitionEvents = [],
  profileListEvents = [],
  reportStates,
  excludedCommunityAddresses = [],
}: SelectUserCommunityRefsOptions): ActiveUserCommunityRef[] => {
  const normalizedAuthor = normalizePubkey(author || "")
  if (!normalizedAuthor) return []

  const excludedCommunities = new Set(excludedCommunityAddresses)
  const parsedDefinitions = Array.from(
    selectCurrentCommunityDefinitionsV2(definitionEvents).values(),
  )
  const profileListsByAddress = getLatestProfileListEventsByAddress(profileListEvents)

  return getLatestDefinitionsByAddress([...definitions, ...parsedDefinitions])
    .flatMap(definition => {
      const isAdmin = definition.controllerPubkey === normalizedAuthor
      const reportState = getReportState(reportStates, definition.pointer.address)

      if (!isAdmin && excludedCommunities.has(definition.pointer.address)) return []
      if (!isAdmin && isCommunityPersonBanned(reportState, normalizedAuthor)) return []

      const roles = new Set<ActiveUserCommunityRole>()
      const writableSections = new Set<string>()

      if (isAdmin) {
        roles.add("admin")
        for (const section of definition.sections) writableSections.add(section.name)
      }

      if (!isAdmin && hasModeratorRef(definition, normalizedAuthor)) {
        roles.add("member")
        for (const section of definition.sections) writableSections.add(section.name)
      }

      for (const section of definition.sections) {
        const isModerator = section.profileLists.some(ref =>
          hasValidatedModeratorRef(ref, normalizedAuthor, profileListsByAddress),
        )
        const isMember = section.profileLists.some(ref =>
          hasMemberRef(ref, normalizedAuthor, profileListsByAddress),
        )

        if (isModerator) roles.add("moderator")
        if (isMember) roles.add("member")
        if (isModerator || isMember) writableSections.add(section.name)
      }

      if (roles.size === 0) return []

      return [
        {
          community: definition.pointer,
          definition,
          relayHints: definition.relays,
          roles: roleOrder.filter(role => roles.has(role)),
          writableSections: Array.from(writableSections).sort((a, b) => a.localeCompare(b)),
        } satisfies ActiveUserCommunityRef,
      ]
    })
    .sort((a, b) => a.community.address.localeCompare(b.community.address))
}

export const filterExcludedCommunityRefs = (
  refs: ActiveUserCommunityRef[],
  excludedCommunityAddresses: string[] = [],
) => {
  const excludedCommunities = new Set(excludedCommunityAddresses)

  return refs.filter(
    ref => ref.roles.includes("admin") || !excludedCommunities.has(ref.community.address),
  )
}
