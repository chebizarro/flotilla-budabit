import {
  getAddress,
  getTagValue,
  isReplaceable,
  normalizeRelayUrl,
  sanitizeRelayUrls,
  COMMENT,
  REACTION,
  type Filter,
  type TrustedEvent,
} from "@welshman/util"
import {nip19} from "nostr-tools"
import {
  GIT_COVER_LETTER,
  GIT_ISSUE,
  GIT_LABEL,
  GIT_PULL_REQUEST,
  GIT_PULL_REQUEST_UPDATE,
  GIT_REPO_ANNOUNCEMENT,
  GIT_REPO_STATE,
  GIT_STATUS_APPLIED,
  GIT_STATUS_CLOSED,
  GIT_STATUS_DRAFT,
  GIT_STATUS_OPEN,
} from "@nostr-git/core/events"
import {parseGraspRepoHttpUrl} from "@nostr-git/core/utils"

export type GraspRepoDeleteTarget = {
  relay: string
  ownerNpub: string
  identifier: string
}

export type GraspRepoDeleteRequest = {
  createdAt: number
  coordinate: string
  tags: string[][]
}

export type RepoDeleteKey = `e:${string}` | `a:${string}`

export type RepoDeleteTarget = {
  key: RepoDeleteKey
  kind: number
  createdAt: number
  policy: "required" | "best-effort"
}

export type RepoDeleteUnit = {
  id: string
  policy: "required" | "best-effort"
  category: "regular" | "address" | "repository-history" | "root"
  createdAt: number
  targets: RepoDeleteTarget[]
  tags: string[][]
  serializedBytes: number
}

export type RepoDeletePlan = {
  repoAddress: string
  identifiers: string[]
  excludedUnsafeKinds: number[]
  units: RepoDeleteUnit[]
}

export const DEFAULT_REPO_DELETE_MAX_TARGETS = 100
export const DEFAULT_REPO_DELETE_MAX_BYTES = 32 * 1024
export const UNSAFE_REPO_DELETE_KINDS = new Set([30410, 30411, 30412])

const MAX_FUTURE_EVENT_SKEW_SECONDS = 5 * 60

export const getGraspRepoDeleteTarget = ({
  cloneUrl,
  ownerPubkey,
  identifier,
  relayHints = [],
}: {
  cloneUrl: string
  ownerPubkey: string
  identifier: string
  relayHints?: string[]
}): GraspRepoDeleteTarget | null => {
  let parsed: ReturnType<typeof parseGraspRepoHttpUrl>
  try {
    parsed = parseGraspRepoHttpUrl(cloneUrl)
  } catch {
    return null
  }
  if (!parsed || !ownerPubkey || !identifier) return null

  let ownerNpub = ""
  try {
    ownerNpub = nip19.npubEncode(ownerPubkey)
  } catch {
    return null
  }

  if (parsed.ownerNpub !== ownerNpub || parsed.identifier !== identifier) return null

  const cloneBase = normalizeGraspBase(parsed.httpBase)
  if (!cloneBase) return null
  const matchedRelay = relayHints
    .map(normalizeGraspBase)
    .find(candidate => candidate?.http === cloneBase.http)
  if (relayHints.length > 0 && !matchedRelay) return null

  return {relay: matchedRelay?.ws || cloneBase.ws, ownerNpub, identifier}
}

const normalizeGraspBase = (value: string): {http: string; ws: string} | null => {
  try {
    const url = new URL(value)
    if (url.username || url.password) return null
    const secure = url.protocol === "https:" || url.protocol === "wss:"
    if (!secure && url.protocol !== "http:" && url.protocol !== "ws:") return null
    const path = url.pathname.replace(/\/+$/, "")
    const ws = normalizeRelayUrl(value.replace(/^https?:/i, secure ? "wss:" : "ws:"))
    return {
      http: `${secure ? "https" : "http"}://${url.host}${path}`,
      ws,
    }
  } catch {
    return null
  }
}

