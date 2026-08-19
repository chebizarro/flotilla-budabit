import {derived} from "svelte/store"
import {
  followLists,
  getFollows,
  getMutes,
  muteLists,
  profileSearch as welshmanProfileSearch,
  profilesByPubkey,
  pubkey,
} from "@welshman/app"
import type {TrustedEvent} from "@welshman/util"
import {
  activeExactCommunityDefinition,
  activeCommunityProfileListEvents,
  activeCommunityReportState,
  communityAdminDefinitionEvents,
  communityMemberDefinitionEvents,
  communityMemberProfileListEvents,
  communityMemberReportStates,
  communityModeratorDefinitionEvents,
  communityModeratorProfileListEvents,
} from "@app/core/community-state"
import {
  normalizePubkey,
  selectCurrentCommunityDefinitions,
  type CommunityDefinition,
} from "@app/core/community"
import {userRenouncedCommunityAddresses} from "@app/core/community-renunciations"
import {buildCommunityTrustAssessments} from "@app/core/community-trust"
import type {EffectiveCommunityReportState} from "@app/core/community-reports"
import {
  resolvePeopleDiscoveryContext,
  type PeopleDiscoveryContext,
} from "@app/core/people-discovery-context"
import {
  buildPeopleSearchCandidates,
  getCommunityPeoplePubkeys,
  getPeopleSearchTextScore,
  searchPeopleCandidates,
  type PeopleSearchBatch,
  type PeopleSearchResult,
} from "@app/util/people-search"

export type PeopleDiscoverySearchOptions = {
  context?: PeopleDiscoveryContext
  recentConversationPubkeys?: string[]
  knownPubkeys?: string[]
  additionalProfileMatches?: string[]
  excludePubkeys?: string[]
  cursor?: number
  scanLimit?: number
  resultLimit?: number
  allowEmptyQuery?: boolean
}

export type PeopleDiscoverySearch = {
  search: (query: string, options?: PeopleDiscoverySearchOptions) => PeopleSearchBatch
  searchResults: (query: string, options?: PeopleDiscoverySearchOptions) => PeopleSearchResult[]
  searchValues: (query: string, options?: PeopleDiscoverySearchOptions) => string[]
}

type PeopleDiscoveryEvidence = {
  definitionEvents: TrustedEvent[]
  definitions: Map<string, CommunityDefinition>
  profileListEvents: TrustedEvent[]
  reportStates: Map<string, EffectiveCommunityReportState>
  renouncedCommunityAddresses: string[]
}

const dedupeEvents = (events: TrustedEvent[]) =>
  Array.from(new Map(events.filter(event => event.id).map(event => [event.id, event])).values())

const getContextCommunityPeoplePubkeys = (
  communityAddress: string,
  communityPubkey: string,
  evidence: PeopleDiscoveryEvidence,
) => {
  if (!communityAddress && !communityPubkey) {
    return getCommunityPeoplePubkeys({
      definitions: Array.from(evidence.definitions.values()),
      profileListEvents: evidence.profileListEvents,
      excludedCommunityAddresses: evidence.renouncedCommunityAddresses,
    })
  }

  const definition = communityAddress ? evidence.definitions.get(communityAddress) : undefined
  if (!definition) return [communityPubkey]

  const profileListAddresses = new Set(
    definition.sections.flatMap(section =>
      section.profileLists.map(profileList => profileList.address),
    ),
  )
  const profileListEvents = evidence.profileListEvents.filter(event => {
    const identifier = event.tags.find(tag => tag[0] === "d")?.[1] || ""
    return Boolean(
      identifier && profileListAddresses.has(`${event.kind}:${event.pubkey}:${identifier}`),
    )
  })

  return getCommunityPeoplePubkeys({
    definitions: [definition],
    profileListEvents,
    excludedCommunityAddresses: evidence.renouncedCommunityAddresses,
  })
}

