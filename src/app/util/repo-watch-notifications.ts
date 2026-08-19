import {derived, readable, type Readable} from "svelte/store"
import {request} from "@welshman/net"
import type {RequestOptions} from "@welshman/net"
import {pubkey, repository, tracker} from "@welshman/app"
import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
import {now} from "@welshman/lib"
import {
  Address,
  getTagValue,
  isRelayUrl,
  matchFilters,
  normalizeRelayUrl,
  type Filter,
  type TrustedEvent,
} from "@welshman/util"
import {Router} from "@welshman/router"
import {
  GIT_COMMENT,
  GIT_ISSUE,
  GIT_LABEL,
  GIT_PULL_REQUEST,
  GIT_PULL_REQUEST_UPDATE,
  GIT_REPO_ANNOUNCEMENT,
  GIT_STATUS_APPLIED,
  GIT_STATUS_CLOSED,
  GIT_STATUS_DRAFT,
  GIT_STATUS_OPEN,
  parseRepoAnnouncementEvent,
  type RepoAnnouncementEvent,
} from "@nostr-git/core/events"
import {
  COMMUNITY_DEFINITION_KIND,
  parseCommunityDefinitionAddress,
  parseCommunityDefinition,
  type CommunityDefinition,
} from "@app/core/community"
import {
  makeCommunityProfileListFilters,
  makeCommunityReportFilters,
} from "@app/core/community-state"
import {
  COMMUNITY_WRITE_TARGETS,
  canWriteCommunityTarget,
  getCommunityTargetWriterPubkeys,
} from "@app/core/community-permissions"
import {
  getEffectiveCommunityReportState,
  type EffectiveCommunityReportState,
} from "@app/core/community-reports"
import {
  GIT_RELAYS,
  getRepoMaintainers,
  getStatusRootId,
  repoAnnouncements,
} from "@app/core/git-state"
import {
  defaultRepoWatchOptions,
  repoWatchNotificationSeen,
  userRepoWatchValues,
  type RepoWatchOptions,
} from "@app/core/repo-watch"
import {
  checked,
  effectiveCommunityNotificationBaselines,
  hasNotificationForPath,
  normalizeChecked,
  setNotificationsConfig,
  type NotificationCandidate,
} from "@app/util/notifications"
import {
  notificationHistoryFilterLimit,
  notificationHistorySince,
} from "@app/util/notification-history"
import {ROLE_NS} from "@app/util/labels"
import {createBackgroundLiveCoordinator} from "@app/core/background-live"
import {
  isRepoLiveOwned,
  repoLiveOwnership,
  type RepoLiveOwnership,
} from "@app/core/repo-live-ownership"
import {notificationBackgroundEnabled} from "@app/util/notification-background"
import {receiveRepositoryCacheEvent} from "@app/core/repo-cache"
import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
import {
  createBoundedCommunityHistoryLoader,
  makeSameAuthorDeleteFilters,
  type BoundedCommunityHistoryResult,
} from "@app/core/requests"

type RepoWatchAddressRef = {
  address: string
  pubkey: string
  identifier: string
  naddr: string
}

type WatchedRepoRef = RepoWatchAddressRef & {
  options: RepoWatchOptions
}

export type RepoWatchNotificationRepo = RepoWatchAddressRef & {
  options: RepoWatchOptions
  repoEvent?: TrustedEvent
  communityAddress?: string
  communityDefinition?: CommunityDefinition
  communityProfileListEvents?: TrustedEvent[]
  communityReportState?: EffectiveCommunityReportState
}

export type GetRepoNotificationReposOptions = {
  watchedRepos: WatchedRepoRef[]
  repoEvents: TrustedEvent[]
  currentPubkey?: string
}

export type RepoWatchNotificationInput = {
  repos: RepoWatchNotificationRepo[]
  issues?: TrustedEvent[]
  pullRequests?: TrustedEvent[]
  pullRequestUpdates?: TrustedEvent[]
  statuses?: TrustedEvent[]
  comments?: TrustedEvent[]
  labels?: TrustedEvent[]
  currentPubkey?: string
}

export type RepoWatchActivityRelayTarget = {
  address: string
  relays: string[]
  since: number
  limit: number
  rootIds?: string[]
  authors?: string[]
}

export type RepoWatchRelayFilterGroup = {
  relay: string
  scope?: string
  filters: Filter[]
  localFilters: Filter[]
  liveFilters: Filter[]
  acceptSaturated?: boolean
  maxPages?: number
}

export type RepoWatchHistoryStatus = {
  loading: boolean
  complete: boolean
  saturated: boolean
}

type LoadedRepoWatchEvents<T extends TrustedEvent> = RepoWatchHistoryStatus & {
  events: T[]
  completeRelays: Set<string>
  completeScopes: Set<string>
}

export type RepoWatchCommunityContext = {
  definition?: CommunityDefinition
  profileListEvents: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
  ready: boolean
}

type RepoWatchCandidateSection = "issues" | "prs"

const statusKinds = [GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_APPLIED, GIT_STATUS_CLOSED]

const repoActivityKinds = [
  GIT_ISSUE,
  GIT_PULL_REQUEST,
  GIT_PULL_REQUEST_UPDATE,
  ...statusKinds,
  GIT_COMMENT,
  GIT_LABEL,
]

const REPO_ACTIVITY_FILTER_CHUNK_SIZE = 100
const REPO_WATCH_SEEN_BUFFER_SECONDS = 60
const REPO_WATCH_HARD_LOOKBACK_SECONDS = 60 * 60 * 24 * 30
const REPO_WATCH_LOAD_LIMIT = 200
const MAX_REPO_NOTIFICATION_RELAYS_PER_SOURCE = 6

export const defaultOwnedRepoNotificationOptions: RepoWatchOptions = {
  ...defaultRepoWatchOptions,
  issues: {...defaultRepoWatchOptions.issues, comments: true},
  prs: {...defaultRepoWatchOptions.prs, comments: true},
  reviews: true,
}

export const hasGitNotification = (paths: Set<string>) => {
  for (const path of paths) {
    if (path.startsWith("/git/")) return true
  }

  return false
}

const normalizeRelay = (relay: string | undefined) => {
  if (!relay) return ""

  try {
    const normalized = normalizeRelayUrl(relay)
    return isRelayUrl(normalized) ? normalized : ""
  } catch {
    return ""
  }
}

const normalizeRelays = (relays: Iterable<string | undefined>) =>
  Array.from(new Set(Array.from(relays).map(normalizeRelay).filter(Boolean)))

const chunkBySize = <T>(items: T[], size: number) => {
  const chunks: T[][] = []

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }

  return chunks
}

const getBaseRelays = () => {
  let userRelays: string[] = []

  try {
    const urls = Router.get().FromUser().getUrls()
    userRelays = Array.isArray(urls) ? urls : []
  } catch {
    userRelays = []
  }

  return normalizeRelays([...GIT_RELAYS, ...userRelays]).slice(
    0,
    MAX_REPO_NOTIFICATION_RELAYS_PER_SOURCE,
  )
}

const getRepoWatchPath = (repo: RepoWatchAddressRef, section: RepoWatchCandidateSection) =>
  `/git/${repo.naddr}/${section}`

const getRepoWatchPaths = (repo: RepoWatchAddressRef) => [
  getRepoWatchPath(repo, "issues"),
  getRepoWatchPath(repo, "prs"),
]