export const buildGraspRepoDeleteRequest = ({
  event,
  ownerPubkey,
  now = Math.floor(Date.now() / 1000),
}: {
  event: {kind: number; pubkey: string; created_at: number; tags: string[][]}
  ownerPubkey: string
  now?: number
}): GraspRepoDeleteRequest => {
  if (event.kind !== GIT_REPO_ANNOUNCEMENT) {
    throw new Error("GRASP repository deletion requires a repository announcement")
  }
  if (!ownerPubkey || event.pubkey !== ownerPubkey) {
    throw new Error("Only the repository announcement author can delete this GRASP repository")
  }

  const identifier = getTagValue("d", event.tags)
  if (!identifier) throw new Error("Repository announcement is missing its identifier")
  if (event.created_at > now + MAX_FUTURE_EVENT_SKEW_SECONDS) {
    throw new Error("Repository announcement timestamp is too far in the future")
  }

  const coordinate = `${GIT_REPO_ANNOUNCEMENT}:${event.pubkey}:${identifier}`
  return {
    createdAt: Math.max(now, event.created_at + 1),
    coordinate,
    tags: [
      ["a", coordinate],
      ["k", String(GIT_REPO_ANNOUNCEMENT)],
      ["repo", coordinate],
    ],
  }
}

export const buildRepoDeleteTags = (events: TrustedEvent[]): string[][] => {
  const tags: string[][] = []
  for (const event of events) {
    if (isReplaceable(event)) tags.push(["a", getAddress(event)])
    else tags.push(["e", event.id])
  }
  return tags
}

const parseOwnedRepoAddress = (address: string, ownerPubkey: string) => {
  const firstSeparator = address.indexOf(":")
  const secondSeparator = address.indexOf(":", firstSeparator + 1)
  if (firstSeparator < 1 || secondSeparator < 0) return null

  const kind = Number(address.slice(0, firstSeparator))
  const pubkey = address.slice(firstSeparator + 1, secondSeparator)
  const identifier = address.slice(secondSeparator + 1)
  if (kind !== GIT_REPO_ANNOUNCEMENT || pubkey !== ownerPubkey || !identifier) return null
  if (!/^[0-9a-f]{64}$/.test(pubkey)) return null

  return {identifier, address: `${GIT_REPO_ANNOUNCEMENT}:${pubkey}:${identifier}`}
}

export const getRepoDeleteIdentifiers = (
  ownerPubkey: string,
  repoAddresses: Iterable<string>,
): string[] => {
  const identifiers = new Set<string>()
  for (const address of repoAddresses) {
    const parsed = parseOwnedRepoAddress(address, ownerPubkey)
    if (parsed) identifiers.add(parsed.identifier)
  }
  return Array.from(identifiers).sort()
}

const getRepoDeleteTargetTag = (target: RepoDeleteTarget): string[] => {
  const [type, value] = [target.key.slice(0, 1), target.key.slice(2)]
  // The fourth field associates the target kind with this specific mixed-chunk target.
  return [type, value, "", String(target.kind)]
}

const getDeleteTemplateBytes = (createdAt: number, tags: string[][]) =>
  new TextEncoder().encode(
    JSON.stringify({
      id: "0".repeat(64),
      pubkey: "0".repeat(64),
      created_at: createdAt,
      kind: 5,
      tags,
      content: "",
      sig: "0".repeat(128),
    }),
  ).byteLength

const makeRepoDeleteUnit = ({
  id,
  policy,
  repoAddress,
  targets,
  now,
  category,
}: {
  id: string
  policy: RepoDeleteUnit["policy"]
  repoAddress: string
  targets: RepoDeleteTarget[]
  now: number
  category: RepoDeleteUnit["category"]
}): RepoDeleteUnit => {
  const createdAt = Math.max(now, ...targets.map(target => target.createdAt + 1))
  const tags = [["repo", repoAddress], ...targets.map(getRepoDeleteTargetTag)]
  return {
    id,
    policy,
    category,
    createdAt,
    targets,
    tags,
    serializedBytes: getDeleteTemplateBytes(createdAt, tags),
  }
}