export const peopleDiscoverySearch = derived(
  [
    welshmanProfileSearch,
    profilesByPubkey,
    pubkey,
    followLists,
    muteLists,
    communityAdminDefinitionEvents,
    communityMemberDefinitionEvents,
    communityModeratorDefinitionEvents,
    communityMemberProfileListEvents,
    communityModeratorProfileListEvents,
    communityMemberReportStates,
    activeExactCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    userRenouncedCommunityAddresses,
  ] as const,
  ([
    $welshmanProfileSearch,
    $profilesByPubkey,
    $pubkey,
    _followLists,
    _muteLists,
    $communityAdminDefinitionEvents,
    $communityMemberDefinitionEvents,
    $communityModeratorDefinitionEvents,
    $communityMemberProfileListEvents,
    $communityModeratorProfileListEvents,
    $communityMemberReportStates,
    $activeExactCommunityDefinition,
    $activeCommunityProfileListEvents,
    $activeCommunityReportState,
    $userRenouncedCommunityAddresses,
  ]): PeopleDiscoverySearch => {
    const definitionEvents = dedupeEvents([
      ...$communityAdminDefinitionEvents,
      ...$communityMemberDefinitionEvents,
      ...$communityModeratorDefinitionEvents,
      ...($activeExactCommunityDefinition ? [$activeExactCommunityDefinition.event] : []),
    ])
    const profileListEvents = dedupeEvents([
      ...$communityMemberProfileListEvents,
      ...$communityModeratorProfileListEvents,
      ...$activeCommunityProfileListEvents,
    ])
    const reportStates = new Map($communityMemberReportStates)
    if ($activeExactCommunityDefinition) {
      reportStates.set($activeExactCommunityDefinition.pointer.address, $activeCommunityReportState)
    }
    const evidence: PeopleDiscoveryEvidence = {
      definitionEvents,
      definitions: selectCurrentCommunityDefinitions(definitionEvents),
      profileListEvents,
      reportStates,
      renouncedCommunityAddresses: $userRenouncedCommunityAddresses,
    }
    const viewerPubkey = normalizePubkey($pubkey || "")
    const directFollowPubkeys = viewerPubkey ? getFollows(viewerPubkey) : []
    const directMutePubkeys = viewerPubkey ? getMutes(viewerPubkey) : []

    const search = (
      query: string,
      options: PeopleDiscoverySearchOptions = {},
    ): PeopleSearchBatch => {
      const normalizedQuery = query.trim()
      const resolvedContext = resolvePeopleDiscoveryContext(options.context, evidence, viewerPubkey)
      const rawCommunityPubkeys = getContextCommunityPeoplePubkeys(
        resolvedContext.communityAddress,
        resolvedContext.communityPubkey,
        evidence,
      )
      const getSearchProfile = (candidatePubkey: string) =>
        $welshmanProfileSearch.getOption(candidatePubkey) || null
      const additionalProfileMatches = normalizedQuery
        ? (options.additionalProfileMatches || []).filter(
            candidatePubkey =>
              getPeopleSearchTextScore({
                pubkey: candidatePubkey,
                profile: getSearchProfile(candidatePubkey),
                query: normalizedQuery,
              }) > 0,
          )
        : options.additionalProfileMatches || []
      const profileMatches = normalizedQuery
        ? [
            ...($welshmanProfileSearch.searchValues(normalizedQuery) as string[]),
            ...additionalProfileMatches,
          ]
        : additionalProfileMatches
      const profileMatchSet = new Set(profileMatches.map(normalizePubkey).filter(Boolean))
      const matchesQuery = (candidatePubkey: string) =>
        !normalizedQuery ||
        profileMatchSet.has(normalizePubkey(candidatePubkey)) ||
        getPeopleSearchTextScore({
          pubkey: candidatePubkey,
          profile: getSearchProfile(candidatePubkey),
          query: normalizedQuery,
        }) > 0
      const getTextScore = (candidatePubkey: string) =>
        getPeopleSearchTextScore({
          pubkey: candidatePubkey,
          profile: getSearchProfile(candidatePubkey),
          query: normalizedQuery,
        })
      const matchingCommunityPubkeys = rawCommunityPubkeys.filter(matchesQuery)
      const communityAssessments = buildCommunityTrustAssessments({
        candidatePubkeys: matchingCommunityPubkeys,
        viewerPubkey: viewerPubkey || undefined,
        context: resolvedContext.trustContext,
        definitions: Array.from(evidence.definitions.values()),
        definitionEvents,
        profileListEvents,
        reportStates,
        renouncedCommunityAddresses: $userRenouncedCommunityAddresses,
      })
      const communityPubkeys = matchingCommunityPubkeys
        .filter(candidatePubkey => {
          const assessment = communityAssessments.get(candidatePubkey)
          return Boolean(assessment && !assessment.suppressed && assessment.score > 0)
        })
        .sort((a, b) => {
          const assessmentDifference =
            (communityAssessments.get(b)?.score || 0) - (communityAssessments.get(a)?.score || 0)
          return assessmentDifference || getTextScore(b) - getTextScore(a) || a.localeCompare(b)
        })
      const matchingDirectFollowPubkeys = directFollowPubkeys
        .filter(matchesQuery)
        .sort((a, b) => getTextScore(b) - getTextScore(a) || a.localeCompare(b))
      const knownPubkeys = [
        ...(options.knownPubkeys || []),
        ...(options.allowEmptyQuery ? Array.from($profilesByPubkey.keys()) : []),
      ]
      const candidates = buildPeopleSearchCandidates({
        query: normalizedQuery,
        recentConversationPubkeys: (options.recentConversationPubkeys || []).filter(matchesQuery),
        repoOwnerPubkeys: resolvedContext.repoOwnerPubkeys.filter(matchesQuery),
        repoMaintainerPubkeys: resolvedContext.repoMaintainerPubkeys.filter(matchesQuery),
        communityPubkeys,
        directFollowPubkeys: matchingDirectFollowPubkeys,
        directMutePubkeys,
        knownPubkeys,
        profileMatches,
      })

      return searchPeopleCandidates({
        query: normalizedQuery,
        candidates,
        excludePubkeys: options.excludePubkeys,
        communityAssessments,
        getProfile: getSearchProfile,
        cursor: options.cursor,
        scanLimit: options.scanLimit,
        resultLimit: options.resultLimit,
        allowEmptyQuery: options.allowEmptyQuery,
      })
    }

    return {
      search,
      searchResults: (query, options) => search(query, options).results,
      searchValues: (query, options) => search(query, options).results.map(result => result.pubkey),
    }
  },
)