const mergeCheckedState = (
  checkedState: Record<string, number> = {},
  notificationSeen: Record<string, number> = {},
) => {
  const merged: Record<string, number> = {}

  for (const [path, timestamp] of Object.entries(notificationSeen)) {
    const normalized = normalizeChecked(Number(timestamp || 0))
    if (path && normalized > 0) merged[path] = normalized
  }

  for (const [path, timestamp] of Object.entries(checkedState)) {
    const normalized = normalizeChecked(Number(timestamp || 0))
    if (!path || normalized <= 0) continue
    merged[path] = Math.max(merged[path] || 0, normalized)
  }

  return merged
}

const getRepoWatchSeenAt = (
  repo: RepoWatchAddressRef,
  checkedState: Record<string, number> = {},
  notificationSeen: Record<string, number> = {},
) => {
  const merged = mergeCheckedState(checkedState, notificationSeen)
  const seenValues = getRepoWatchPaths(repo)
    .map(path => Math.max(merged[path] || 0, merged[`${path}:seen`] || 0))
    .filter(timestamp => timestamp > 0)

  return seenValues.length > 0 ? Math.min(...seenValues) : 0
}

const getBoundedSince = (seenAt: number) => {
  const current = now()
  const baseline = seenAt > 0 ? seenAt : current
  return Math.max(
    0,
    baseline - REPO_WATCH_SEEN_BUFFER_SECONDS,
    current - REPO_WATCH_HARD_LOOKBACK_SECONDS,
  )
}

const getHistoryBoundedSince = (seenAt: number, historySince: number) =>
  Math.min(getBoundedSince(seenAt), normalizeChecked(historySince))

const getFilterKey = (filters: Filter[]) =>
  filters
    .map(filter => JSON.stringify(filter))
    .sort()
    .join("|")

const dedupeFilters = (filters: Filter[]) =>
  Array.from(new Map(filters.map(filter => [getFilterKey([filter]), filter] as const)).values())

const getRepoEventRelays = (repo: RepoWatchNotificationRepo) => {
  if (!repo.repoEvent) return []

  try {
    return normalizeRelays(
      parseRepoAnnouncementEvent(repo.repoEvent as RepoAnnouncementEvent).relays || [],
    ).slice(0, MAX_REPO_NOTIFICATION_RELAYS_PER_SOURCE)
  } catch {
    return []
  }
}

const buildAddressFilters = (targets: RepoWatchActivityRelayTarget[]) => {
  const filters: Filter[] = []
  const addressesByBoundary = new Map<string, {since: number; limit: number; addresses: string[]}>()

  for (const target of targets) {
    const key = `${target.since}:${target.limit}`
    const boundary = addressesByBoundary.get(key) || {
      since: target.since,
      limit: target.limit,
      addresses: [],
    }
    boundary.addresses.push(target.address)
    addressesByBoundary.set(key, boundary)
  }

  for (const boundary of addressesByBoundary.values()) {
    const addresses = Array.from(new Set(boundary.addresses.filter(Boolean))).sort()
    for (const addressChunk of chunkBySize(addresses, REPO_ACTIVITY_FILTER_CHUNK_SIZE)) {
      filters.push({
        kinds: repoActivityKinds,
        "#a": addressChunk,
        since: boundary.since,
        limit: boundary.limit,
      })
    }
  }

  return filters
}

const buildRootFilters = (targets: RepoWatchActivityRelayTarget[]) => {
  const filters: Filter[] = []
  const rootIdsByBoundary = new Map<string, {since: number; limit: number; rootIds: string[]}>()

  for (const target of targets) {
    if (!target.rootIds?.length) continue
    const key = `${target.since}:${target.limit}`
    const boundary = rootIdsByBoundary.get(key) || {
      since: target.since,
      limit: target.limit,
      rootIds: [],
    }
    boundary.rootIds.push(...target.rootIds)
    rootIdsByBoundary.set(key, boundary)
  }

  for (const boundary of rootIdsByBoundary.values()) {
    const rootIds = Array.from(new Set(boundary.rootIds.filter(Boolean))).sort()
    for (const rootChunk of chunkBySize(rootIds, REPO_ACTIVITY_FILTER_CHUNK_SIZE)) {
      filters.push(
        {kinds: [GIT_COMMENT], "#E": rootChunk, since: boundary.since, limit: boundary.limit},
        {kinds: [GIT_COMMENT], "#e": rootChunk, since: boundary.since, limit: boundary.limit},
        {kinds: [GIT_LABEL], "#e": rootChunk, since: boundary.since, limit: boundary.limit},
        {kinds: statusKinds, "#e": rootChunk, since: boundary.since, limit: boundary.limit},
        {kinds: [GIT_ISSUE, GIT_PULL_REQUEST], ids: rootChunk, limit: boundary.limit},
      )
    }
  }

  return filters
}

const applyTargetAuthors = (filters: Filter[], authors: string[] | undefined) =>
  authors === undefined ? filters : filters.map(filter => ({...filter, authors}))

const buildLocalAddressFilters = (targets: RepoWatchActivityRelayTarget[]) =>
  targets.flatMap(target => applyTargetAuthors(buildAddressFilters([target]), target.authors))

const buildLocalRootFilters = (targets: RepoWatchActivityRelayTarget[]) =>
  targets.flatMap(target =>
    buildRootFilters([target]).map(filter =>
      filter.ids || target.authors === undefined ? filter : {...filter, authors: target.authors},
    ),
  )

const buildRepoWatchRelayGroups = (
  targets: RepoWatchActivityRelayTarget[],
  ownership: RepoLiveOwnership,
  buildFilters: (targets: RepoWatchActivityRelayTarget[]) => Filter[],
  buildLocalFilters: (targets: RepoWatchActivityRelayTarget[]) => Filter[],
): RepoWatchRelayFilterGroup[] => {
  const targetsByRelay = new Map<string, RepoWatchActivityRelayTarget[]>()

  for (const target of targets) {
    for (const relay of normalizeRelays(target.relays)) {
      const relayTargets = targetsByRelay.get(relay) || []
      relayTargets.push(target)
      targetsByRelay.set(relay, relayTargets)
    }
  }

  return Array.from(targetsByRelay, ([relay, relayTargets]) => ({
    relay,
    filters: dedupeFilters(buildFilters(relayTargets)),
    localFilters: dedupeFilters(buildLocalFilters(relayTargets)),
    liveFilters: dedupeFilters(
      buildFilters(
        relayTargets.filter(target => !isRepoLiveOwned(ownership, target.address, relay)),
      ),
    ),
  })).sort((a, b) => a.relay.localeCompare(b.relay))
}

export const buildRepoWatchActivityRelayGroups = (
  targets: RepoWatchActivityRelayTarget[],
  ownership: RepoLiveOwnership = new Set(),
) => buildRepoWatchRelayGroups(targets, ownership, buildAddressFilters, buildLocalAddressFilters)

export const buildRepoWatchRootRelayGroups = (
  targets: RepoWatchActivityRelayTarget[],
  ownership: RepoLiveOwnership = new Set(),
) => buildRepoWatchRelayGroups(targets, ownership, buildRootFilters, buildLocalRootFilters)

type RepoWatchScopedFilterSource = {
  communityAddress?: string
  relays: string[]
  filters: Filter[]
}