export const buildRepoDeletePlan = ({
  root,
  events = [],
  classifiedEvents = [],
  repoAddresses = [],
  now = Math.floor(Date.now() / 1000),
  maxTargets = DEFAULT_REPO_DELETE_MAX_TARGETS,
  maxSerializedBytes = DEFAULT_REPO_DELETE_MAX_BYTES,
}: {
  root: TrustedEvent
  events?: TrustedEvent[]
  classifiedEvents?: TrustedEvent[]
  repoAddresses?: Iterable<string>
  now?: number
  maxTargets?: number
  maxSerializedBytes?: number
}): RepoDeletePlan => {
  if (!root) throw new Error("Repository deletion requires the supplied repository root")
  if (root.kind !== GIT_REPO_ANNOUNCEMENT || !/^[0-9a-f]{64}$/.test(root.pubkey)) {
    throw new Error("Repository deletion requires a valid repository announcement root")
  }
  if (!Number.isInteger(maxTargets) || maxTargets < 1 || maxSerializedBytes < 1) {
    throw new Error("Repository deletion chunk bounds must be positive")
  }

  const rootIdentifier = getTagValue("d", root.tags)
  if (!rootIdentifier) throw new Error("Repository announcement is missing its identifier")
  const rootAddress = `${GIT_REPO_ANNOUNCEMENT}:${root.pubkey}:${rootIdentifier}`
  const addresses = getRepoDeleteAddresses(repoAddresses, rootAddress)
  const identifiers = getRepoDeleteIdentifiers(root.pubkey, addresses)
  if (!identifiers.includes(rootIdentifier)) {
    throw new Error("Supplied repository root does not match a validated owner address")
  }

  const allowedAddresses = new Set(
    identifiers.map(identifier => `${GIT_REPO_ANNOUNCEMENT}:${root.pubkey}:${identifier}`),
  )
  const targets = new Map<RepoDeleteKey, RepoDeleteTarget>()
  const classifiedIds = new Set(classifiedEvents.map(event => event.id))
  const excludedUnsafeKinds = new Set<number>()
  let rootCreatedAt = root.created_at
  for (const event of events) {
    if (event.pubkey !== root.pubkey || event.id === root.id) continue
    if (UNSAFE_REPO_DELETE_KINDS.has(event.kind)) {
      excludedUnsafeKinds.add(event.kind)
      continue
    }

    let key: RepoDeleteKey
    if (isReplaceable(event)) {
      const identifier = getTagValue("d", event.tags)
      if (!identifier || !identifiers.includes(identifier)) continue
      if (![GIT_REPO_ANNOUNCEMENT, GIT_REPO_STATE].includes(event.kind)) continue
      const address = `${event.kind}:${event.pubkey}:${identifier}`
      key = `a:${address}`
      if (key === `a:${rootAddress}`) {
        rootCreatedAt = Math.max(rootCreatedAt, event.created_at)
        continue
      }
    } else {
      const eventRepoAddresses = event.tags
        .filter(tag => tag[0] === "a" || tag[0] === "q")
        .map(tag => tag[1])
      if (
        !event.id ||
        (!classifiedIds.has(event.id) &&
          !eventRepoAddresses.some(address => allowedAddresses.has(address)))
      )
        continue
      key = `e:${event.id}`
    }

    const previous = targets.get(key)
    if (!previous || previous.createdAt < event.created_at) {
      targets.set(key, {
        key,
        kind: event.kind,
        createdAt: event.created_at,
        policy: "best-effort",
      })
    }
  }

  const targetCategory = (target: RepoDeleteTarget): RepoDeleteUnit["category"] => {
    if (target.key.startsWith("e:")) return "regular"
    if (target.kind === GIT_REPO_ANNOUNCEMENT || target.kind === GIT_REPO_STATE)
      return "repository-history"
    return "address"
  }
  const categoryOrder: RepoDeleteUnit["category"][] = ["regular", "address", "repository-history"]
  const bestEffort = Array.from(targets.values()).sort((left, right) => {
    const category =
      categoryOrder.indexOf(targetCategory(left)) - categoryOrder.indexOf(targetCategory(right))
    return category || left.key.localeCompare(right.key)
  })
  const units: RepoDeleteUnit[] = []
  let chunk: RepoDeleteTarget[] = []
  let chunkCategory: RepoDeleteUnit["category"] | undefined
  const flush = () => {
    if (!chunk.length) return
    units.push(
      makeRepoDeleteUnit({
        id: `${chunkCategory}-${String(units.length).padStart(3, "0")}`,
        policy: "best-effort",
        category: chunkCategory as RepoDeleteUnit["category"],
        repoAddress: rootAddress,
        targets: chunk,
        now,
      }),
    )
    chunk = []
    chunkCategory = undefined
  }

  for (const target of bestEffort) {
    const category = targetCategory(target)
    if (chunkCategory && chunkCategory !== category) flush()
    chunkCategory = category
    const candidate = [...chunk, target]
    const unit = makeRepoDeleteUnit({
      id: "candidate",
      policy: "best-effort",
      category,
      repoAddress: rootAddress,
      targets: candidate,
      now,
    })
    if (candidate.length > maxTargets || unit.serializedBytes > maxSerializedBytes) {
      flush()
      const single = makeRepoDeleteUnit({
        id: "candidate",
        policy: "best-effort",
        category,
        repoAddress: rootAddress,
        targets: [target],
        now,
      })
      if (single.serializedBytes > maxSerializedBytes) {
        throw new Error(
          `Repository deletion target ${target.key} exceeds the serialized-byte bound`,
        )
      }
      chunk = [target]
    } else {
      chunk = candidate
    }
  }
  flush()

  const rootTarget: RepoDeleteTarget = {
    key: `a:${rootAddress}`,
    kind: root.kind,
    createdAt: rootCreatedAt,
    policy: "required",
  }
  const rootUnit = makeRepoDeleteUnit({
    id: "root-final",
    policy: "required",
    category: "root",
    repoAddress: rootAddress,
    targets: [rootTarget],
    now,
  })
  if (rootUnit.serializedBytes > maxSerializedBytes) {
    throw new Error("Repository deletion root exceeds the serialized-byte bound")
  }
  units.push(rootUnit)

  return {
    repoAddress: rootAddress,
    identifiers,
    excludedUnsafeKinds: Array.from(excludedUnsafeKinds).sort((a, b) => a - b),
    units,
  }
}

