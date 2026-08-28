import type {Filter, TrustedEvent} from "@welshman/util"
import {
  requestFiniteRelay,
  type FiniteRelayRequestOptions,
  type FiniteRelayResult,
} from "./finite-relay-request"
import {
  GIT_DELETION_KINDS,
  GIT_DELETION_STATUS_KINDS,
  classifyGitDeleteEvent,
  mergePlannedDeleteTarget,
  sortPlannedDeleteTargets,
  validateGitDeletionRoot,
  type DeleteExclusionReason,
  type GitDeletionContext,
  type PlannedDeleteTarget,
} from "./git-deletion-policy"

export type DeleteInventoryRequestOutcome = {
  round: number
  chunk: number
  relay: string
  filters: Filter[]
  transport: FiniteRelayResult
  accepted: number
  foreign: number
  unsupported: number
}

export type DeleteInventoryOutcome = {
  targets: PlannedDeleteTarget[]
  requests: DeleteInventoryRequestOutcome[]
  excludedByKind: Record<number, number>
  excludedByReason: Partial<Record<DeleteExclusionReason, number>>
  complete: boolean
}

export type GitDeletionInventoryOptions = {
  context: GitDeletionContext
  relays: string[]
  timeoutMs: number
  maxEventsPerRequest: number
  maxFiltersPerRequest?: number
  maxIdsPerFilter?: number
  maxRounds?: number
  signal?: AbortSignal
  priority?: number
  owner?: string
  request?: (options: FiniteRelayRequestOptions) => Promise<FiniteRelayResult>
}

const SECONDARY_KINDS = [
  GIT_DELETION_KINDS.label,
  GIT_DELETION_KINDS.coverLetter,
  ...GIT_DELETION_STATUS_KINDS,
  GIT_DELETION_KINDS.pullRequestUpdate,
  GIT_DELETION_KINDS.comment,
]

const chunks = <T>(items: T[], size: number) => {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size)
    result.push(items.slice(index, index + size))
  return result
}

const rootFilters = (context: GitDeletionContext, maxIds: number): Filter[] => {
  if (context.rootType !== "repository") {
    return [
      {kinds: SECONDARY_KINDS, "#e": [context.root.id]},
      {
        kinds: [GIT_DELETION_KINDS.pullRequestUpdate, GIT_DELETION_KINDS.comment],
        "#E": [context.root.id],
      },
    ]
  }
  const addresses = Array.from(
    new Set([context.repositoryAddress, ...(context.repositoryAddresses || [])]),
  )
  const identifiers = addresses.map(address => address.slice(address.lastIndexOf(":") + 1))
  return [
    ...chunks(identifiers, maxIds).map(
      (identifiers): Filter => ({
        kinds: [GIT_DELETION_KINDS.repository, GIT_DELETION_KINDS.repositoryState],
        authors: [context.ownerPubkey],
        "#d": identifiers,
      }),
    ),
    ...chunks(addresses, maxIds).map(
      (addresses): Filter => ({
        kinds: [GIT_DELETION_KINDS.issue, GIT_DELETION_KINDS.pullRequest, ...SECONDARY_KINDS],
        "#a": addresses,
      }),
    ),
    ...chunks(addresses, maxIds).map(
      (addresses): Filter => ({kinds: [GIT_DELETION_KINDS.comment], "#q": addresses}),
    ),
  ]
}

const directFilters = (roots: TrustedEvent[], maxIds: number): Filter[] =>
  chunks(
    roots.map(root => root.id),
    maxIds,
  ).flatMap((ids): Filter[] => [
    {kinds: SECONDARY_KINDS, "#e": ids},
    {kinds: [GIT_DELETION_KINDS.pullRequestUpdate, GIT_DELETION_KINDS.comment], "#E": ids},
  ])

const reactionFilters = (targets: PlannedDeleteTarget[], owner: string, maxIds: number): Filter[] =>
  chunks(
    targets.map(target => target.event.id),
    maxIds,
  ).map(ids => ({
    kinds: [GIT_DELETION_KINDS.reaction],
    authors: [owner],
    "#e": ids,
  }))

