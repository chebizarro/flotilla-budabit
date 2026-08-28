import type {TrustedEvent} from "@welshman/util"

export const GIT_DELETION_KINDS = {
  reaction: 7,
  comment: 1111,
  pullRequest: 1618,
  pullRequestUpdate: 1619,
  issue: 1621,
  coverLetter: 1624,
  statusOpen: 1630,
  statusAppliedOrComplete: 1631,
  statusClosed: 1632,
  statusDraft: 1633,
  label: 1985,
  stack: 30410,
  merge: 30411,
  conflict: 30412,
  repository: 30617,
  repositoryState: 30618,
} as const

export const GIT_DELETION_STATUS_KINDS = [1630, 1631, 1632, 1633] as const
export const GIT_DELETION_UNSUPPORTED_ADDRESS_KINDS = [30410, 30411, 30412] as const

export type DeleteRootType = "issue" | "pull-request" | "repository"
export type DeleteRelation =
  | "root"
  | "repository-state"
  | "label"
  | "cover-letter"
  | "status"
  | "pr-update"
  | "comment"
  | "reaction"
export type DeleteKey = `e:${string}` | `a:${string}`
export type DeleteExclusionReason =
  | "foreign-author"
  | "unsupported-kind"
  | "unsupported-address-kind"
  | "invalid-root"
  | "invalid-address"
  | "unrelated"
  | "conflicting-root-reference"
  | "conflicting-repository-reference"
  | "nested-legacy-comment"
  | "invalid-reaction-target"
  | "reaction-kind-mismatch"

export type PlannedDeleteTarget = {
  key: DeleteKey
  event: TrustedEvent
  targetKind: number
  policy: "required" | "best-effort"
  rootType: DeleteRootType
  relation: DeleteRelation
  sourceRound: number
  sourceRelays: string[]
}

export type DeleteClassification =
  | {disposition: "included"; target: PlannedDeleteTarget}
  | {disposition: "foreign" | "unsupported"; reason: DeleteExclusionReason; event: TrustedEvent}

export type GitDeletionContext = {
  rootType: DeleteRootType
  root: TrustedEvent
  repositoryAddress: string
  ownerPubkey: string
  repositoryAddresses?: string[]
  relatedRoots?: TrustedEvent[]
  reactionTargets?: ReadonlyMap<string, number> | Record<string, number>
}

const regularKey = (event: TrustedEvent): DeleteKey => `e:${event.id}`
const values = (event: TrustedEvent, name: string) =>
  event.tags.filter(tag => tag[0] === name && tag[1]).map(tag => tag[1])
const unique = (items: string[]) => Array.from(new Set(items))

const parseRepositoryAddress = (address: string) => {
  const first = address.indexOf(":")
  const second = address.indexOf(":", first + 1)
  if (first < 1 || second < 0 || second === address.length - 1) return null
  const kind = Number(address.slice(0, first))
  const pubkey = address.slice(first + 1, second)
  const identifier = address.slice(second + 1)
  return Number.isInteger(kind) && pubkey ? {kind, pubkey, identifier} : null
}

export const validateGitDeletionRoot = (
  context: GitDeletionContext,
): DeleteExclusionReason | null => {
  const expectedKind =
    context.rootType === "issue"
      ? GIT_DELETION_KINDS.issue
      : context.rootType === "pull-request"
        ? GIT_DELETION_KINDS.pullRequest
        : GIT_DELETION_KINDS.repository
  if (context.root.kind !== expectedKind || context.root.pubkey !== context.ownerPubkey) {
    return "invalid-root"
  }
  const repository = parseRepositoryAddress(context.repositoryAddress)
  if (
    !repository ||
    repository.kind !== GIT_DELETION_KINDS.repository ||
    !/^[0-9a-f]{64}$/.test(repository.pubkey)
  ) {
    return "invalid-address"
  }
  for (const address of context.repositoryAddresses || []) {
    const related = parseRepositoryAddress(address)
    if (
      !related ||
      related.kind !== GIT_DELETION_KINDS.repository ||
      related.pubkey !== repository.pubkey
    ) {
      return "invalid-address"
    }
  }
  if (context.rootType === "repository") {
    return repository.pubkey === context.ownerPubkey &&
      addressFor(context.root) === context.repositoryAddress
      ? null
      : "invalid-root"
  }
  const refs = unique(values(context.root, "a").filter(value => value.startsWith("30617:")))
  return refs.length === 1 && refs[0] === context.repositoryAddress ? null : "invalid-root"
}

