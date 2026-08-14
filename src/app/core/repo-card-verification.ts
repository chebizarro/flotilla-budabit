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
    plans.push({...target, address, maintainers})
  }

  const relays = normalizeRelays(plans.flatMap(plan => plan.relays))
  const pullRequestFilters = plans
    .filter(plan => plan.maintainers.length > 0)
    .map(
      plan =>
        ({
          kinds: [GIT_PULL_REQUEST],
          authors: plan.maintainers,
          "#a": [plan.address],
          limit: REPO_CARD_VERIFICATION_MAX_PRS_PER_REPO,
        }) satisfies Filter,
    )

  return {plans, relays, pullRequestFilters}
}

export const loadRepoCardVerification = async (
  targets: RepoCardVerificationTarget[],
  signal?: AbortSignal,
  dependencies: VerificationDependencies = {},
): Promise<RepoCardVerificationResult> => {
  const {plans, relays, pullRequestFilters} = buildRepoCardVerificationPlan(targets)
  const verifiedByAddress = new Map(plans.map(plan => [plan.address, new Set<string>()]))
  if (plans.length === 0 || pullRequestFilters.length === 0) {
    return {verifiedByAddress, completion: "complete"}
  }

  const getCachedEvents =
    dependencies.getCachedEvents ||
    ((filters: Filter[]) => repository.query(filters as any, {shouldSort: false}) as TrustedEvent[])
  const fetchEvents = dependencies.fetchEvents || fetchRelayEventsWithTimeout
  let partial = relays.length === 0
  const cachedPullRequests = getCachedEvents(pullRequestFilters) as PullRequestEvent[]
  let fetchedPullRequests: PullRequestEvent[] = []

  if (relays.length > 0 && !signal?.aborted) {
    try {
      fetchedPullRequests = await fetchEvents<PullRequestEvent>({
        relays,
        filters: pullRequestFilters,
        timeoutMs: REPO_CARD_VERIFICATION_TIMEOUT_MS,
        signal,
        isolated: true,
        maxEvents: REPO_CARD_VERIFICATION_MAX_EVENTS,
        onOutcome: outcome => {
          partial ||= outcome.timedOut || outcome.capped || !outcome.sawEose
        },
      })
    } catch {
      if (signal?.aborted) throw new DOMException("Operation aborted", "AbortError")
      partial = true
    }
  }

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

  const statusFilters = plans.flatMap(plan =>
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
  const cachedStatuses = statusFilters.length
    ? (getCachedEvents(statusFilters) as StatusEvent[])
    : []
  let fetchedStatuses: StatusEvent[] = []

  if (statusFilters.length > 0 && relays.length > 0 && !signal?.aborted) {
    try {
      fetchedStatuses = await fetchEvents<StatusEvent>({
        relays,
        filters: statusFilters,
        timeoutMs: REPO_CARD_VERIFICATION_TIMEOUT_MS,
        signal,
        isolated: true,
        maxEvents: REPO_CARD_VERIFICATION_MAX_EVENTS,
        onOutcome: outcome => {
          partial ||= outcome.timedOut || outcome.capped || !outcome.sawEose
        },
      })
    } catch {
      if (signal?.aborted) throw new DOMException("Operation aborted", "AbortError")
      partial = true
    }
  }

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