export type RepoDeleteRelayOutcome = {
  relay: string
  status: "accepted" | "readback" | "failed" | "timeout"
  detail?: string
}

export type RepoDeletePublishResult = {outcomes: RepoDeleteRelayOutcome[]}

export type RepoDeleteUnitResult = {
  unitId: string
  acknowledged: boolean
  outcomes: RepoDeleteRelayOutcome[]
}

export const createRetainedRepoDeleteOperation = <Signed>({
  plan,
  sign,
  publish,
  relays,
  getReadbackRelays,
  waitForReadback,
  onAcknowledged,
  onError,
}: {
  plan: RepoDeletePlan
  sign: (unit: RepoDeleteUnit, signal: AbortSignal) => Promise<Signed>
  relays: string[]
  publish: (
    signed: Signed,
    unit: RepoDeleteUnit,
    relays: string[],
    signal: AbortSignal,
  ) => Promise<RepoDeletePublishResult>
  getReadbackRelays?: (signed: Signed) => Iterable<string>
  waitForReadback?: (signed: Signed, relays: string[], signal: AbortSignal) => Promise<string[]>
  onAcknowledged?: (signed: Signed, unit: RepoDeleteUnit) => void
  onError?: (unit: RepoDeleteUnit, error: unknown) => void
}) => {
  const retained = new Map<string, Signed>()
  const acknowledged = new Set<string>()
  const outcomes = new Map<string, Map<string, RepoDeleteRelayOutcome>>()
  const committed = new Set<string>()
  let controller: AbortController | undefined

  const runUnits = async (units: RepoDeleteUnit[], signal?: AbortSignal) => {
    controller = new AbortController()
    const operationSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal
    for (const unit of units) {
      if (acknowledged.has(unit.id)) continue
      operationSignal.throwIfAborted()
      if (!retained.has(unit.id)) retained.set(unit.id, await sign(unit, operationSignal))
      const signed = retained.get(unit.id) as Signed
      const unitOutcomes = outcomes.get(unit.id) || new Map<string, RepoDeleteRelayOutcome>()
      outcomes.set(unit.id, unitOutcomes)
      for (const relay of getReadbackRelays?.(signed) || []) {
        if (relays.includes(relay)) unitOutcomes.set(relay, {relay, status: "readback"})
      }
      const pendingRelays = relays.filter(
        relay => !["accepted", "readback"].includes(unitOutcomes.get(relay)?.status || ""),
      )
      let result: RepoDeletePublishResult
      try {
        result = pendingRelays.length
          ? await publish(signed, unit, pendingRelays, operationSignal)
          : {outcomes: []}
      } catch (error) {
        if (operationSignal.aborted) throw error
        onError?.(unit, error)
        if (unit.policy === "required") break
        continue
      }
      for (const outcome of result.outcomes) {
        if (relays.includes(outcome.relay)) unitOutcomes.set(outcome.relay, outcome)
      }
      if (
        ![...unitOutcomes.values()].some(outcome =>
          ["accepted", "readback"].includes(outcome.status),
        )
      ) {
        const observed = await waitForReadback?.(signed, pendingRelays, operationSignal)
        for (const relay of observed || []) unitOutcomes.set(relay, {relay, status: "readback"})
      }
      const unitAcknowledged = [...unitOutcomes.values()].some(outcome =>
        ["accepted", "readback"].includes(outcome.status),
      )
      if (unitAcknowledged) {
        acknowledged.add(unit.id)
        if (!committed.has(unit.id)) {
          committed.add(unit.id)
          onAcknowledged?.(signed, unit)
        }
      } else if (unit.policy === "required") break
    }
    return {
      acknowledged: new Set(acknowledged),
      rootAcknowledged: acknowledged.has("root-final"),
      complete: plan.units.every(unit => acknowledged.has(unit.id)),
      units: plan.units.map(
        (unit): RepoDeleteUnitResult => ({
          unitId: unit.id,
          acknowledged: acknowledged.has(unit.id),
          outcomes: Array.from(outcomes.get(unit.id)?.values() || []),
        }),
      ),
    }
  }

  const run = (signal?: AbortSignal) => runUnits(plan.units, signal)
  const runBestEffort = (signal?: AbortSignal) =>
    runUnits(
      plan.units.filter(unit => unit.policy === "best-effort"),
      signal,
    )
  const runRoot = (signal?: AbortSignal) =>
    runUnits(
      plan.units.filter(unit => unit.policy === "required"),
      signal,
    )

  return {run, runBestEffort, runRoot, retry: run, cancel: () => controller?.abort()}
}

