import type {RepoAnnouncementEvent} from "@nostr-git/core/events"
import type {TrustedEvent} from "@welshman/util"
import {
  getProfileListPubkeys,
  normalizePubkey,
  parseCommunityId,
  parseTargetedPublication,
  type CommunityDefinition,
} from "@app/core/community"
import {
  isCommunityPersonBanned,
  type EffectiveCommunityReportState,
} from "@app/core/community-reports"
import {getRepoDeclaredMaintainers} from "@app/core/repo-authority"
import {getRepoAddress} from "@app/core/repo-community-context"
import type {TrustContext} from "@app/core/trust-assessment"

export type CommunityPeopleDiscoveryContext = {
  scope: "community"
  communityPubkey: string
  communityAddress: string
}

export type RepoAuthorityContext =
  | {
      source: "announcement"
      event: RepoAnnouncementEvent
    }
  | {
      source: "draft"
      ownerPubkey: string
      maintainerPubkeys?: string[]
    }

export type RepoPeopleDiscoveryContext = {
  scope: "repo"
  repoAddress?: string
  authority: RepoAuthorityContext
  community?: CommunityPeopleDiscoveryContext
  associationEvents?: TrustedEvent[]
}

export type PeopleDiscoveryContext =
  | {scope: "global_discovery"}
  | CommunityPeopleDiscoveryContext
  | RepoPeopleDiscoveryContext

export type PeopleDiscoveryContextEvidence = {
  definitions: Map<string, CommunityDefinition>
  profileListEvents: TrustedEvent[]
  reportStates: Map<string, EffectiveCommunityReportState>
}

export type ResolvedPeopleDiscoveryContext = {
  trustContext: TrustContext & {communityAddress?: string}
  communityPubkey: string
  communityAddress: string
  repoOwnerPubkeys: string[]
  repoMaintainerPubkeys: string[]
}

const normalizePubkeys = (pubkeys: string[]) =>
  Array.from(new Set(pubkeys.map(normalizePubkey).filter(Boolean)))

const getEventAddress = (event: TrustedEvent) => {
  const identifier = event.tags.find(tag => tag[0] === "d")?.[1] || ""
  return identifier ? `${event.kind}:${event.pubkey}:${identifier}` : ""
}

const getReportState = (
  reportStates: Map<string, EffectiveCommunityReportState>,
  communityAddress: string,
) => reportStates.get(communityAddress)