export const buildRepoWatchScopedFilterGroups = (
  sources: RepoWatchScopedFilterSource[],
  currentOnly = false,
): RepoWatchRelayFilterGroup[] => {
  const groupsByScopeRelay = new Map<string, {scope: string; relay: string; filters: Filter[]}>()

  for (const source of sources) {
    const relays = normalizeRelays(source.relays)
    if (relays.length === 0 && source.filters.length > 0) {
      const scope = source.communityAddress || ""
      groupsByScopeRelay.set(`${scope}:`, {scope, relay: "", filters: [...source.filters]})
    }

    for (const relay of relays) {
      const scope = source.communityAddress || ""
      const key = `${scope}:${relay}`
      const group = groupsByScopeRelay.get(key) || {scope, relay, filters: []}
      group.filters.push(...source.filters)
      groupsByScopeRelay.set(key, group)
    }
  }

  return Array.from(groupsByScopeRelay.values(), ({scope, relay, filters}) => {
    const scopedFilters = dedupeFilters(filters)
    return {
      relay,
      ...(scope ? {scope} : {}),
      filters: scopedFilters,
      localFilters: scopedFilters,
      liveFilters: relay ? scopedFilters : [],
      ...(currentOnly ? {acceptSaturated: true, maxPages: 1} : {}),
    }
  }).sort((a, b) => a.relay.localeCompare(b.relay) || (a.scope || "").localeCompare(b.scope || ""))
}

const parseWatchedRepoAddress = (address: string): RepoWatchAddressRef | undefined => {
  try {
    const ref = Address.from(address)
    if (ref.kind !== GIT_REPO_ANNOUNCEMENT || !ref.pubkey || !ref.identifier) return undefined

    return {
      address: ref.toString(),
      pubkey: ref.pubkey,
      identifier: ref.identifier,
      naddr: ref.toNaddr(),
    }
  } catch {
    return undefined
  }
}

const parseRepoAnnouncementRef = (event: TrustedEvent): RepoWatchAddressRef | undefined => {
  if (event.kind !== GIT_REPO_ANNOUNCEMENT) return undefined

  try {
    const ref = Address.fromEvent(event)
    if (ref.kind !== GIT_REPO_ANNOUNCEMENT || !ref.pubkey || !ref.identifier) return undefined

    return {
      address: ref.toString(),
      pubkey: ref.pubkey,
      identifier: ref.identifier,
      naddr: ref.toNaddr(),
    }
  } catch {
    return undefined
  }
}

const mapRepoEventsByAddress = (events: TrustedEvent[]) => {
  const byAddress = new Map<string, TrustedEvent>()

  for (const event of events) {
    const ref = parseRepoAnnouncementRef(event)
    if (ref) byAddress.set(ref.address, event)
  }

  return byAddress
}

export const getRepoNotificationRepos = ({
  watchedRepos,
  repoEvents,
  currentPubkey,
}: GetRepoNotificationReposOptions): RepoWatchNotificationRepo[] => {
  const reposByAddress = new Map<string, RepoWatchNotificationRepo>()
  const repoEventsByAddress = mapRepoEventsByAddress(repoEvents)

  for (const repo of watchedRepos) {
    reposByAddress.set(repo.address, {
      ...repo,
      repoEvent: repoEventsByAddress.get(repo.address),
    })
  }

  if (currentPubkey) {
    for (const event of repoEventsByAddress.values()) {
      const ref = parseRepoAnnouncementRef(event)
      if (!ref) continue
      if (!getRepoMaintainers(event as RepoAnnouncementEvent).includes(currentPubkey)) continue

      const existing = reposByAddress.get(ref.address)
      if (existing) {
        if (!existing.repoEvent) reposByAddress.set(ref.address, {...existing, repoEvent: event})
        continue
      }

      reposByAddress.set(ref.address, {
        ...ref,
        options: defaultOwnedRepoNotificationOptions,
        repoEvent: event,
      })
    }
  }

  return Array.from(reposByAddress.values()).sort((a, b) => a.address.localeCompare(b.address))
}

const getRepoAddress = (event: TrustedEvent) => getTagValue("a", event.tags) || ""

const getCommentRootId = (event: TrustedEvent) =>
  getTagValue("E", event.tags) || getTagValue("e", event.tags) || ""

const getLabelRootId = (event: TrustedEvent) => getTagValue("e", event.tags) || ""

const getRootKind = (event: TrustedEvent) =>
  Number(getTagValue("K", event.tags) || getTagValue("k", event.tags) || 0)

const getRootSection = (event: TrustedEvent): RepoWatchCandidateSection | undefined => {
  const rootKind = getRootKind(event)

  if (rootKind === GIT_ISSUE) return "issues"
  if (rootKind === GIT_PULL_REQUEST) return "prs"
}

const getRepoWatchRootIdsForEvent = (event: TrustedEvent) => {
  if (event.kind === GIT_ISSUE || event.kind === GIT_PULL_REQUEST) return [event.id]
  if (statusKinds.includes(event.kind)) return [getStatusRootId(event as any)]
  if (event.kind === GIT_COMMENT) return [getCommentRootId(event)]
  if (event.kind === GIT_LABEL) return [getLabelRootId(event)]

  return []
}

export const getRepoWatchRootIdsForEvents = (events: TrustedEvent[]) =>
  Array.from(new Set(events.flatMap(getRepoWatchRootIdsForEvent).filter(Boolean)))

const getStatusOption = (kind: number): keyof RepoWatchOptions["status"] | undefined => {
  if (kind === GIT_STATUS_OPEN) return "open"
  if (kind === GIT_STATUS_DRAFT) return "draft"
  if (kind === GIT_STATUS_APPLIED) return "applied"
  if (kind === GIT_STATUS_CLOSED) return "closed"
}

const getRepoMaintainerSet = (repo: RepoWatchNotificationRepo) => {
  const repoEvent = repo.repoEvent as RepoAnnouncementEvent | undefined
  const maintainers = repoEvent ? getRepoMaintainers(repoEvent) : [repo.pubkey]

  return new Set(maintainers)
}

const authorCanWriteRepoCommunity = (repo: RepoWatchNotificationRepo, authorPubkey: string) => {
  const definition = repo.communityDefinition
  const reportState = repo.communityReportState
  if (!definition || !reportState) return false

  return canWriteCommunityTarget({
    definition,
    profileListEvents: repo.communityProfileListEvents || [],
    userPubkey: authorPubkey,
    target: COMMUNITY_WRITE_TARGETS.repository,
    reportState,
  })
}

const repoAllowsAuthor = ({
  repo,
  authorPubkey,
  currentPubkey,
}: {
  repo: RepoWatchNotificationRepo
  authorPubkey: string
  currentPubkey?: string
}) => {
  if (!authorPubkey) return false
  if (currentPubkey && authorPubkey === currentPubkey) return false

  const maintainers = getRepoMaintainerSet(repo)
  const isMaintainer = maintainers.has(authorPubkey)
  const isCommunityWriter = authorCanWriteRepoCommunity(repo, authorPubkey)

  if (repo.options.activityFilter === "maintainers") return isMaintainer
  if (repo.options.activityFilter === "community") return isCommunityWriter
  if (repo.options.activityFilter === "maintainers-community") {
    return isMaintainer || isCommunityWriter
  }

  return true
}

const isRoleLabelForCurrentUser = (
  event: TrustedEvent,
  currentPubkey: string | undefined,
  role: string,
) => {
  if (!currentPubkey || event.kind !== GIT_LABEL) return false

  const hasRoleNamespace = event.tags.some(tag => tag[0] === "L" && tag[1] === ROLE_NS)
  if (!hasRoleNamespace) return false

  const assignsCurrentUser = event.tags.some(tag => tag[0] === "p" && tag[1] === currentPubkey)
  if (!assignsCurrentUser) return false

  return event.tags.some(
    tag => tag[0] === "l" && tag[1] === role && tag[2] === ROLE_NS && tag[3] !== "del",
  )
}

const isAssigneeLabelForCurrentUser = (event: TrustedEvent, currentPubkey?: string) =>
  isRoleLabelForCurrentUser(event, currentPubkey, "assignee")

