import {Address, getTagValue, type TrustedEvent} from "@welshman/util"
import {GIT_REPO_ANNOUNCEMENT} from "@nostr-git/core/events"
import {
  normalizePubkey,
  parseCommunityId,
  parseCommunityDefinitionAddress,
  parseTargetedPublication,
  type CommunityDefinition,
  type CommunityPointer,
} from "@app/core/community"
import {
  COMMUNITY_WRITE_TARGETS,
  canWriteCommunityTarget,
  getCommunityTargetAuthorityPubkeys,
} from "@app/core/community-permissions"
import {
  isCommunityPersonBanned,
  type EffectiveCommunityReportState,
} from "@app/core/community-reports"
import {
  makeRepoCommunityContext,
  type RepoAssociationValidation,
  type RepoCommunityContext,
  type TrustEvidence,
} from "@app/core/trust-assessment"
import type {UserCommunityReportStates} from "@app/core/community-membership"

type RepoAssociationSource = {
  event?: TrustedEvent
  community: CommunityPointer
  associationAuthorPubkey: string
  associationEventId?: string
  createdAt: number
}

export type BuildRepoCommunityContextsInput = {
  repoEvent?: TrustedEvent
  repoAddress?: string
  repoOwnerPubkey?: string
  associationEvents?: TrustedEvent[]
  definitions?: CommunityDefinition[]
  profileListEvents?: TrustedEvent[]
  reportStates?: UserCommunityReportStates
  activeCommunityPubkey?: string
  activeCommunityAddress?: string
}

const validationRank: Record<RepoAssociationValidation, number> = {
  strong: 4,
  valid: 3,
  weak: 2,
  unknown: 1,
  invalid: 0,
}

const getReportState = (states: UserCommunityReportStates | undefined, communityAddress: string) =>
  states instanceof Map ? states.get(communityAddress) : states?.[communityAddress]

export const getRepoAddress = (event: TrustedEvent | undefined) => {
  if (!event) return ""

  try {
    return Address.fromEvent(event).toString()
  } catch {
    const identifier = getTagValue("d", event.tags || [])
    const pubkey = normalizePubkey(event.pubkey || "")

    return identifier && pubkey && event.kind ? `${event.kind}:${pubkey}:${identifier}` : ""
  }
}

export const isAuthorizedDirectCommunityRepo = ({
  event,
  communityId,
  authorPubkeys,
}: {
  event: TrustedEvent
  communityId: string
  authorPubkeys: string[]
}) =>
  event.kind === GIT_REPO_ANNOUNCEMENT &&
  event.tags.filter(tag => tag[0] === "h").length === 1 &&
  parseCommunityId(event.tags.find(tag => tag[0] === "h")?.[1] || "") ===
    parseCommunityId(communityId) &&
  authorPubkeys.includes(normalizePubkey(event.pubkey))

const getRepoOwnerPubkey = ({
  repoEvent,
  repoAddress,
  repoOwnerPubkey,
}: Pick<BuildRepoCommunityContextsInput, "repoEvent" | "repoAddress" | "repoOwnerPubkey">) =>
  normalizePubkey(repoOwnerPubkey || repoEvent?.pubkey || repoAddress?.split(":")[1] || "")

const associationTargetsRepo = ({
  event,
  repoEvent,
  repoAddress,
}: {
  event: TrustedEvent
  repoEvent?: TrustedEvent
  repoAddress: string
}) => {
  const targeting = parseTargetedPublication(event)
  if (!targeting || targeting.kind !== GIT_REPO_ANNOUNCEMENT) return undefined

  if (targeting.source?.type === "a" && targeting.source.value === repoAddress) return targeting
  if (targeting.source?.type === "e" && repoEvent?.id && targeting.source.value === repoEvent.id) {
    return targeting
  }

  if (
    !targeting.source &&
    repoEvent &&
    normalizePubkey(repoEvent.pubkey) === normalizePubkey(event.pubkey) &&
    getTagValue("h", repoEvent.tags || []) === targeting.id
  ) {
    return targeting
  }

  return undefined
}

const collectAssociationSources = ({
  repoEvent,
  repoAddress,
  associationEvents = [],
}: Pick<BuildRepoCommunityContextsInput, "repoEvent" | "associationEvents"> & {
  repoAddress: string
}) => {
  const sources: RepoAssociationSource[] = []
  for (const event of associationEvents) {
    const targeting = associationTargetsRepo({event, repoEvent, repoAddress})
    if (!targeting) continue

    for (const community of targeting.communities) {
      sources.push({
        event,
        community,
        associationAuthorPubkey: normalizePubkey(event.pubkey || ""),
        associationEventId: event.id,
        createdAt: event.created_at || 0,
      })
    }
  }

  return sources
}

const getDefinitionByAddress = (definitions: CommunityDefinition[], communityAddress: string) =>
  definitions.find(definition => definition.pointer.address === communityAddress)

const makeBaseEvidence = ({
  repoAddress,
  communityPubkey,
  validation,
}: {
  repoAddress: string
  communityPubkey: string
  validation: RepoAssociationValidation
}): TrustEvidence[] => [
  {
    type: "community_associated",
    communityPubkey,
    repoAddress,
    label: "Community repo",
  },
  ...(validation === "strong"
    ? [
        {
          type: "association_authority" as const,
          communityPubkey,
          repoAddress,
          label: "Associated by repo authority",
        },
      ]
    : validation === "valid"
      ? [
          {
            type: "association_authority" as const,
            communityPubkey,
            repoAddress,
            label: "Associated by repo grant",
          },
        ]
      : []),
]