const getEndorsedRepoCommunity = ({
  context,
  evidence,
  announcement,
  repoAddress,
}: {
  context: RepoPeopleDiscoveryContext
  evidence: PeopleDiscoveryContextEvidence
  announcement: RepoAnnouncementEvent
  repoAddress: string
}) => {
  const definitions = evidence.definitions
  const profileLists = new Map(
    evidence.profileListEvents.map(event => [getEventAddress(event), event]),
  )
  const repoOwner = normalizePubkey(announcement.pubkey)
  const getAuthorityPubkeys = (definition: CommunityDefinition) => {
    const authorityPubkeys = new Set<string>([normalizePubkey(definition.ownerPubkey)])
    for (const section of definition.sections) {
      if (!section.kinds.some(item => item.kind === announcement.kind)) continue
      for (const ref of section.profileLists) {
        const profileList = profileLists.get(ref.address)
        if (!profileList) continue
        authorityPubkeys.add(normalizePubkey(profileList.pubkey))
        for (const pubkey of getProfileListPubkeys(profileList)) authorityPubkeys.add(pubkey)
      }
    }
    return authorityPubkeys
  }

  const communityTags = announcement.tags.filter(tag => tag[0] === "h")
  if (communityTags.length === 1) {
    const communityId = parseCommunityId(communityTags[0]?.[1] || "")
    const definition = Array.from(definitions.values()).find(
      candidate => parseCommunityId(candidate.communityId) === communityId,
    )
    if (definition) {
      const reportState = getReportState(evidence.reportStates, definition.pointer.address)
      if (
        getAuthorityPubkeys(definition).has(repoOwner) &&
        !isCommunityPersonBanned(reportState, repoOwner)
      ) {
        return definition.pointer
      }
    }
  }

  for (const event of [...(context.associationEvents || [])].sort(
    (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
  )) {
    const targeting = parseTargetedPublication(event)
    if (targeting?.kind !== announcement.kind) continue
    if (targeting.source?.type === "a" && targeting.source.value !== repoAddress) continue
    if (targeting.source?.type === "e" && targeting.source.value !== announcement.id) continue
    if (!targeting.source) continue

    const associationAuthor = normalizePubkey(event.pubkey)
    for (const community of targeting.communities) {
      const definition = definitions.get(community.address)
      if (!definition) continue

      const reportState = getReportState(evidence.reportStates, community.address)
      if (
        isCommunityPersonBanned(reportState, associationAuthor) ||
        isCommunityPersonBanned(reportState, repoOwner)
      ) {
        continue
      }

      if (getAuthorityPubkeys(definition).has(associationAuthor)) return definition.pointer
    }
  }

  return undefined
}

export const resolveCommunityPeopleDiscoveryContext = (
  context: CommunityPeopleDiscoveryContext,
  viewerPubkey = "",
): ResolvedPeopleDiscoveryContext => {
  const communityPubkey = normalizePubkey(context.communityPubkey)
  const communityAddress = context.communityAddress?.trim() || ""
  const normalizedViewer = normalizePubkey(viewerPubkey)

  return {
    trustContext: {
      scope: "community",
      viewerPubkey: normalizedViewer || undefined,
      communityPubkey: communityPubkey || undefined,
      communityAddress: communityAddress || undefined,
    },
    communityPubkey,
    communityAddress,
    repoOwnerPubkeys: [],
    repoMaintainerPubkeys: [],
  }
}

export const resolveRepoPeopleDiscoveryContext = (
  context: RepoPeopleDiscoveryContext,
  evidence: PeopleDiscoveryContextEvidence,
  viewerPubkey = "",
): ResolvedPeopleDiscoveryContext => {
  const normalizedViewer = normalizePubkey(viewerPubkey)
  const announcement = context.authority.source === "announcement" ? context.authority.event : null
  const repoOwnerPubkeys = normalizePubkeys([
    context.authority.source === "announcement"
      ? context.authority.event.pubkey
      : context.authority.ownerPubkey,
  ])
  const repoMaintainerPubkeys = normalizePubkeys(
    context.authority.source === "announcement"
      ? getRepoDeclaredMaintainers(context.authority.event)
      : context.authority.maintainerPubkeys || [],
  ).filter(maintainer => !repoOwnerPubkeys.includes(maintainer))
  const repoAddress =
    context.repoAddress || (announcement ? getRepoAddress(announcement as TrustedEvent) : "")
  let communityPubkey = normalizePubkey(context.community?.communityPubkey || "")
  let communityAddress = context.community?.communityAddress?.trim() || ""

  if (!communityPubkey && announcement) {
    const community = getEndorsedRepoCommunity({context, evidence, announcement, repoAddress})
    if (community) {
      communityPubkey = normalizePubkey(community.ownerPubkey)
      communityAddress = community.address
    }
  }

  return {
    trustContext: {
      scope: "repo",
      viewerPubkey: normalizedViewer || undefined,
      repoAddress: repoAddress || undefined,
      communityPubkey: communityPubkey || undefined,
      communityAddress: communityAddress || undefined,
    },
    communityPubkey,
    communityAddress,
    repoOwnerPubkeys,
    repoMaintainerPubkeys,
  }
}

export const resolvePeopleDiscoveryContext = (
  context: PeopleDiscoveryContext | undefined,
  evidence: PeopleDiscoveryContextEvidence,
  viewerPubkey = "",
): ResolvedPeopleDiscoveryContext => {
  const normalizedViewer = normalizePubkey(viewerPubkey)

  if (!context || context.scope === "global_discovery") {
    return {
      trustContext: {scope: "global_discovery", viewerPubkey: normalizedViewer || undefined},
      communityPubkey: "",
      communityAddress: "",
      repoOwnerPubkeys: [],
      repoMaintainerPubkeys: [],
    }
  }

  return context.scope === "community"
    ? resolveCommunityPeopleDiscoveryContext(context, normalizedViewer)
    : resolveRepoPeopleDiscoveryContext(context, evidence, normalizedViewer)
}