const isReviewerLabelForCurrentUser = (event: TrustedEvent, currentPubkey?: string) =>
  isRoleLabelForCurrentUser(event, currentPubkey, "reviewer")

const isNewerEvent = (event: TrustedEvent, current: TrustedEvent) =>
  event.created_at > current.created_at ||
  (event.created_at === current.created_at && event.id > current.id)

const addCandidate = ({
  candidates,
  repo,
  section,
  event,
  enabled,
  currentPubkey,
}: {
  candidates: Map<string, NotificationCandidate>
  repo: RepoWatchNotificationRepo
  section: RepoWatchCandidateSection
  event: TrustedEvent
  enabled: boolean
  currentPubkey?: string
}) => {
  if (!enabled) return
  if (!repoAllowsAuthor({repo, authorPubkey: event.pubkey, currentPubkey})) return

  const path = getRepoWatchPath(repo, section)
  const current = candidates.get(path)

  if (!current?.latestEvent || isNewerEvent(event, current.latestEvent)) {
    const repoRelayHints = getRepoEventRelays(repo)
    candidates.set(path, {
      path,
      latestEvent: event,
      ...(repoRelayHints.length > 0 ? {repoRelayHints} : {}),
    })
  }
}

const dedupeEvents = (events: TrustedEvent[]) => {
  const byId = new Map<string, TrustedEvent>()

  for (const event of events) {
    if (event?.id) byId.set(event.id, event)
  }

  return Array.from(byId.values())
}

export const getRepoWatchNotificationCandidates = ({
  repos,
  issues = [],
  pullRequests = [],
  pullRequestUpdates = [],
  statuses = [],
  comments = [],
  labels = [],
  currentPubkey,
}: RepoWatchNotificationInput): NotificationCandidate[] => {
  const reposByAddress = new Map(repos.map(repo => [repo.address, repo]))
  const issueReposByRootId = new Map<string, RepoWatchNotificationRepo>()
  const prReposByRootId = new Map<string, RepoWatchNotificationRepo>()
  const issuesByRootId = new Map<string, TrustedEvent>()
  const prsByRootId = new Map<string, TrustedEvent>()
  const candidates = new Map<string, NotificationCandidate>()

  for (const issue of issues) {
    if (issue.kind !== GIT_ISSUE) continue
    const repo = reposByAddress.get(getRepoAddress(issue))
    if (!repo) continue

    issueReposByRootId.set(issue.id, repo)
    issuesByRootId.set(issue.id, issue)
    addCandidate({
      candidates,
      repo,
      section: "issues",
      event: issue,
      enabled: repo.options.issues.new,
      currentPubkey,
    })
  }

  for (const pullRequest of pullRequests) {
    if (pullRequest.kind !== GIT_PULL_REQUEST) continue
    const repo = reposByAddress.get(getRepoAddress(pullRequest))
    if (!repo) continue

    prReposByRootId.set(pullRequest.id, repo)
    prsByRootId.set(pullRequest.id, pullRequest)
    addCandidate({
      candidates,
      repo,
      section: "prs",
      event: pullRequest,
      enabled: repo.options.prs.new,
      currentPubkey,
    })
  }

  for (const update of pullRequestUpdates) {
    if (update.kind !== GIT_PULL_REQUEST_UPDATE) continue
    const repo = reposByAddress.get(getRepoAddress(update))
    if (!repo) continue

    addCandidate({
      candidates,
      repo,
      section: "prs",
      event: update,
      enabled: repo.options.prs.updates,
      currentPubkey,
    })
  }

  for (const status of statuses) {
    const statusOption = getStatusOption(status.kind)
    if (!statusOption) continue

    const rootId = getStatusRootId(status as any)
    const issueRepo = issueReposByRootId.get(rootId)
    const prRepo = prReposByRootId.get(rootId)
    const fallbackRepo = reposByAddress.get(getRepoAddress(status))
    const fallbackSection = getRootSection(status)
    const issueCandidateRepo =
      issueRepo || (fallbackSection === "issues" ? fallbackRepo : undefined)
    const prCandidateRepo = prRepo || (fallbackSection === "prs" ? fallbackRepo : undefined)

    if (issueCandidateRepo) {
      addCandidate({
        candidates,
        repo: issueCandidateRepo,
        section: "issues",
        event: status,
        enabled: issueCandidateRepo.options.status[statusOption],
        currentPubkey,
      })
    }

    if (prCandidateRepo) {
      addCandidate({
        candidates,
        repo: prCandidateRepo,
        section: "prs",
        event: status,
        enabled: prCandidateRepo.options.status[statusOption],
        currentPubkey,
      })
    }
  }

  for (const comment of comments) {
    if (comment.kind !== GIT_COMMENT) continue

    const rootId = getCommentRootId(comment)
    const issueRepo = issueReposByRootId.get(rootId)
    const prRepo = prReposByRootId.get(rootId)
    const fallbackRepo = reposByAddress.get(getRepoAddress(comment))
    const fallbackSection = getRootSection(comment)
    const issueCandidateRepo =
      issueRepo || (fallbackSection === "issues" ? fallbackRepo : undefined)
    const prCandidateRepo = prRepo || (fallbackSection === "prs" ? fallbackRepo : undefined)

    if (issueCandidateRepo) {
      addCandidate({
        candidates,
        repo: issueCandidateRepo,
        section: "issues",
        event: comment,
        enabled: issueCandidateRepo.options.issues.comments,
        currentPubkey,
      })
    }

    if (prCandidateRepo) {
      addCandidate({
        candidates,
        repo: prCandidateRepo,
        section: "prs",
        event: comment,
        enabled: prCandidateRepo.options.prs.comments,
        currentPubkey,
      })
    }
  }

  for (const label of labels) {
    const isAssignment = isAssigneeLabelForCurrentUser(label, currentPubkey)
    const isReviewRequest = isReviewerLabelForCurrentUser(label, currentPubkey)
    if (!isAssignment && !isReviewRequest) continue

    const rootId = getLabelRootId(label)
    const issueRepo = issueReposByRootId.get(rootId)
    const prRepo = prReposByRootId.get(rootId)
    const issueRoot = issuesByRootId.get(rootId)
    const prRoot = prsByRootId.get(rootId)
    const isAuthorized = (repo: RepoWatchNotificationRepo, root: TrustedEvent) => {
      const repoEvent = repo.repoEvent as RepoAnnouncementEvent | undefined
      if (!repoEvent) return false

      return new Set([root.pubkey, ...getRepoMaintainers(repoEvent)]).has(label.pubkey)
    }

    if (issueRepo && issueRoot && isAuthorized(issueRepo, issueRoot)) {
      addCandidate({
        candidates,
        repo: issueRepo,
        section: "issues",
        event: label,
        enabled: isAssignment ? issueRepo.options.assignments : issueRepo.options.reviews,
        currentPubkey,
      })
    }

    if (prRepo && prRoot && isAuthorized(prRepo, prRoot)) {
      addCandidate({
        candidates,
        repo: prRepo,
        section: "prs",
        event: label,
        enabled: isAssignment ? prRepo.options.assignments : prRepo.options.reviews,
        currentPubkey,
      })
    }
  }

  return Array.from(candidates.values()).sort((a, b) => a.path.localeCompare(b.path))
}

const watchedRepoRefs: Readable<WatchedRepoRef[]> = derived(userRepoWatchValues, $values =>
  Object.entries($values.repos)
    .map(([address, options]) => {
      const ref = parseWatchedRepoAddress(address)
      return ref ? {...ref, options} : undefined
    })
    .filter((repo): repo is WatchedRepoRef => Boolean(repo)),
)

