import {
  COMMENT,
  DELETE,
  GIT_ISSUE,
  GIT_STATUS_CLOSED,
  GIT_STATUS_COMPLETE,
  GIT_STATUS_DRAFT,
  GIT_STATUS_OPEN,
  REPORT,
  type Filter,
  type TrustedEvent,
} from "@welshman/util"
import {GIT_LABEL, GIT_PULL_REQUEST, GIT_PULL_REQUEST_UPDATE} from "@nostr-git/core/events"
import {
  requestFiniteRelay,
  type FiniteRelayRequestOptions,
  type FiniteRelayResult,
} from "@app/core/finite-relay-request"
import {getRepoPublicationAddress} from "@app/core/repo-publication"

const GIT_COVER_LETTER = 1624
const STATUS_KINDS = [GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE]

export const DEFAULT_REPO_ROOT_PAGE_SIZE = 100
export const DEFAULT_REPO_ROOT_TIMEOUT_MS = 10_000
export const REPO_ROOT_CHUNK_SIZE = 100

export type RepoRootHistoryStatus = "idle" | "loading" | "complete" | "partial" | "failed"

export type RepoRootRelayState = {
  relay: string
  status: RepoRootHistoryStatus
  until?: number
  exhausted: boolean
  boundarySaturated: boolean
  eventCount: number
  outcome?: FiniteRelayResult["outcome"]
}

export type RepoRootHistorySnapshot = {
  status: RepoRootHistoryStatus
  relays: RepoRootRelayState[]
  hasOlder: boolean
  exhausted: boolean
}

export type RepoRootHistoryOptions = {
  relays: string[]
  addresses: string[]
  signal: AbortSignal
  pageSize?: number
  timeoutMs?: number
  priority: number
  onEvent: (event: TrustedEvent, relay: string) => void
  onState: (snapshot: RepoRootHistorySnapshot) => void
}

export type RepoRootHistoryDependencies = {
  requestFiniteRelay: (options: FiniteRelayRequestOptions) => Promise<FiniteRelayResult>
}

export type EnsureRepoRootStatus = "complete" | "partial" | "failed" | "unavailable" | "aborted"

export type EnsureRepoRootResult = {
  status: EnsureRepoRootStatus
  requestedId: string
  rootId?: string
  rootKind?: typeof GIT_ISSUE | typeof GIT_PULL_REQUEST
}

export type RepoRootResolverOptions = {
  getRelays: () => string[]
  getAddresses: () => string[]
  signal: AbortSignal
  priority: number
  getEvent: (id: string) => TrustedEvent | undefined
  isDeleted: (event: TrustedEvent) => boolean
  onEvent: (event: TrustedEvent, relay: string) => void
  loadGap: (rootId: string) => Promise<FiniteRelayResult[]>
  timeoutMs?: number
}