export const inventoryGitDeletion = async (
  options: GitDeletionInventoryOptions,
): Promise<DeleteInventoryOutcome> => {
  const maxFilters = options.maxFiltersPerRequest ?? 8
  const maxIds = options.maxIdsPerFilter ?? 100
  const maxRounds = options.maxRounds ?? 3
  const policyRounds = options.context.rootType === "repository" ? 3 : 2
  if (
    !Number.isInteger(maxFilters) ||
    maxFilters <= 0 ||
    !Number.isInteger(maxIds) ||
    maxIds <= 0
  ) {
    throw new Error("Deletion inventory chunk limits must be positive integers")
  }
  if (!Number.isInteger(maxRounds) || maxRounds <= 0 || maxRounds > 3) {
    throw new Error("Deletion inventory supports between one and three rounds")
  }
  if (options.relays.length === 0) throw new Error("Deletion inventory requires at least one relay")
  const invalidRoot = validateGitDeletionRoot(options.context)
  if (invalidRoot) throw new Error(`Invalid deletion root: ${invalidRoot}`)

  const requester = options.request || requestFiniteRelay
  const targetMap = new Map<PlannedDeleteTarget["key"], PlannedDeleteTarget>()
  const rootClassification = classifyGitDeleteEvent(options.context, options.context.root, 0)
  if (rootClassification.disposition !== "included")
    throw new Error("Deletion root could not be classified")
  mergePlannedDeleteTarget(targetMap, rootClassification.target)

  const requests: DeleteInventoryRequestOutcome[] = []
  const excludedByKind: Record<number, number> = {}
  const excludedByReason: Partial<Record<DeleteExclusionReason, number>> = {}
  const excludedIds = new Set<string>()

  const runRound = async (round: number, filters: Filter[], context: GitDeletionContext) => {
    const filterChunks = chunks(filters, maxFilters)
    for (let chunk = 0; chunk < filterChunks.length; chunk++) {
      if (options.signal?.aborted) return
      const requestFilters = filterChunks[chunk]
      const results = await Promise.all(
        options.relays.map(relay =>
          requester({
            relay,
            filters: requestFilters,
            timeoutMs: options.timeoutMs,
            maxEvents: options.maxEventsPerRequest,
            signal: options.signal,
            priority: options.priority,
            owner: options.owner,
          }),
        ),
      )
      for (const transport of results) {
        let accepted = 0
        let foreign = 0
        let unsupported = 0
        const orderedEvents = [...transport.events].sort((left, right) => {
          const leftRoot =
            left.kind === GIT_DELETION_KINDS.issue || left.kind === GIT_DELETION_KINDS.pullRequest
          const rightRoot =
            right.kind === GIT_DELETION_KINDS.issue || right.kind === GIT_DELETION_KINDS.pullRequest
          return Number(rightRoot) - Number(leftRoot)
        })
        for (const event of orderedEvents) {
          const knownRoots = Array.from(targetMap.values())
            .filter(target => target.relation === "root" && target.event.id !== context.root.id)
            .map(target => target.event)
          const classification = classifyGitDeleteEvent(
            {...context, relatedRoots: knownRoots},
            event,
            round,
            transport.relay,
          )
          if (classification.disposition === "included") {
            accepted++
            mergePlannedDeleteTarget(targetMap, classification.target)
          } else {
            if (classification.disposition === "foreign") foreign++
            else unsupported++
            if (!excludedIds.has(event.id)) {
              excludedIds.add(event.id)
              excludedByKind[event.kind] = (excludedByKind[event.kind] || 0) + 1
              excludedByReason[classification.reason] =
                (excludedByReason[classification.reason] || 0) + 1
            }
          }
        }
        requests.push({
          round,
          chunk,
          relay: transport.relay,
          filters: requestFilters,
          transport,
          accepted,
          foreign,
          unsupported,
        })
      }
    }
  }

  if (maxRounds >= 1) await runRound(1, rootFilters(options.context, maxIds), options.context)

  const discoveredRoots = Array.from(targetMap.values())
    .filter(target => target.relation === "root" && target.event.id !== options.context.root.id)
    .map(target => target.event)
  if (maxRounds >= 2 && options.context.rootType === "repository" && discoveredRoots.length > 0) {
    await runRound(2, directFilters(discoveredRoots, maxIds), {
      ...options.context,
      relatedRoots: discoveredRoots,
    })
  }

  const reactionRound = options.context.rootType === "repository" ? 3 : 2
  if (maxRounds >= reactionRound && !options.signal?.aborted) {
    const current = Array.from(targetMap.values())
    const reactionTargets = new Map(current.map(target => [target.event.id, target.event.kind]))
    await runRound(reactionRound, reactionFilters(current, options.context.ownerPubkey, maxIds), {
      ...options.context,
      relatedRoots: discoveredRoots,
      reactionTargets,
    })
  }

  return {
    targets: sortPlannedDeleteTargets(targetMap.values()),
    requests,
    excludedByKind,
    excludedByReason,
    complete:
      !options.signal?.aborted &&
      maxRounds >= policyRounds &&
      requests.length > 0 &&
      requests.every(request => request.transport.outcome === "eose"),
  }
}