const receiveRepoWatchEvent = (event: TrustedEvent, relay: string) => {
  repository.publish(event)
  if (!tracker.hasRelay(event.id, relay)) tracker.addRelay(event.id, relay)
  receiveRepositoryCacheEvent(event, relay)
}

export const createBoundedRepoWatchHistoryLoader = ({
  request: requestHistory,
  onEvent,
}: {
  request: (options: RequestOptions) => Promise<unknown>
  onEvent: (event: TrustedEvent, relay: string) => void
}) => {
  const relayByEventId = new Map<string, string>()

  return createBoundedCommunityHistoryLoader({
    request: requestHistory,
    track: (eventId, relay) => relayByEventId.set(eventId, relay),
    publish: event => {
      onEvent(event, relayByEventId.get(event.id) || "")
      relayByEventId.delete(event.id)
    },
  })
}

const baseRelays = derived(pubkey, getBaseRelays)

const repoWatchLiveLocalFilters = new Map<object, Map<string, Filter[]>>()

const setRepoWatchLiveLocalFilters = (source: object, relay: string, filters: Filter[]) => {
  const filtersByRelay = repoWatchLiveLocalFilters.get(source) || new Map<string, Filter[]>()
  repoWatchLiveLocalFilters.set(source, filtersByRelay)

  if (filters.length > 0) filtersByRelay.set(relay, filters)
  else filtersByRelay.delete(relay)

  if (filtersByRelay.size === 0) repoWatchLiveLocalFilters.delete(source)
}

const clearRepoWatchLiveLocalFilters = (source: object) => {
  repoWatchLiveLocalFilters.delete(source)
}

const receiveRepoWatchLiveEvent = (event: TrustedEvent, relay: string) => {
  const normalizedRelay = normalizeRelay(relay)
  const localFilters = Array.from(repoWatchLiveLocalFilters.values()).flatMap(
    filtersByRelay => filtersByRelay.get(normalizedRelay) || [],
  )

  if (localFilters.length > 0 && matchFilters(localFilters, event)) {
    receiveRepoWatchEvent(event, normalizedRelay)
  }
}

const repoWatchLiveCoordinator = createBackgroundLiveCoordinator({
  request,
  owner: "repo-watcher",
  onEvent: receiveRepoWatchLiveEvent,
  onError: (relay, error) => {
    console.warn(`[repo-watch-notifications] Failed to subscribe on ${relay}`, error)
  },
})

const loadBoundedRepoWatchHistory = createBoundedRepoWatchHistoryLoader({
  request,
  onEvent: receiveRepoWatchEvent,
})

const initialLoadedRepoWatchEvents = <T extends TrustedEvent>(): LoadedRepoWatchEvents<T> => ({
  events: [],
  loading: false,
  complete: false,
  saturated: false,
  completeRelays: new Set(),
  completeScopes: new Set(),
})

const deriveLoadedEventGroups = <T extends TrustedEvent>({
  groups,
  label,
}: {
  groups: Readable<RepoWatchRelayFilterGroup[]>
  label: string
}): Readable<LoadedRepoWatchEvents<T>> =>
  readable<LoadedRepoWatchEvents<T>>(initialLoadedRepoWatchEvents<T>(), set => {
    let filtersKey = ""
    let networkKey = ""
    let generation = 0
    let events: T[] = []
    let status: RepoWatchHistoryStatus = {
      loading: false,
      complete: false,
      saturated: false,
    }
    let completeRelays = new Set<string>()
    let completeScopes = new Set<string>()
    let completeGroupKeys = new Set<string>()
    const controllersByRelay = new Map<string, AbortController>()
    let unsubscribeEvents: (() => void) | undefined
    const liveSource = {}

    const emit = () => set({...status, events, completeRelays, completeScopes})

    const stopRelaySubscriptions = () => {
      generation += 1
      for (const controller of controllersByRelay.values()) {
        controller.abort()
      }
      controllersByRelay.clear()
      clearRepoWatchLiveLocalFilters(liveSource)
      repoWatchLiveCoordinator.clear(liveSource)
    }

    const getGroupKey = (group: RepoWatchRelayFilterGroup) =>
      JSON.stringify({...group, relay: normalizeRelay(group.relay)})

    const updateCompletion = (currentGroups: RepoWatchRelayFilterGroup[]) => {
      const completedGroups = currentGroups.filter(group =>
        completeGroupKeys.has(getGroupKey(group)),
      )
      completeRelays = new Set(completedGroups.map(group => normalizeRelay(group.relay)))
      completeScopes = new Set(
        completedGroups.map(group => `${group.scope || ""}:${normalizeRelay(group.relay)}`),
      )
      status = {
        loading: false,
        complete: currentGroups.length > 0 && completedGroups.length === currentGroups.length,
        saturated: false,
      }
    }

    const unsubscribe = derived([groups, notificationBackgroundEnabled], ([$groups, $enabled]) => ({
      groups: $groups,
      enabled: $enabled,
    })).subscribe(({groups, enabled}) => {
      const filters = dedupeFilters(groups.flatMap(group => group.localFilters))
      const nextFiltersKey = getFilterKey(filters)
      const nextNetworkKey = JSON.stringify({enabled, groups})
      if (nextNetworkKey === networkKey) return
      networkKey = nextNetworkKey
      const completionGroups = groups.filter(
        group => group.filters.length > 0 && group.localFilters.length > 0,
      )
      const validGroups = completionGroups.filter(group => {
        const url = normalizeRelay(group.relay)
        return Boolean(url)
      })
      const nextGroupKeys = new Set(completionGroups.map(getGroupKey))
      completeGroupKeys = new Set(
        Array.from(completeGroupKeys).filter(key => nextGroupKeys.has(key)),
      )
      stopRelaySubscriptions()
      updateCompletion(completionGroups)
      emit()

      if (nextFiltersKey !== filtersKey) {
        unsubscribeEvents?.()
        unsubscribeEvents = undefined
        filtersKey = nextFiltersKey

        if (filters.length > 0) {
          unsubscribeEvents = deriveEventsAsc(deriveEventsById({repository, filters})).subscribe(
            loadedEvents => {
              events = loadedEvents as T[]
              emit()
            },
          )
        } else {
          events = []
        }
      }

      if (filters.length === 0) {
        completeGroupKeys = new Set()
        status = {loading: false, complete: true, saturated: false}
        emit()
        return
      }

      if (!enabled) {
        completeGroupKeys = new Set()
        status = {loading: false, complete: false, saturated: false}
        emit()
        return
      }

      if (validGroups.length === 0) {
        status = {loading: false, complete: false, saturated: false}
        emit()
        return
      }

      const currentGeneration = generation
      const loads: Promise<{
        relay: string
        scopeKey: string
        groupKey: string
        result: BoundedCommunityHistoryResult
      }>[] = []
      const liveByRelay = new Map<string, {localFilters: Filter[]; liveFilters: Filter[]}>()

      for (const group of validGroups) {
        const url = normalizeRelay(group.relay)
        if (!url || group.liveFilters.length === 0) continue
        const relayLive = liveByRelay.get(url) || {localFilters: [], liveFilters: []}
        relayLive.localFilters.push(...group.localFilters)
        relayLive.liveFilters.push(...group.liveFilters)
        liveByRelay.set(url, relayLive)
      }

      for (const [relay, live] of liveByRelay) {
        setRepoWatchLiveLocalFilters(liveSource, relay, dedupeFilters(live.localFilters))
        repoWatchLiveCoordinator.set(liveSource, relay, dedupeFilters(live.liveFilters))
      }

      const loadGroups = validGroups.filter(group => !completeGroupKeys.has(getGroupKey(group)))
      for (const [index, group] of loadGroups.entries()) {
        const url = normalizeRelay(group.relay)
        if (!url || group.filters.length === 0 || group.localFilters.length === 0) continue
        const controller = new AbortController()
        controllersByRelay.set(`${group.scope || index}:${url}`, controller)
        loads.push(
          loadBoundedRepoWatchHistory({
            relays: [url],
            relayFilters: group.filters,
            localFilters: group.localFilters,
            signal: controller.signal,
            owner: repoWatchLiveCoordinator.owner,
            priority: RELAY_REQUEST_PRIORITY.background,
            pageSize: Math.max(
              1,
              ...group.filters.map(filter => filter.limit || REPO_WATCH_LOAD_LIMIT),
            ),
            maxPages: group.maxPages,
            timeoutMs: 5_000,
          }).then(result => {
            const acceptedResult =
              group.acceptSaturated &&
              result.saturated &&
              !result.timedOut &&
              !controller.signal.aborted
                ? {...result, complete: true, saturated: false}
                : result
            if (currentGeneration === generation) {
              if (acceptedResult.complete) completeGroupKeys.add(getGroupKey(group))
              else completeGroupKeys.delete(getGroupKey(group))
              updateCompletion(completionGroups)
              status.loading = loadGroups.some(
                candidate => !completeGroupKeys.has(getGroupKey(candidate)),
              )
              emit()
            }
            return {
              relay: url,
              scopeKey: `${group.scope || ""}:${url}`,
              groupKey: getGroupKey(group),
              result: acceptedResult,
            }
          }),
        )
      }

      if (loads.length === 0) {
        updateCompletion(completionGroups)
        emit()
        return
      }

      status = {loading: true, complete: false, saturated: false}
      emit()

      void Promise.allSettled(loads).then(results => {
        if (currentGeneration !== generation) return

        const fulfilled = results.flatMap(result =>
          result.status === "fulfilled" ? [result.value] : [],
        )
        for (const item of fulfilled) {
          if (item.result.complete) completeGroupKeys.add(item.groupKey)
          else completeGroupKeys.delete(item.groupKey)
        }
        updateCompletion(completionGroups)
        status.saturated = fulfilled.some(item => item.result.saturated)
        emit()

        for (const result of results) {
          if (result.status === "rejected") {
            console.warn(`[repo-watch-notifications] Failed to load ${label}`, result.reason)
          }
        }
      })
    })

    return () => {
      stopRelaySubscriptions()
      unsubscribeEvents?.()
      unsubscribe()
    }
  })

