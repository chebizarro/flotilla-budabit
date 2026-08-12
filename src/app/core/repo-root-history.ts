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
