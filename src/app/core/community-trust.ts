import type {TrustedEvent} from "@welshman/util"
import {normalizePubkey, type CommunityDefinition} from "@app/core/community"
import {
  prepareUserCommunityRefSelection,
  type ActiveUserCommunityRef,
  type ActiveUserCommunityRole,
  type UserCommunityReportStates,
} from "@app/core/community-membership"
import {
  COMMUNITY_MEMBER_FLOOR,
  REPORT_WEIGHT,
  clampOverlayScore,
  makeTrustAssessment,
  suppressTrustAssessment,
  type TrustAssessment,
  type TrustCategory,
  type TrustContext,
  type TrustEvidence,
} from "@app/core/trust-assessment"
import type {EffectiveCommunityReportState} from "@app/core/community-reports"

export const COMMUNITY_ADMIN_WEIGHT = 12
export const COMMUNITY_MODERATOR_WEIGHT = 8
export const SHARED_SECTION_WEIGHT = 1
export const MAX_SHARED_COMMUNITY_BONUS = 2
export const MAX_SHARED_SECTION_BONUS = 2

type CommunityTrustContext = TrustContext & {communityAddress?: string}

export type CommunityTrustInput = {
  viewerPubkey?: string
  targetPubkey?: string
  context?: CommunityTrustContext
  definitions?: CommunityDefinition[]
  definitionEvents?: TrustedEvent[]
  profileListEvents?: TrustedEvent[]
  reportStates?: UserCommunityReportStates
  renouncedCommunityAddresses?: string[]
}

export type CommunityTrustBatchInput = Omit<CommunityTrustInput, "targetPubkey"> & {
  candidatePubkeys: string[]
}

export type CommunityTrustRefsInput = Omit<CommunityTrustInput, "viewerPubkey" | "targetPubkey"> & {
  pubkeys: string[]
}

const roleWeights: Record<ActiveUserCommunityRole, number> = {
  admin: COMMUNITY_ADMIN_WEIGHT,
  moderator: COMMUNITY_MODERATOR_WEIGHT,
  member: COMMUNITY_MEMBER_FLOOR,
}

const roleCategories: Record<ActiveUserCommunityRole, TrustCategory> = {
  admin: "community_admin",
  moderator: "community_moderator",
  member: "community_member",
}

const roleEvidence: Record<ActiveUserCommunityRole, Pick<TrustEvidence, "type" | "label">> = {
  admin: {type: "community_admin", label: "Admin"},
  moderator: {type: "community_moderator", label: "Moderator"},
  member: {type: "community_member", label: "Community member"},
}

const roleOrder: ActiveUserCommunityRole[] = ["admin", "moderator", "member"]

const getDefinitionAddress = (definition: CommunityDefinition) => definition.pointer.address

const filterRefsByCommunity = (
  refs: ActiveUserCommunityRef[],
  excludedCommunityAddresses: Set<string>,
) => refs.filter(ref => !excludedCommunityAddresses.has(getDefinitionAddress(ref.definition)))

const getPrimaryRole = (ref: ActiveUserCommunityRef): ActiveUserCommunityRole | undefined =>
  roleOrder.find(role => ref.roles.includes(role))

const getRoleEvidence = (
  ref: ActiveUserCommunityRef,
  role: ActiveUserCommunityRole,
): TrustEvidence => ({
  ...roleEvidence[role],
  communityPubkey: ref.community.ownerPubkey,
})

const getSharedSectionNames = (
  viewerRef: ActiveUserCommunityRef,
  targetRef: ActiveUserCommunityRef,
) =>
  targetRef.writableSections.filter(sectionName => viewerRef.writableSections.includes(sectionName))

const isCommunityScopedContext = (context?: CommunityTrustContext) =>
  context?.scope === "active_community" ||
  context?.scope === "community" ||
  context?.scope === "repo"

const getContextCommunityAddress = (context?: CommunityTrustContext) =>
  isCommunityScopedContext(context) ? context?.communityAddress?.trim() || "" : ""

const getContextCommunityPubkey = (context?: CommunityTrustContext) =>
  normalizePubkey(getContextCommunityAddress(context).split(":")[1] || "")

const isContextCommunityRenounced = ({
  context,
  renouncedCommunityAddresses,
}: {
  context?: CommunityTrustContext
  renouncedCommunityAddresses: string[]
}) => {
  const communityAddress = getContextCommunityAddress(context)
  const addresses = new Set(renouncedCommunityAddresses)
  return Boolean(communityAddress && addresses.has(communityAddress))
}

const getReportState = (states: UserCommunityReportStates | undefined, communityAddress: string) =>
  states instanceof Map ? states.get(communityAddress) : states?.[communityAddress]

const countTargetReports = (reports: {targetPubkey: string}[], targetPubkey: string) =>
  reports.filter(report => report.targetPubkey === targetPubkey).length