const addressFor = (event: TrustedEvent): string | null => {
  const identifiers = unique(values(event, "d"))
  if (identifiers.length !== 1 || !identifiers[0]) return null
  return `${event.kind}:${event.pubkey}:${identifiers[0]}`
}

const repositoryMatches = (event: TrustedEvent, addresses: Set<string>, names = ["a", "q"]) => {
  const refs = unique(
    names.flatMap(name => values(event, name)).filter(value => value.startsWith("30617:")),
  )
  if (refs.some(ref => !addresses.has(ref))) return false
  return refs.length === 0 || refs.some(ref => addresses.has(ref))
}

const directRoot = (event: TrustedEvent, rootId: string, modern: boolean) => {
  const modernRefs = unique(values(event, "E"))
  if (modern && modernRefs.length > 0) return modernRefs.length === 1 && modernRefs[0] === rootId
  const legacyRefs = unique(values(event, "e"))
  return legacyRefs.length === 1 && legacyRefs[0] === rootId
}

const statusMatchesRoot = (
  event: TrustedEvent,
  root: TrustedEvent,
  repositoryAddresses: Set<string>,
) =>
  values(event, "e").includes(root.id) ||
  values(event, "a").some(address => repositoryAddresses.has(address))

const makeTarget = (
  context: GitDeletionContext,
  event: TrustedEvent,
  relation: DeleteRelation,
  sourceRound: number,
  sourceRelay?: string,
  required = false,
): PlannedDeleteTarget | null => {
  let key: DeleteKey
  if (
    event.kind === GIT_DELETION_KINDS.repository ||
    event.kind === GIT_DELETION_KINDS.repositoryState
  ) {
    const address = addressFor(event)
    if (!address) return null
    key = `a:${address}`
  } else {
    key = regularKey(event)
  }
  return {
    key,
    event,
    targetKind: event.kind,
    policy: required ? "required" : "best-effort",
    rootType: context.rootType,
    relation,
    sourceRound,
    sourceRelays: sourceRelay ? [sourceRelay] : [],
  }
}

const reactionTargetKinds = (context: GitDeletionContext) => {
  const map = new Map<string, number>([[context.root.id, context.root.kind]])
  const supplied = context.reactionTargets
  if (supplied instanceof Map) for (const entry of supplied) map.set(...entry)
  else if (supplied) for (const [id, kind] of Object.entries(supplied)) map.set(id, kind)
  return map
}