export const selectRepoWatchLoadRelays = (relays: string[], capRelays: boolean) => {
  const normalized = normalizeRelays(relays)
  return (
    capRelays ? normalized.slice(0, MAX_REPO_NOTIFICATION_RELAYS_PER_SOURCE) : normalized
  ).sort()
}

const deriveLoadedEvents = <T extends TrustedEvent>({
  filters,
  relays,
  label,
  currentOnly = false,
  capRelays = true,
}: {
  filters: Readable<Filter[]>
  relays: Readable<string[]>
  label: string
  currentOnly?: boolean
  capRelays?: boolean
}): Readable<LoadedRepoWatchEvents<T>> =>
  deriveLoadedEventGroups({
    groups: derived([filters, relays], ([$filters, $relays]) =>
      (selectRepoWatchLoadRelays($relays, capRelays).length > 0
        ? selectRepoWatchLoadRelays($relays, capRelays)
        : $filters.length > 0
          ? [""]
          : []
      ).map(relay => ({
        relay,
        filters: $filters,
        localFilters: $filters,
        liveFilters: relay ? $filters : [],
        ...(currentOnly ? {acceptSaturated: true, maxPages: 1} : {}),
      })),
    ),
    label,
  })

const watchedRepoAnnouncementFilters = derived(watchedRepoRefs, $repos =>
  $repos.map(repo => ({
    authors: [repo.pubkey],
    kinds: [GIT_REPO_ANNOUNCEMENT],
    "#d": [repo.identifier],
    limit: 1,
  })),
)

const watchedRepoAnnouncementLoad = deriveLoadedEvents<TrustedEvent>({
  filters: watchedRepoAnnouncementFilters,
  relays: baseRelays,
  label: "repo announcements",
  currentOnly: true,
})

const ownedRepoAnnouncementFilters = derived(pubkey, $pubkey =>
  $pubkey
    ? [
        {
          authors: [$pubkey],
          kinds: [GIT_REPO_ANNOUNCEMENT],
          limit: 100,
        },
      ]
    : [],
)

const ownedRepoAnnouncementLoad = deriveLoadedEvents<TrustedEvent>({
  filters: ownedRepoAnnouncementFilters,
  relays: baseRelays,
  label: "owned repo announcements",
})

const knownRepoAnnouncementEvents = derived(
  [repoAnnouncements, watchedRepoAnnouncementLoad, ownedRepoAnnouncementLoad],
  ([$repoAnnouncements, $watchedRepoAnnouncementLoad, $ownedRepoAnnouncementLoad]) =>
    Array.from(
      mapRepoEventsByAddress([
        ...($repoAnnouncements as TrustedEvent[]),
        ...$watchedRepoAnnouncementLoad.events,
        ...$ownedRepoAnnouncementLoad.events,
      ]).values(),
    ),
)

const notificationReposWithAnnouncements = derived(
  [pubkey, watchedRepoRefs, knownRepoAnnouncementEvents],
  ([$pubkey, $watchedRepos, $repoEvents]) =>
    getRepoNotificationRepos({
      watchedRepos: $watchedRepos,
      repoEvents: $repoEvents,
      currentPubkey: $pubkey || undefined,
    }).filter((repo): repo is RepoWatchNotificationRepo & {repoEvent: TrustedEvent} =>
      Boolean(repo.repoEvent),
    ),
)

const watchedRepoActivityRelays = derived(knownRepoAnnouncementEvents, $events => {
  const repoRelays = $events.flatMap(event => {
    try {
      return parseRepoAnnouncementEvent(event as RepoAnnouncementEvent).relays || []
    } catch {
      return []
    }
  })

  return normalizeRelays(repoRelays)
})

const watchedRepoCommunityRefs = derived(knownRepoAnnouncementEvents, $events => {
  const refs = new Map<string, string[]>()

  for (const event of $events) {
    try {
      const community = parseRepoAnnouncementEvent(event as RepoAnnouncementEvent).community
      if (!community?.address) continue

      const relays = refs.get(community.address) || []
      if (community.relay) relays.push(community.relay)
      refs.set(community.address, relays)
    } catch {
      continue
    }
  }

  return refs
})

const watchedRepoCommunityDefinitionSources = derived(knownRepoAnnouncementEvents, $events =>
  $events.flatMap(event => {
    try {
      const announcement = parseRepoAnnouncementEvent(event as RepoAnnouncementEvent)
      const community = announcement.community
      const pointer = community?.address
        ? parseCommunityDefinitionAddress(community.address)
        : undefined
      if (!pointer) return []

      return [
        {
          communityAddress: pointer.address,
          relays: normalizeRelays([...(announcement.relays || []), community?.relay]),
          filters: [
            {
              kinds: [COMMUNITY_DEFINITION_KIND],
              authors: [pointer.ownerPubkey],
              "#d": [pointer.communityId],
              limit: 1,
            },
          ],
        },
      ]
    } catch {
      return []
    }
  }),
)