const validateAssociation = ({
  definition,
  profileListEvents,
  reportState,
  associationAuthorPubkey,
  repoOwnerPubkey,
}: {
  definition?: CommunityDefinition
  profileListEvents: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
  associationAuthorPubkey: string
  repoOwnerPubkey: string
}): RepoAssociationValidation => {
  if (
    isCommunityPersonBanned(reportState, associationAuthorPubkey) ||
    isCommunityPersonBanned(reportState, repoOwnerPubkey)
  ) {
    return "invalid"
  }

  if (!definition) return "unknown"

  const authorityPubkeys = getCommunityTargetAuthorityPubkeys({
    definition,
    profileListEvents,
    target: COMMUNITY_WRITE_TARGETS.repository,
    reportState,
  })

  if (authorityPubkeys.includes(associationAuthorPubkey)) return "strong"

  if (
    canWriteCommunityTarget({
      definition,
      profileListEvents,
      userPubkey: associationAuthorPubkey,
      target: COMMUNITY_WRITE_TARGETS.repository,
      reportState,
    })
  ) {
    return "valid"
  }

  return "weak"
}

const buildContextFromSource = ({
  source,
  repoAddress,
  repoOwnerPubkey,
  definitions,
  profileListEvents,
  reportStates,
}: {
  source: RepoAssociationSource
  repoAddress: string
  repoOwnerPubkey: string
  definitions: CommunityDefinition[]
  profileListEvents: TrustedEvent[]
  reportStates?: UserCommunityReportStates
}): RepoCommunityContext | undefined => {
  const communityPubkey = normalizePubkey(source.community.ownerPubkey)
  const associationAuthorPubkey = normalizePubkey(source.associationAuthorPubkey)
  if (!communityPubkey || !associationAuthorPubkey) return undefined

  const definition = getDefinitionByAddress(definitions, source.community.address)
  if (!definition || !parseCommunityDefinitionAddress(source.community.address)) return undefined
  const reportState = getReportState(reportStates, source.community.address)
  const validation = validateAssociation({
    definition,
    profileListEvents,
    reportState,
    associationAuthorPubkey,
    repoOwnerPubkey,
  })
  const suppressed = validation === "invalid"
  const evidence = suppressed
    ? [
        ...makeBaseEvidence({repoAddress, communityPubkey, validation}),
        {
          type: "community_ban" as const,
          communityPubkey,
          repoAddress,
          label: "Banned here",
        },
      ]
    : makeBaseEvidence({repoAddress, communityPubkey, validation})

  return {
    ...makeRepoCommunityContext({
      repoAddress,
      communityPubkey,
      communityAddress: source.community.address,
      communityId: source.community.communityId,
      associationEventId: source.associationEventId,
      associationAuthorPubkey,
      relayHints: [...source.community.relayHints, ...definition.relays],
      validation,
      evidence,
      suppressed,
      suppressionReason: suppressed ? "community_ban" : undefined,
    }),
    createdAt: source.createdAt,
  } as RepoCommunityContext & {createdAt: number}
}

const sortContexts =
  (activeCommunityAddress: string, activeCommunityPubkey = "") =>
  (
    a: RepoCommunityContext & {createdAt?: number},
    b: RepoCommunityContext & {createdAt?: number},
  ) => {
    const aActive = activeCommunityAddress
      ? a.communityAddress === activeCommunityAddress
        ? 1
        : 0
      : a.communityPubkey === activeCommunityPubkey
        ? 1
        : 0
    const bActive = activeCommunityAddress
      ? b.communityAddress === activeCommunityAddress
        ? 1
        : 0
      : b.communityPubkey === activeCommunityPubkey
        ? 1
        : 0
    if (aActive !== bActive) return bActive - aActive
    if (validationRank[a.validation] !== validationRank[b.validation]) {
      return validationRank[b.validation] - validationRank[a.validation]
    }
    if ((a.createdAt || 0) !== (b.createdAt || 0)) return (b.createdAt || 0) - (a.createdAt || 0)

    return (a.communityPubkey || "").localeCompare(b.communityPubkey || "")
  }

export const buildRepoCommunityContexts = ({
  repoEvent,
  repoAddress: explicitRepoAddress,
  repoOwnerPubkey: explicitRepoOwnerPubkey,
  associationEvents = [],
  definitions = [],
  profileListEvents = [],
  reportStates,
  activeCommunityPubkey = "",
  activeCommunityAddress = "",
}: BuildRepoCommunityContextsInput): RepoCommunityContext[] => {
  const repoAddress = explicitRepoAddress || getRepoAddress(repoEvent)
  const repoOwnerPubkey = getRepoOwnerPubkey({
    repoEvent,
    repoAddress,
    repoOwnerPubkey: explicitRepoOwnerPubkey,
  })
  if (!repoAddress || !repoOwnerPubkey) return []

  const bestByCommunity = new Map<string, RepoCommunityContext & {createdAt?: number}>()
  const sources = collectAssociationSources({repoEvent, repoAddress, associationEvents})

  for (const source of sources) {
    const context = buildContextFromSource({
      source,
      repoAddress,
      repoOwnerPubkey,
      definitions,
      profileListEvents,
      reportStates,
    })
    if (!context?.communityAddress) continue

    const current = bestByCommunity.get(context.communityAddress)
    if (!current || sortContexts("", "")(context, current) < 0) {
      bestByCommunity.set(context.communityAddress, context)
    }
  }

  return Array.from(bestByCommunity.values()).sort(
    sortContexts(activeCommunityAddress, normalizePubkey(activeCommunityPubkey)),
  )
}

export const getPrimaryRepoCommunityContext = (input: BuildRepoCommunityContextsInput) =>
  buildRepoCommunityContexts(input)[0]

export const isEndorsedRepoCommunityContext = (context: RepoCommunityContext | undefined) =>
  Boolean(context && !context.suppressed && ["strong", "valid"].includes(context.validation))