const applyCommunityModerationEvidence = ({
  assessment,
  targetPubkey,
  communityPubkey,
  reportState,
}: {
  assessment: TrustAssessment
  targetPubkey: string
  communityPubkey: string
  reportState?: EffectiveCommunityReportState
}): TrustAssessment => {
  if (!communityPubkey || !targetPubkey || !reportState) return assessment

  const banCount = countTargetReports(reportState.personReports, targetPubkey)
  if (banCount > 0) {
    return suppressTrustAssessment(assessment, "community_ban", [
      {
        type: "community_ban",
        communityPubkey,
        count: banCount,
        label: "Banned here",
      },
    ])
  }

  const reportCount = countTargetReports(reportState.eventReports, targetPubkey)
  if (reportCount === 0) return assessment

  const evidence: TrustEvidence[] = [
    ...assessment.evidence,
    {
      type: "community_report",
      communityPubkey,
      count: reportCount,
      label: reportCount === 1 ? "Reported here" : `${reportCount} reports here`,
    },
  ]

  return makeTrustAssessment({
    ...assessment,
    score: assessment.score + clampOverlayScore(reportCount * REPORT_WEIGHT),
    evidence,
  })
}

export const collectCommunityTrustRefs = ({
  pubkeys,
  definitions = [],
  definitionEvents = [],
  profileListEvents = [],
  renouncedCommunityAddresses = [],
}: CommunityTrustRefsInput) => {
  const refsByPubkey = new Map<string, ActiveUserCommunityRef[]>()
  const selectRefs = prepareUserCommunityRefSelection({
    definitions,
    definitionEvents,
    profileListEvents,
    excludedCommunityAddresses: renouncedCommunityAddresses,
  })

  for (const rawPubkey of pubkeys) {
    const normalizedPubkey = normalizePubkey(rawPubkey)
    if (!normalizedPubkey || refsByPubkey.has(normalizedPubkey)) continue

    refsByPubkey.set(normalizedPubkey, selectRefs(normalizedPubkey))
  }

  return refsByPubkey
}

export const assessCommunityTrustFromRefs = ({
  viewerPubkey,
  targetPubkey,
  context,
  viewerRefs = [],
  targetRefs = [],
  reportStates,
  renouncedCommunityAddresses = [],
}: {
  viewerPubkey?: string
  targetPubkey?: string
  context?: CommunityTrustContext
  viewerRefs?: ActiveUserCommunityRef[]
  targetRefs?: ActiveUserCommunityRef[]
  reportStates?: UserCommunityReportStates
  renouncedCommunityAddresses?: string[]
}): TrustAssessment => {
  const normalizedViewer = normalizePubkey(viewerPubkey || "")
  const normalizedTarget = normalizePubkey(targetPubkey || "")
  const excludedCommunities = new Set(renouncedCommunityAddresses)

  if (!normalizedTarget) return makeTrustAssessment()

  if (normalizedViewer && normalizedTarget === normalizedViewer) {
    return makeTrustAssessment({
      category: "self",
      score: COMMUNITY_ADMIN_WEIGHT + 1,
      evidence: [{type: "self", label: "You"}],
    })
  }

  const contextCommunityAddress = getContextCommunityAddress(context)
  if (isCommunityScopedContext(context) && !contextCommunityAddress) return makeTrustAssessment()

  const contextCommunityPubkey = getContextCommunityPubkey(context)
  const contextIsRenounced = [...viewerRefs, ...targetRefs].some(
    ref =>
      getDefinitionAddress(ref.definition) === contextCommunityAddress &&
      excludedCommunities.has(getDefinitionAddress(ref.definition)),
  )
  if (contextIsRenounced) return makeTrustAssessment()

  const filteredViewerRefs = filterRefsByCommunity(viewerRefs, excludedCommunities)
  const filteredTargetRefs = filterRefsByCommunity(targetRefs, excludedCommunities)
  const viewerRefsByCommunity = new Map(
    filteredViewerRefs.map(ref => [getDefinitionAddress(ref.definition), ref]),
  )
  const sharedRefs = filteredTargetRefs.filter(targetRef => {
    const communityAddress = getDefinitionAddress(targetRef.definition)
    const viewerRef = viewerRefsByCommunity.get(communityAddress)
    if (!viewerRef) return false
    return !contextCommunityAddress || communityAddress === contextCommunityAddress
  })
  const relevantTargetRefs = contextCommunityAddress
    ? filteredTargetRefs.filter(
        ref => getDefinitionAddress(ref.definition) === contextCommunityAddress,
      )
    : normalizedViewer
      ? sharedRefs
      : filteredTargetRefs

  let bestRole: ActiveUserCommunityRole | undefined
  let bestRoleRef: ActiveUserCommunityRef | undefined
  let roleScore = 0

  for (const ref of relevantTargetRefs) {
    const role = getPrimaryRole(ref)
    if (!role) continue

    const score = roleWeights[role]
    if (score > roleScore) {
      bestRole = role
      bestRoleRef = ref
      roleScore = score
    }
  }

  const evidence: TrustEvidence[] = []
  let score = roleScore

  if (bestRole && bestRoleRef) {
    evidence.push(getRoleEvidence(bestRoleRef, bestRole))
  }

  if (sharedRefs.length > 0) {
    const sharedCommunityCount = sharedRefs.length

    evidence.push({
      type: "shared_communities",
      count: sharedCommunityCount,
      label:
        sharedCommunityCount === 1
          ? "Shared community"
          : `${sharedCommunityCount} shared communities`,
    })
    score += Math.min(Math.max(sharedCommunityCount - 1, 0), MAX_SHARED_COMMUNITY_BONUS)
  }

  const sharedSectionNames = Array.from(
    new Set(
      sharedRefs.flatMap(targetRef => {
        const viewerRef = viewerRefsByCommunity.get(getDefinitionAddress(targetRef.definition))
        return viewerRef ? getSharedSectionNames(viewerRef, targetRef) : []
      }),
    ),
  ).sort((a, b) => a.localeCompare(b))

  if (sharedSectionNames.length > 0) {
    evidence.push({
      type: "shared_section",
      sectionName: sharedSectionNames.length === 1 ? sharedSectionNames[0] : undefined,
      count: sharedSectionNames.length,
      label:
        sharedSectionNames.length === 1
          ? `Shared ${sharedSectionNames[0]} section`
          : `${sharedSectionNames.length} shared sections`,
    })
    score += Math.min(sharedSectionNames.length, MAX_SHARED_SECTION_BONUS) * SHARED_SECTION_WEIGHT
  }

  const assessment = makeTrustAssessment({
    category: bestRole ? roleCategories[bestRole] : score > 0 ? "community_member" : "unknown",
    score,
    evidence,
  })

  return applyCommunityModerationEvidence({
    assessment,
    targetPubkey: normalizedTarget,
    communityPubkey: contextCommunityPubkey,
    reportState: getReportState(reportStates, contextCommunityAddress),
  })
}