export const classifyGitDeleteEvent = (
  context: GitDeletionContext,
  event: TrustedEvent,
  sourceRound = 0,
  sourceRelay?: string,
): DeleteClassification => {
  const invalidRoot = validateGitDeletionRoot(context)
  if (invalidRoot) return {disposition: "unsupported", reason: invalidRoot, event}

  if (event.id === context.root.id) {
    const target = makeTarget(context, event, "root", sourceRound, sourceRelay, true)
    return target
      ? {disposition: "included", target}
      : {disposition: "unsupported", reason: "invalid-address", event}
  }
  if ((GIT_DELETION_UNSUPPORTED_ADDRESS_KINDS as readonly number[]).includes(event.kind)) {
    return {disposition: "unsupported", reason: "unsupported-address-kind", event}
  }

  const addresses = new Set([context.repositoryAddress, ...(context.repositoryAddresses || [])])
  const roots = [context.root, ...(context.relatedRoots || [])]
  let relation: DeleteRelation | undefined

  if (context.rootType === "repository" && event.kind === GIT_DELETION_KINDS.repository) {
    const address = addressFor(event)
    if (!address || !addresses.has(address)) {
      return {disposition: "unsupported", reason: "invalid-address", event}
    }
    relation = "repository-state"
  } else if (
    context.rootType === "repository" &&
    event.kind === GIT_DELETION_KINDS.repositoryState
  ) {
    const address = addressFor(event)
    const repo = address && parseRepositoryAddress(address)
    if (!repo || !addresses.has(`30617:${repo.pubkey}:${repo.identifier}`)) {
      return {disposition: "unsupported", reason: "invalid-address", event}
    }
    relation = "repository-state"
  } else if (
    context.rootType === "repository" &&
    [GIT_DELETION_KINDS.issue, GIT_DELETION_KINDS.pullRequest].includes(event.kind as 1618 | 1621)
  ) {
    if (!repositoryMatches(event, addresses, ["a"])) {
      return {disposition: "unsupported", reason: "conflicting-repository-reference", event}
    }
    const repoRefs = unique(values(event, "a").filter(value => value.startsWith("30617:")))
    if (repoRefs.length !== 1) return {disposition: "unsupported", reason: "unrelated", event}
    relation = "root"
  } else if (event.kind === GIT_DELETION_KINDS.reaction) {
    const targets = reactionTargetKinds(context)
    const refs = unique(values(event, "e"))
    if (refs.length !== 1 || !targets.has(refs[0]) || values(event, "a").length > 0) {
      return {disposition: "unsupported", reason: "invalid-reaction-target", event}
    }
    const kindRefs = unique(values(event, "k"))
    if (
      kindRefs.length > 1 ||
      (kindRefs.length === 1 && kindRefs[0] !== String(targets.get(refs[0])))
    ) {
      return {disposition: "unsupported", reason: "reaction-kind-mismatch", event}
    }
    relation = "reaction"
  } else {
    const directKinds: readonly number[] = [
      GIT_DELETION_KINDS.label,
      GIT_DELETION_KINDS.coverLetter,
      ...GIT_DELETION_STATUS_KINDS,
      GIT_DELETION_KINDS.pullRequestUpdate,
      GIT_DELETION_KINDS.comment,
    ]
    if (!directKinds.includes(Number(event.kind))) {
      return {disposition: "unsupported", reason: "unsupported-kind", event}
    }
    for (const root of roots) {
      if (event.kind === GIT_DELETION_KINDS.label && directRoot(event, root.id, false))
        relation = "label"
      else if (event.kind === GIT_DELETION_KINDS.coverLetter && directRoot(event, root.id, false))
        relation = "cover-letter"
      else if (
        (GIT_DELETION_STATUS_KINDS as readonly number[]).includes(event.kind) &&
        statusMatchesRoot(event, root, addresses)
      )
        relation = "status"
      else if (
        event.kind === GIT_DELETION_KINDS.pullRequestUpdate &&
        root.kind === GIT_DELETION_KINDS.pullRequest &&
        directRoot(event, root.id, true)
      )
        relation = "pr-update"
      else if (event.kind === GIT_DELETION_KINDS.comment && directRoot(event, root.id, true))
        relation = "comment"
      if (relation) break
    }
    if (!relation) {
      const reason =
        event.kind === GIT_DELETION_KINDS.comment &&
        values(event, "E").length === 0 &&
        values(event, "e").length > 0
          ? "nested-legacy-comment"
          : "conflicting-root-reference"
      return {disposition: "unsupported", reason, event}
    }
    if (!repositoryMatches(event, addresses)) {
      return {disposition: "unsupported", reason: "conflicting-repository-reference", event}
    }
  }

  if (!relation) return {disposition: "unsupported", reason: "unsupported-kind", event}
  if (event.pubkey !== context.ownerPubkey)
    return {disposition: "foreign", reason: "foreign-author", event}
  const target = makeTarget(context, event, relation, sourceRound, sourceRelay)
  return target
    ? {disposition: "included", target}
    : {disposition: "unsupported", reason: "invalid-address", event}
}

export const mergePlannedDeleteTarget = (
  targets: Map<DeleteKey, PlannedDeleteTarget>,
  incoming: PlannedDeleteTarget,
) => {
  const current = targets.get(incoming.key)
  if (!current) {
    targets.set(incoming.key, {...incoming, sourceRelays: unique(incoming.sourceRelays)})
    return
  }
  const newest = incoming.event.created_at > current.event.created_at ? incoming : current
  targets.set(incoming.key, {
    ...newest,
    policy:
      current.policy === "required" || incoming.policy === "required" ? "required" : "best-effort",
    sourceRound: Math.min(current.sourceRound, incoming.sourceRound),
    sourceRelays: unique([...current.sourceRelays, ...incoming.sourceRelays]),
  })
}

export const sortPlannedDeleteTargets = (targets: Iterable<PlannedDeleteTarget>) =>
  Array.from(targets).sort((left, right) => {
    if (left.policy !== right.policy) return left.policy === "required" ? 1 : -1
    if (left.relation !== right.relation) return left.relation.localeCompare(right.relation)
    return left.key.localeCompare(right.key)
  })