const chunkValues = (values: string[], size: number) => {
  const chunks: string[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

export const buildRepoRootPageFilter = ({
  addresses,
  pageSize,
  until,
}: {
  addresses: string[]
  pageSize: number
  until?: number
}): Filter => ({
  kinds: [GIT_ISSUE, GIT_PULL_REQUEST],
  "#a": addresses,
  limit: pageSize,
  ...(until === undefined ? {} : {until}),
})

export const buildRepoRootGapFilters = (rootIds: string[]): Filter[] =>
  chunkValues(Array.from(new Set(rootIds.filter(Boolean))).sort(), REPO_ROOT_CHUNK_SIZE).flatMap(
    roots =>
      [
        {kinds: [COMMENT], "#E": roots},
        {kinds: [COMMENT], "#e": roots},
        {kinds: [GIT_PULL_REQUEST_UPDATE], "#E": roots},
        {kinds: [GIT_LABEL, GIT_COVER_LETTER], "#e": roots},
        {kinds: [...STATUS_KINDS, REPORT], "#e": roots},
        {kinds: [DELETE], "#e": roots},
      ] as Filter[],
  )

const getPullRequestRootId = (event: TrustedEvent) =>
  event.tags.find(tag => tag[0] === "e" && tag[3] === "root")?.[1] ||
  event.tags.find(tag => tag[0] === "E")?.[1] ||
  event.tags.find(tag => tag[0] === "e")?.[1] ||
  ""

export const isAcceptedRepoRootEvent = (
  event: TrustedEvent,
  addresses: string[],
): event is TrustedEvent & {kind: typeof GIT_ISSUE | typeof GIT_PULL_REQUEST} => {
  if (event.kind !== GIT_ISSUE && event.kind !== GIT_PULL_REQUEST) return false

  try {
    const address = getRepoPublicationAddress(event)
    return Boolean(address && new Set(addresses).has(address))
  } catch {
    return false
  }
}

const isAcceptedRepoRootLookupEvent = (event: TrustedEvent, addresses: string[]) => {
  if (
    event.kind !== GIT_ISSUE &&
    event.kind !== GIT_PULL_REQUEST &&
    event.kind !== GIT_PULL_REQUEST_UPDATE
  ) {
    return false
  }

  try {
    const address = getRepoPublicationAddress(event)
    return Boolean(address && new Set(addresses).has(address))
  } catch {
    return false
  }
}

export const summarizeRepoRootResults = (
  results: FiniteRelayResult[],
  signal?: AbortSignal,
): EnsureRepoRootStatus => {
  if (
    signal?.aborted ||
    (results.length > 0 && results.every(result => result.outcome === "aborted"))
  ) {
    return "aborted"
  }
  if (results.length === 0 || results.every(result => result.outcome === "eose")) return "complete"
  if (results.every(result => result.outcome === "error")) return "failed"
  return "partial"
}

export const createRepoRootResolver =
  (dependencies: RepoRootHistoryDependencies) => (options: RepoRootResolverOptions) => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_REPO_ROOT_TIMEOUT_MS
    const inFlight = new Map<string, Promise<EnsureRepoRootResult>>()

    const requestExact = async (id: string, relays: string[], addresses: string[]) => {
      const results = await Promise.all(
        relays.map(relay =>
          dependencies.requestFiniteRelay({
            relay,
            filters: [{ids: [id], limit: 1}],
            signal: options.signal,
            timeoutMs,
            priority: options.priority,
            owner: "repo-roots:exact",
          }),
        ),
      )
      let accepted: TrustedEvent | undefined

      for (const result of results) {
        for (const event of result.events) {
          if (
            event.id !== id ||
            options.isDeleted(event) ||
            !isAcceptedRepoRootLookupEvent(event, addresses)
          ) {
            continue
          }
          accepted ||= event
          options.onEvent(event, result.relay)
        }
      }

      return {event: accepted, results}
    }

    const resolve = async (requestedId: string): Promise<EnsureRepoRootResult> => {
      if (options.signal.aborted) return {status: "aborted", requestedId}

      const relays = Array.from(new Set(options.getRelays().filter(Boolean)))
      const addresses = Array.from(new Set(options.getAddresses().filter(Boolean)))
      if (relays.length === 0 || addresses.length === 0) {
        return {status: "unavailable", requestedId}
      }

      const results: FiniteRelayResult[] = []
      let event = options.getEvent(requestedId)
      if (!event || options.isDeleted(event) || !isAcceptedRepoRootLookupEvent(event, addresses)) {
        const exact = await requestExact(requestedId, relays, addresses)
        event = exact.event
        results.push(...exact.results)
      }

      if (options.signal.aborted) return {status: "aborted", requestedId}
      if (!event) return {status: summarizeRepoRootResults(results, options.signal), requestedId}

      let root = event
      if (event.kind === GIT_PULL_REQUEST_UPDATE) {
        const rootId = getPullRequestRootId(event)
        if (!rootId || rootId === event.id) {
          return {status: summarizeRepoRootResults(results, options.signal), requestedId}
        }

        const cachedRoot = options.getEvent(rootId)
        if (
          cachedRoot &&
          !options.isDeleted(cachedRoot) &&
          isAcceptedRepoRootEvent(cachedRoot, addresses)
        ) {
          root = cachedRoot
        } else {
          const exactRoot = await requestExact(rootId, relays, addresses)
          results.push(...exactRoot.results)
          if (!exactRoot.event || !isAcceptedRepoRootEvent(exactRoot.event, addresses)) {
            return {status: summarizeRepoRootResults(results, options.signal), requestedId}
          }
          root = exactRoot.event
        }
      }

      if (!isAcceptedRepoRootEvent(root, addresses)) {
        return {status: summarizeRepoRootResults(results, options.signal), requestedId}
      }

      try {
        results.push(...(await options.loadGap(root.id)))
      } catch {
        return {
          status: options.signal.aborted ? "aborted" : "failed",
          requestedId,
          rootId: root.id,
          rootKind: root.kind,
        }
      }

      return {
        status: summarizeRepoRootResults(results, options.signal),
        requestedId,
        rootId: root.id,
        rootKind: root.kind,
      }
    }

    return (id: string): Promise<EnsureRepoRootResult> => {
      const requestedId = String(id || "").trim()
      if (!requestedId) {
        return Promise.resolve({status: "complete", requestedId} as EnsureRepoRootResult)
      }

      const pending = inFlight.get(requestedId)
      if (pending) return pending

      const promise = resolve(requestedId).finally(() => {
        if (inFlight.get(requestedId) === promise) inFlight.delete(requestedId)
      })
      inFlight.set(requestedId, promise)
      return promise
    }
  }

const getSnapshot = (states: Map<string, RepoRootRelayState>): RepoRootHistorySnapshot => {
  const relays = Array.from(states.values()).sort((left, right) =>
    left.relay.localeCompare(right.relay),
  )
  const loading = relays.some(state => state.status === "loading")
  const failed = relays.filter(state => state.status === "failed").length
  const partial = relays.some(
    state => state.status === "partial" || state.boundarySaturated || state.outcome !== "eose",
  )
  const exhausted = relays.length > 0 && relays.every(state => state.exhausted)

  return {
    status: loading
      ? "loading"
      : failed === relays.length && relays.length > 0
        ? "failed"
        : partial || failed > 0
          ? "partial"
          : relays.length > 0
            ? "complete"
            : "idle",
    relays,
    hasOlder: relays.some(state => !state.exhausted),
    exhausted,
  }
}

export const createRepoRootHistory =
  (dependencies: RepoRootHistoryDependencies) => (options: RepoRootHistoryOptions) => {
    const pageSize = options.pageSize ?? DEFAULT_REPO_ROOT_PAGE_SIZE
    const timeoutMs = options.timeoutMs ?? DEFAULT_REPO_ROOT_TIMEOUT_MS
    const states = new Map<string, RepoRootRelayState>(
      Array.from(new Set(options.relays), relay => [
        relay,
        {
          relay,
          status: "idle",
          exhausted: false,
          boundarySaturated: false,
          eventCount: 0,
        },
      ]),
    )
    let loading: Promise<void> | undefined

    const publish = () => options.onState(getSnapshot(states))

    const loadPage = async (initial: boolean) => {
      if (loading || options.signal.aborted) return loading

      loading = Promise.all(
        Array.from(states.values()).map(async state => {
          if (!initial && state.exhausted) return
          state.status = "loading"
          publish()

          const result = await dependencies.requestFiniteRelay({
            relay: state.relay,
            filters: [
              buildRepoRootPageFilter({
                addresses: options.addresses,
                pageSize,
                until: initial ? undefined : state.until,
              }),
            ],
            signal: options.signal,
            timeoutMs,
            priority: options.priority,
            owner: initial ? "repo-roots:recent" : "repo-roots:older",
            onEvent: options.onEvent,
          })
          state.outcome = result.outcome
          state.eventCount += result.events.length

          if (result.outcome !== "eose") {
            state.status = result.outcome === "error" ? "failed" : "partial"
            return
          }

          if (result.events.length === 0) {
            state.exhausted = true
            state.status = "complete"
            return
          }

          const oldest = Math.min(...result.events.map(event => event.created_at))
          const previousUntil = state.until
          state.until = oldest
          state.boundarySaturated = previousUntil === oldest && result.events.length >= pageSize
          state.exhausted = result.events.length < pageSize
          state.status = state.boundarySaturated ? "partial" : "complete"
        }),
      )
        .then(() => undefined)
        .finally(() => {
          loading = undefined
          publish()
        })

      return loading
    }

    publish()
    return {
      loadRecent: () => loadPage(true),
      loadOlder: () => loadPage(false),
      getSnapshot: () => getSnapshot(states),
    }
  }

export const createDefaultRepoRootHistory = createRepoRootHistory({requestFiniteRelay})
export const createDefaultRepoRootResolver = createRepoRootResolver({requestFiniteRelay})

export const loadRepoRootGap = async ({
  relays,
  rootIds,
  signal,
  priority,
  onEvent,
  timeoutMs = DEFAULT_REPO_ROOT_TIMEOUT_MS,
}: {
  relays: string[]
  rootIds: string[]
  signal: AbortSignal
  priority: number
  onEvent: (event: TrustedEvent, relay: string) => void
  timeoutMs?: number
}) => {
  const filters = buildRepoRootGapFilters(rootIds)
  if (filters.length === 0) return []

  return Promise.all(
    relays.map(relay =>
      requestFiniteRelay({
        relay,
        filters,
        signal,
        timeoutMs,
        priority,
        owner: "repo-roots:gap",
        onEvent,
      }),
    ),
  )
}