export const buildCommunityTrustAssessment = ({
  viewerPubkey,
  targetPubkey,
  context,
  definitions = [],
  definitionEvents = [],
  profileListEvents = [],
  reportStates,
  renouncedCommunityAddresses = [],
}: CommunityTrustInput): TrustAssessment => {
  if (
    isContextCommunityRenounced({
      context,
      renouncedCommunityAddresses,
    })
  ) {
    return makeTrustAssessment()
  }

  const refsByPubkey = collectCommunityTrustRefs({
    pubkeys: [viewerPubkey || "", targetPubkey || ""],
    definitions,
    definitionEvents,
    profileListEvents,
    renouncedCommunityAddresses,
  })

  return assessCommunityTrustFromRefs({
    viewerPubkey,
    targetPubkey,
    context,
    viewerRefs: refsByPubkey.get(normalizePubkey(viewerPubkey || "")) || [],
    targetRefs: refsByPubkey.get(normalizePubkey(targetPubkey || "")) || [],
    reportStates,
    renouncedCommunityAddresses,
  })
}

export const buildCommunityTrustAssessments = ({
  candidatePubkeys,
  viewerPubkey,
  context,
  definitions = [],
  definitionEvents = [],
  profileListEvents = [],
  reportStates,
  renouncedCommunityAddresses = [],
}: CommunityTrustBatchInput) => {
  if (
    isContextCommunityRenounced({
      context,
      renouncedCommunityAddresses,
    })
  ) {
    return new Map(
      candidatePubkeys
        .map(normalizePubkey)
        .filter(Boolean)
        .map(candidatePubkey => [candidatePubkey, makeTrustAssessment()]),
    )
  }

  const refsByPubkey = collectCommunityTrustRefs({
    pubkeys: [viewerPubkey || "", ...candidatePubkeys],
    definitions,
    definitionEvents,
    profileListEvents,
    renouncedCommunityAddresses,
  })
  const viewerRefs = refsByPubkey.get(normalizePubkey(viewerPubkey || "")) || []
  const assessments = new Map<string, TrustAssessment>()

  for (const rawPubkey of candidatePubkeys) {
    const candidatePubkey = normalizePubkey(rawPubkey)
    if (!candidatePubkey) continue

    assessments.set(
      candidatePubkey,
      assessCommunityTrustFromRefs({
        viewerPubkey,
        targetPubkey: candidatePubkey,
        context,
        viewerRefs,
        targetRefs: refsByPubkey.get(candidatePubkey) || [],
        reportStates,
        renouncedCommunityAddresses,
      }),
    )
  }

  return assessments
}
