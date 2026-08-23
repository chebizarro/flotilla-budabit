import {repository} from "@welshman/app"
import {isRelayUrl, normalizeRelayUrl, type Filter, type TrustedEvent} from "@welshman/util"
import {
  GIT_PULL_REQUEST,
  GIT_STATUS_APPLIED,
  type PullRequestEvent,
  type RepoAnnouncementEvent,
  type StatusEvent,
} from "@nostr-git/core/events"
import {getRepoDeclaredMaintainers} from "@app/core/repo-authority"
import {
  getVerifiedRepoMaintainers,
  groupStatusEventsByRoot,
} from "@app/core/repo-maintainer-verification"
import {getRepoAddressFromEvent} from "@app/util/bookmarks"
import {fetchRelayEventsWithTimeout} from "@app/util/fetch-relay-events"

export const REPO_CARD_VERIFICATION_MAX_REPOS = 18
export const REPO_CARD_VERIFICATION_MAX_RELAYS = 6
export const REPO_CARD_VERIFICATION_MAX_PRS_PER_REPO = 24
export const REPO_CARD_VERIFICATION_MAX_EVENTS = 432
export const REPO_CARD_VERIFICATION_TIMEOUT_MS = 2_500
export const REPO_CARD_VERIFICATION_CONCURRENCY = 3
const FILTER_CHUNK_SIZE = 80

export type RepoCardVerificationTarget = {
  event: RepoAnnouncementEvent
  relays: string[]
}

export type RepoCardVerificationResult = {
  verifiedByAddress: Map<string, Set<string>>
  completion: "complete" | "partial"
}

type VerificationTargetPlan = RepoCardVerificationTarget & {
  address: string
  maintainers: string[]
}

type VerificationRelayGroup = {
  relays: string[]
  plans: VerificationTargetPlan[]
  pullRequestFilters: Filter[]
}

type VerificationDependencies = {
  getCachedEvents?: (filters: Filter[]) => TrustedEvent[]
  fetchEvents?: typeof fetchRelayEventsWithTimeout
}

const normalizeRelays = (relays: string[]) => {
  const normalized = new Set<string>()

  for (const relay of relays) {
    try {
      const value = normalizeRelayUrl(relay)
      if (isRelayUrl(value)) normalized.add(value)
    } catch {
      // Ignore malformed hints from repository announcements.
    }
  }

  return Array.from(normalized).slice(0, REPO_CARD_VERIFICATION_MAX_RELAYS)
}