const watchedRepoCommunityDefinitionLoad = deriveLoadedEventGroups<TrustedEvent>({
  groups: derived(watchedRepoCommunityDefinitionSources, $sources =>
    buildRepoWatchScopedFilterGroups($sources, true),
  ),
  label: "repo community definitions",
})

export const selectRepoWatchCommunityDefinitions = (
  events: TrustedEvent[],
  communityAddresses: Iterable<string>,
) => {
  const addresses = new Set(communityAddresses)
  const definitions = new Map<string, CommunityDefinition>()

  for (const event of events) {
    const definition = parseCommunityDefinition(event)
    if (!definition || !addresses.has(definition.pointer.address)) continue
    const current = definitions.get(definition.pointer.address)
    if (
      !current ||
      definition.event.created_at > current.event.created_at ||
      (definition.event.created_at === current.event.created_at &&
        definition.event.id < current.event.id)
    ) {
      definitions.set(definition.pointer.address, definition)
    }
  }

  return definitions
}

const watchedRepoCommunityDefinitions = derived(
  [watchedRepoCommunityRefs, watchedRepoCommunityDefinitionLoad],
  ([$refs, $load]) => selectRepoWatchCommunityDefinitions($load.events, $refs.keys()),
)

const watchedRepoCommunityProfileListSources = derived(
  [watchedRepoCommunityRefs, watchedRepoCommunityDefinitions],
  ([$refs, $definitions]) =>
    Array.from($definitions.values()).map(definition => ({
      communityAddress: definition.pointer.address,
      relays: normalizeRelays([
        ...($refs.get(definition.pointer.address) || []),
        ...definition.relays,
        ...definition.sections.flatMap(section =>
          section.profileLists.flatMap(profileList =>
            profileList.relay ? [profileList.relay] : [],
          ),
        ),
      ]),
      filters: makeCommunityProfileListFilters(definition),
    })),
)

const watchedRepoCommunityProfileListLoad = deriveLoadedEventGroups<TrustedEvent>({
  groups: derived(watchedRepoCommunityProfileListSources, $sources =>
    buildRepoWatchScopedFilterGroups($sources, true),
  ),
  label: "repo community profile lists",
})

const watchedRepoCommunityReportSources = derived(
  [watchedRepoCommunityRefs, watchedRepoCommunityDefinitions],
  ([$refs, $definitions]) =>
    Array.from($definitions.values()).map(definition => ({
      communityAddress: definition.pointer.address,
      relays: normalizeRelays([
        ...($refs.get(definition.pointer.address) || []),
        ...definition.relays,
      ]),
      filters: makeCommunityReportFilters(definition.pointer),
    })),
)

const watchedRepoCommunityReportLoad = deriveLoadedEventGroups<TrustedEvent>({
  groups: derived(watchedRepoCommunityReportSources, $sources =>
    buildRepoWatchScopedFilterGroups($sources),
  ),
  label: "repo community reports",
})

const watchedRepoCommunityReportDeleteSources = derived(
  [watchedRepoCommunityReportSources, watchedRepoCommunityReportLoad],
  ([$sources, $load]) =>
    $sources.map(source => ({
      communityAddress: source.communityAddress,
      relays: source.relays,
      filters: makeSameAuthorDeleteFilters(
        $load.events.filter(event => matchFilters(source.filters, event)),
      ),
    })),
)

const watchedRepoCommunityReportDeleteLoad = deriveLoadedEventGroups<TrustedEvent>({
  groups: derived(watchedRepoCommunityReportDeleteSources, $sources =>
    buildRepoWatchScopedFilterGroups($sources),
  ),
  label: "repo community report deletes",
})

const getDefinitionProfileListEvents = (
  definition: CommunityDefinition,
  events: TrustedEvent[],
) => {
  const filters = makeCommunityProfileListFilters(definition)
  return filters.length > 0 ? events.filter(event => matchFilters(filters, event)) : []
}

export const isRepoWatchCommunitySourceComplete = (
  communityAddress: string,
  sources: RepoWatchScopedFilterSource[],
  completeScopes: Set<string>,
) => {
  const communitySources = sources.filter(source => source.communityAddress === communityAddress)
  if (communitySources.length === 0) return false

  return communitySources.every(source => {
    if (source.filters.length === 0) return true
    const relays = normalizeRelays(source.relays)
    return (
      relays.length > 0 && relays.every(relay => completeScopes.has(`${communityAddress}:${relay}`))
    )
  })
}

export const watchedRepoCommunityContexts: Readable<Map<string, RepoWatchCommunityContext>> =
  derived(
    [
      watchedRepoCommunityDefinitions,
      watchedRepoCommunityDefinitionSources,
      watchedRepoCommunityDefinitionLoad,
      watchedRepoCommunityProfileListSources,
      watchedRepoCommunityProfileListLoad,
      watchedRepoCommunityReportSources,
      watchedRepoCommunityReportLoad,
      watchedRepoCommunityReportDeleteSources,
      watchedRepoCommunityReportDeleteLoad,
    ],
    ([
      $definitions,
      $definitionSources,
      $definitionLoad,
      $profileListSources,
      $profileListLoad,
      $reportSources,
      $reportLoad,
      $reportDeleteSources,
      $reportDeleteLoad,
    ]) => {
      const contexts = new Map<string, RepoWatchCommunityContext>()

      for (const definition of $definitions.values()) {
        const communityAddress = definition.pointer.address
        const profileListEvents = getDefinitionProfileListEvents(
          definition,
          $profileListLoad.events,
        )
        const reportState = getEffectiveCommunityReportState({
          community: definition.pointer,
          definition,
          profileListEvents,
          reportEvents: $reportLoad.events,
          deleteEvents: $reportDeleteLoad.events,
        })

        contexts.set(communityAddress, {
          definition,
          profileListEvents,
          reportState,
          ready: Boolean(
            isRepoWatchCommunitySourceComplete(
              communityAddress,
              $definitionSources,
              $definitionLoad.completeScopes,
            ) &&
            isRepoWatchCommunitySourceComplete(
              communityAddress,
              $profileListSources,
              $profileListLoad.completeScopes,
            ) &&
            isRepoWatchCommunitySourceComplete(
              communityAddress,
              $reportSources,
              $reportLoad.completeScopes,
            ) &&
            isRepoWatchCommunitySourceComplete(
              communityAddress,
              $reportDeleteSources,
              $reportDeleteLoad.completeScopes,
            ),
          ),
        })
      }

      return contexts
    },
  )

const getRepoCommunityId = (repo: RepoWatchNotificationRepo) => {
  try {
    return repo.repoEvent
      ? parseRepoAnnouncementEvent(repo.repoEvent as RepoAnnouncementEvent).community
          ?.communityId || ""
      : ""
  } catch {
    return ""
  }
}

const getRepoCommunityAddress = (
  repo: RepoWatchNotificationRepo,
  contexts: Map<string, RepoWatchCommunityContext>,
) => {
  if (repo.communityAddress) return repo.communityAddress
  const communityId = getRepoCommunityId(repo)
  if (!communityId) return ""

  return (
    Array.from(contexts.entries()).find(
      ([, context]) => context.definition?.communityId === communityId,
    )?.[0] || ""
  )
}