export const getMetadataDeleteRelays = ({
  relays,
  remoteTargets,
}: {
  relays: string[]
  remoteTargets: Array<{vendor: string; url: string; graspRelay?: string}>
}): string[] => {
  const graspRelayKeys = new Set<string>()
  for (const target of remoteTargets) {
    if (target.graspRelay) {
      const relay = sanitizeRelayUrls([target.graspRelay])[0]
      if (relay) graspRelayKeys.add(relay)
    }

    if (target.vendor === "grasp" || target.vendor === "grasp-rest") {
      const parsed = parseGraspRepoHttpUrl(target.url)
      const relay = parsed ? normalizeGraspBase(parsed.httpBase)?.ws : undefined
      if (relay) graspRelayKeys.add(relay)
    }
  }

  return sanitizeRelayUrls(relays).filter(relay => !graspRelayKeys.has(relay))
}

export const canDeleteLocalRepoAfterRemoteResults = ({
  inventoryError,
  inventoryAccepted = false,
  rootAcknowledged = false,
  selectedRemoteIds,
  remoteResults,
}: {
  inventoryError?: string
  inventoryAccepted?: boolean
  rootAcknowledged?: boolean
  selectedRemoteIds: Set<string>
  remoteResults: Array<{id: string; status: string}>
}): boolean =>
  !inventoryError &&
  inventoryAccepted &&
  rootAcknowledged &&
  remoteResults.every(
    result =>
      !selectedRemoteIds.has(result.id) ||
      result.status === "accepted" ||
      result.status === "deleted",
  )

export const getRepoDeleteAddresses = (
  repoAddresses: Iterable<string> = [],
  fallbackAddress = "",
) => Array.from(new Set([...repoAddresses, fallbackAddress].filter(Boolean)))

export const matchesRepoDeleteEvent = (
  event: {tags?: string[][]} | null | undefined,
  repoAddresses: Iterable<string> = [],
  fallbackAddress = "",
) => {
  const repoTag = getTagValue("repo", event?.tags || [])

  return !!repoTag && getRepoDeleteAddresses(repoAddresses, fallbackAddress).includes(repoTag)
}

export const buildRepoOwnedDeleteFilters = ({
  pubkey,
  repoName,
  repoAddresses,
}: {
  pubkey: string
  repoName: string
  repoAddresses: Iterable<string>
}) => {
  const addresses = getRepoDeleteAddresses(repoAddresses)
  const identifiers = Array.from(
    new Set([repoName, ...getRepoDeleteIdentifiers(pubkey, addresses)].filter(Boolean)),
  )
  const filters: Filter[] = [
    {kinds: [GIT_REPO_ANNOUNCEMENT], authors: [pubkey], "#d": identifiers},
    {kinds: [GIT_REPO_STATE], authors: [pubkey], "#d": identifiers},
  ]

  if (addresses.length > 0) {
    filters.push({
      kinds: [
        GIT_ISSUE,
        GIT_PULL_REQUEST,
        GIT_PULL_REQUEST_UPDATE,
        GIT_LABEL,
        GIT_COVER_LETTER,
        GIT_STATUS_OPEN,
        GIT_STATUS_APPLIED,
        GIT_STATUS_CLOSED,
        GIT_STATUS_DRAFT,
        COMMENT,
        REACTION,
      ],
      authors: [pubkey],
      "#a": addresses,
    })
    filters.push({kinds: [COMMENT], authors: [pubkey], "#q": addresses})
  }

  return filters
}