const chunk = <T>(items: T[], size = FILTER_CHUNK_SIZE) => {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

const dedupeEvents = <T extends TrustedEvent>(events: T[]) =>
  Array.from(new Map(events.map(event => [event.id, event])).values())

const hasAddress = (event: TrustedEvent, address: string) =>
  event.tags.some(tag => tag[0] === "a" && tag[1] === address)

export const buildRepoCardVerificationPlan = (targets: RepoCardVerificationTarget[]) => {
  const plans: VerificationTargetPlan[] = []
  const seenAddresses = new Set<string>()

  for (const target of targets.slice(0, REPO_CARD_VERIFICATION_MAX_REPOS)) {
    const address = getRepoAddressFromEvent(target.event)
    if (!address || seenAddresses.has(address)) continue
    seenAddresses.add(address)

    const maintainers = getRepoDeclaredMaintainers(target.event)
    if (maintainers.length === 0) continue
    plans.push({...target, relays: normalizeRelays(target.relays), address, maintainers})
  }

  const groupsByRelayKey = new Map<string, VerificationRelayGroup>()
  for (const plan of plans) {
    const key = plan.relays.join("\n")
    const group = groupsByRelayKey.get(key) || {
      relays: plan.relays,
      plans: [],
      pullRequestFilters: [],
    }
    group.plans.push(plan)
    group.pullRequestFilters.push({
      kinds: [GIT_PULL_REQUEST],
      authors: plan.maintainers,
      "#a": [plan.address],
      limit: REPO_CARD_VERIFICATION_MAX_PRS_PER_REPO,
    } satisfies Filter)
    groupsByRelayKey.set(key, group)
  }

  return {plans, groups: Array.from(groupsByRelayKey.values())}
}

const makeStatusFilters = (
  plans: VerificationTargetPlan[],
  pullRequestsByAddress: Map<string, PullRequestEvent[]>,
) =>
  plans.flatMap(plan =>
    chunk((pullRequestsByAddress.get(plan.address) || []).map(event => event.id)).map(
      rootIds =>
        ({
          kinds: [GIT_STATUS_APPLIED],
          authors: [plan.event.pubkey],
          "#e": rootIds,
          limit: rootIds.length,
        }) satisfies Filter,
    ),
  )

const getGroupEventLimit = (group: VerificationRelayGroup) =>
  Math.min(
    REPO_CARD_VERIFICATION_MAX_EVENTS,
    group.plans.length * REPO_CARD_VERIFICATION_MAX_PRS_PER_REPO,
  )

const mapGroups = async <T>(
  groups: VerificationRelayGroup[],
  loadGroup: (group: VerificationRelayGroup) => Promise<T[]>,
) => {
  const results: T[][] = []
  let nextGroup = 0
  const worker = async () => {
    while (true) {
      const index = nextGroup++
      const group = groups[index]
      if (!group) return
      results[index] = await loadGroup(group)
    }
  }
  await Promise.all(
    Array.from({length: Math.min(REPO_CARD_VERIFICATION_CONCURRENCY, groups.length)}, () =>
      worker(),
    ),
  )
  return results.flat()
}

export const loadRepoCardVerification = async (
  targets: RepoCardVerificationTarget[],
  signal?: AbortSignal,
  dependencies: VerificationDependencies = {},
): Promise<RepoCardVerificationResult> => {
  const {plans, groups} = buildRepoCardVerificationPlan(targets)
  const verifiedByAddress = new Map(plans.map(plan => [plan.address, new Set<string>()]))
  if (plans.length === 0) return {verifiedByAddress, completion: "complete"}

  const getCachedEvents =
    dependencies.getCachedEvents ||
    ((filters: Filter[]) => repository.query(filters as any, {shouldSort: false}) as TrustedEvent[])
  const fetchEvents = dependencies.fetchEvents || fetchRelayEventsWithTimeout
  const pullRequestFilters = groups.flatMap(group => group.pullRequestFilters)
  const cachedPullRequests = getCachedEvents(pullRequestFilters) as PullRequestEvent[]
  let partial = groups.some(group => group.relays.length === 0)
  const fetchedPullRequests = await mapGroups<PullRequestEvent>(groups, async group => {
    if (group.relays.length === 0 || signal?.aborted) return []
    try {
      return await fetchEvents<PullRequestEvent>({
        relays: group.relays,
        filters: group.pullRequestFilters,
        timeoutMs: REPO_CARD_VERIFICATION_TIMEOUT_MS,
        signal,
        isolated: true,
        maxEvents: getGroupEventLimit(group),
        onOutcome: outcome => {
          partial ||= outcome.timedOut || outcome.capped || !outcome.sawEose
        },
      })
    } catch {
      if (signal?.aborted) throw new DOMException("Operation aborted", "AbortError")
      partial = true
      return []
    }
  })

  if (signal?.aborted) throw new DOMException("Operation aborted", "AbortError")

  const pullRequests = dedupeEvents([...cachedPullRequests, ...fetchedPullRequests]).filter(
    event =>
      event.kind === GIT_PULL_REQUEST &&
      plans.some(
        plan => plan.maintainers.includes(event.pubkey) && hasAddress(event, plan.address),
      ),
  ) as PullRequestEvent[]
  const pullRequestsByAddress = new Map<string, PullRequestEvent[]>()

  for (const plan of plans) {
    pullRequestsByAddress.set(
      plan.address,
      pullRequests
        .filter(event => hasAddress(event, plan.address) && plan.maintainers.includes(event.pubkey))
        .slice(0, REPO_CARD_VERIFICATION_MAX_PRS_PER_REPO),
    )
  }

  const statusFilters = makeStatusFilters(plans, pullRequestsByAddress)
  const cachedStatuses = statusFilters.length
    ? (getCachedEvents(statusFilters) as StatusEvent[])
    : []
  const fetchedStatuses = await mapGroups<StatusEvent>(groups, async group => {
    const filters = makeStatusFilters(group.plans, pullRequestsByAddress)
    if (filters.length === 0 || group.relays.length === 0 || signal?.aborted) return []
    try {
      return await fetchEvents<StatusEvent>({
        relays: group.relays,
        filters,
        timeoutMs: REPO_CARD_VERIFICATION_TIMEOUT_MS,
        signal,
        isolated: true,
        maxEvents: getGroupEventLimit(group),
        onOutcome: outcome => {
          partial ||= outcome.timedOut || outcome.capped || !outcome.sawEose
        },
      })
    } catch {
      if (signal?.aborted) throw new DOMException("Operation aborted", "AbortError")
      partial = true
      return []
    }
  })

  if (signal?.aborted) throw new DOMException("Operation aborted", "AbortError")

  const statusesByRoot = groupStatusEventsByRoot(
    dedupeEvents([...cachedStatuses, ...fetchedStatuses]).filter(
      event => event.kind === GIT_STATUS_APPLIED,
    ) as StatusEvent[],
  )

  for (const plan of plans) {
    verifiedByAddress.set(
      plan.address,
      getVerifiedRepoMaintainers({
        repoEvent: plan.event,
        pullRequests: pullRequestsByAddress.get(plan.address) || [],
        statusEventsByRoot: statusesByRoot,
      }),
    )
  }

  return {verifiedByAddress, completion: partial ? "partial" : "complete"}
}