const getRepoWatchActivityAuthors = (
  repo: RepoWatchNotificationRepo,
  contexts: Map<string, RepoWatchCommunityContext>,
) => {
  if (repo.options.activityFilter === "all") return undefined

  const authors = new Set<string>()
  if (
    repo.options.activityFilter === "maintainers" ||
    repo.options.activityFilter === "maintainers-community"
  ) {
    for (const maintainer of getRepoMaintainerSet(repo)) authors.add(maintainer)
  }

  if (
    repo.options.activityFilter === "community" ||
    repo.options.activityFilter === "maintainers-community"
  ) {
    const context = contexts.get(getRepoCommunityAddress(repo, contexts))
    if (context?.ready && context.definition && context.reportState) {
      for (const writer of getCommunityTargetWriterPubkeys({
        definition: context.definition,
        profileListEvents: context.profileListEvents,
        target: COMMUNITY_WRITE_TARGETS.repository,
        reportState: context.reportState,
      })) {
        authors.add(writer)
      }
    }
  }

  return Array.from(authors).sort()
}

const watchedRepoActivityTargets = derived(
  [
    notificationReposWithAnnouncements,
    watchedRepoCommunityContexts,
    checked,
    repoWatchNotificationSeen,
    notificationHistorySince,
    notificationHistoryFilterLimit,
  ],
  ([
    $repos,
    $communityContexts,
    $checked,
    $notificationSeen,
    $notificationHistorySince,
    $notificationHistoryFilterLimit,
  ]) => {
    return $repos.flatMap(repo => {
      const authors = getRepoWatchActivityAuthors(repo, $communityContexts)
      if (authors?.length === 0) return []

      return [
        {
          address: repo.address,
          relays: getRepoEventRelays(repo),
          since: getHistoryBoundedSince(
            getRepoWatchSeenAt(repo, $checked, $notificationSeen),
            $notificationHistorySince,
          ),
          limit: Math.max(REPO_WATCH_LOAD_LIMIT, $notificationHistoryFilterLimit),
          authors,
        },
      ]
    })
  },
)

const watchedRepoActivityGroups = derived(
  [watchedRepoActivityTargets, repoLiveOwnership],
  ([$targets, $ownership]) => buildRepoWatchActivityRelayGroups($targets, $ownership),
)

const watchedRepoActivityLoad = deriveLoadedEventGroups<TrustedEvent>({
  groups: watchedRepoActivityGroups,
  label: "repo activity",
})

const watchedRepoRootScopedTargets = derived(
  [
    watchedRepoActivityLoad,
    notificationReposWithAnnouncements,
    watchedRepoCommunityContexts,
    checked,
    repoWatchNotificationSeen,
    notificationHistorySince,
    notificationHistoryFilterLimit,
  ],
  ([
    $activityLoad,
    $repos,
    $communityContexts,
    $checked,
    $notificationSeen,
    $notificationHistorySince,
    $notificationHistoryFilterLimit,
  ]) => {
    const limit = Math.max(REPO_WATCH_LOAD_LIMIT, $notificationHistoryFilterLimit)
    const rootIdsByAddress = new Map<string, string[]>()

    for (const event of $activityLoad.events) {
      const address = getRepoAddress(event)
      if (!address) continue
      const rootIds = rootIdsByAddress.get(address) || []
      rootIds.push(...getRepoWatchRootIdsForEvent(event))
      rootIdsByAddress.set(address, rootIds)
    }

    return $repos.flatMap(repo => {
      const authors = getRepoWatchActivityAuthors(repo, $communityContexts)
      const rootIds = Array.from(new Set(rootIdsByAddress.get(repo.address) || [])).sort()
      if (authors?.length === 0 || rootIds.length === 0) return []

      return [
        {
          address: repo.address,
          relays: getRepoEventRelays(repo),
          since: getHistoryBoundedSince(
            getRepoWatchSeenAt(repo, $checked, $notificationSeen),
            $notificationHistorySince,
          ),
          limit,
          rootIds,
          authors,
        },
      ]
    })
  },
)

const watchedRepoRootScopedGroups = derived(
  [watchedRepoRootScopedTargets, repoLiveOwnership],
  ([$targets, $ownership]) => buildRepoWatchRootRelayGroups($targets, $ownership),
)

const watchedRepoRootScopedLoad = deriveLoadedEventGroups<TrustedEvent>({
  groups: watchedRepoRootScopedGroups,
  label: "repo root activity",
})

export const aggregateRepoWatchHistoryStatus = (
  loads: RepoWatchHistoryStatus[],
): RepoWatchHistoryStatus => ({
  loading: loads.some(load => load.loading),
  complete: loads.every(load => load.complete),
  saturated: loads.some(load => load.saturated),
})

export const repoWatchNotificationHistoryStatus: Readable<RepoWatchHistoryStatus> = derived(
  [
    watchedRepoAnnouncementLoad,
    ownedRepoAnnouncementLoad,
    watchedRepoCommunityDefinitionLoad,
    watchedRepoCommunityProfileListLoad,
    watchedRepoCommunityReportLoad,
    watchedRepoCommunityReportDeleteLoad,
    watchedRepoActivityLoad,
    watchedRepoRootScopedLoad,
  ],
  aggregateRepoWatchHistoryStatus,
)

export const repoWatchNotificationCandidates = derived(
  [
    pubkey,
    notificationReposWithAnnouncements,
    watchedRepoActivityLoad,
    watchedRepoRootScopedLoad,
    watchedRepoCommunityContexts,
  ],
  ([$pubkey, $repos, $activityLoad, $rootScopedLoad, $communityContexts]) => {
    const repos = $repos.map(repo => {
      const communityContext = $communityContexts.get(
        getRepoCommunityAddress(repo, $communityContexts),
      )

      return {
        ...repo,
        communityAddress: communityContext?.definition?.pointer.address,
        communityDefinition: communityContext?.ready ? communityContext.definition : undefined,
        communityReportState: communityContext?.ready ? communityContext.reportState : undefined,
        communityProfileListEvents: communityContext?.ready
          ? communityContext.profileListEvents
          : [],
      }
    })

    const events = dedupeEvents([...$activityLoad.events, ...$rootScopedLoad.events])

    return getRepoWatchNotificationCandidates({
      repos,
      currentPubkey: $pubkey || undefined,
      issues: events.filter(event => event.kind === GIT_ISSUE),
      pullRequests: events.filter(event => event.kind === GIT_PULL_REQUEST),
      pullRequestUpdates: events.filter(event => event.kind === GIT_PULL_REQUEST_UPDATE),
      statuses: events.filter(event => statusKinds.includes(event.kind)),
      comments: events.filter(event => event.kind === GIT_COMMENT),
      labels: events.filter(event => event.kind === GIT_LABEL),
    })
  },
)

const repoWatchNotificationPaths = derived(
  [
    pubkey,
    checked,
    repoWatchNotificationSeen,
    effectiveCommunityNotificationBaselines,
    repoWatchNotificationCandidates,
  ],
  ([
    $pubkey,
    $checked,
    $notificationSeen,
    $effectiveCommunityNotificationBaselines,
    $candidates,
  ]) => {
    const paths = new Set<string>()
    const mergedChecked = mergeCheckedState($checked, $notificationSeen)

    for (const candidate of $candidates) {
      if (
        hasNotificationForPath({
          path: candidate.path,
          latestEvent: candidate.latestEvent,
          currentPubkey: $pubkey || undefined,
          checked: mergedChecked,
          communityBaselines: $effectiveCommunityNotificationBaselines,
        })
      ) {
        paths.add(candidate.path)
      }
    }

    return paths
  },
)

export const setupRepoWatchNotifications = () => {
  const unsubscribe = repoWatchNotificationPaths.subscribe(repoPaths => {
    setNotificationsConfig({
      augmentPaths: paths => {
        if (repoPaths.size === 0) return paths

        const next = new Set(paths)
        for (const path of repoPaths) next.add(path)

        return next
      },
    })
  })

  return () => {
    unsubscribe()
    setNotificationsConfig({})
  }
}
