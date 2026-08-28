import {
  COMMENT,
  DELETE,
  EVENT_TIME,
  GIT_STATUS_CLOSED,
  GIT_STATUS_COMPLETE,
  GIT_STATUS_DRAFT,
  GIT_STATUS_OPEN,
  REACTION,
  THREAD,
  ZAP_GOAL,
  type TrustedEvent,
} from "@welshman/util"
import {
  GIT_ISSUE,
  GIT_LABEL,
  GIT_PULL_REQUEST,
  GIT_PULL_REQUEST_UPDATE,
  GIT_REPO_ANNOUNCEMENT,
  GIT_REPO_STATE,
  GIT_STATUS_APPLIED,
} from "@nostr-git/core/events"
import {COMMUNITY_REPORT_KIND} from "@app/core/community-reports"
import {COMMUNITY_DEFINITION_KIND, parseCommunityId} from "@app/core/community-protocol"

const GIT_COVER_LETTER_KIND = 1624
const mobilePersistedContentKinds = new Set([EVENT_TIME, THREAD, ZAP_GOAL])

const persistedGitDeleteKinds = new Set([
  GIT_REPO_ANNOUNCEMENT,
  GIT_REPO_STATE,
  GIT_ISSUE,
  GIT_PULL_REQUEST,
  GIT_PULL_REQUEST_UPDATE,
  GIT_LABEL,
  GIT_COVER_LETTER_KIND,
  GIT_STATUS_OPEN,
  GIT_STATUS_DRAFT,
  GIT_STATUS_CLOSED,
  GIT_STATUS_COMPLETE,
  GIT_STATUS_APPLIED,
  COMMENT,
  REACTION,
])

export type RepositoryDeleteTarget = {
  type: "e" | "a"
  value: string
  key: `e:${string}` | `a:${string}`
  kind: number
  author?: string
}

export type RepositoryDeleteShape = {
  repositoryAddress: string
  targets: RepositoryDeleteTarget[]
}

const parsePersistedGitKind = (value: string) => {
  if (!/^\d+$/.test(value)) return
  const kind = Number(value)
  return persistedGitDeleteKinds.has(kind) ? kind : undefined
}

// Mixed deletes carry the target kind in each target's fourth field.
// Existing homogeneous deletes with one unkeyed k tag remain valid.
export const parseRepositoryDeleteShape = (
  event: TrustedEvent,
): RepositoryDeleteShape | undefined => {
  if (event.kind !== DELETE) return

  const repoTags = event.tags.filter(tag => tag[0] === "repo")
  if (repoTags.length !== 1 || repoTags[0].length !== 2 || !repoTags[0][1]) return
  if (!/^30617:[0-9a-f]{64}:.+$/.test(repoTags[0][1])) return

  const targetTags = event.tags.filter(tag => tag[0] === "e" || tag[0] === "a")
  if (targetTags.length === 0 || targetTags.some(tag => !tag[1])) return
  const targetKeys = targetTags.map(tag => `${tag[0]}:${tag[1]}` as `e:${string}` | `a:${string}`)
  if (new Set(targetKeys).size !== targetKeys.length) return

  const kindTags = event.tags.filter(tag => tag[0] === "k")
  const legacyKind = kindTags.length === 1 ? parsePersistedGitKind(kindTags[0][1] || "") : undefined
  const legacy =
    legacyKind !== undefined &&
    kindTags[0].length === 2 &&
    targetTags.every(tag => tag.length >= 2 && tag.length <= 5)
  const canonical =
    kindTags.length === 0 &&
    targetTags.every(
      tag => tag.length === 4 && tag[2] === "" && parsePersistedGitKind(tag[3]) !== undefined,
    )
  if (!legacy && !canonical) return

  const targets = targetTags.map((tag, index) => {
    const addressAuthor = tag[0] === "a" ? tag[1].split(":", 3)[1] : undefined
    const taggedAuthor = legacy && /^[0-9a-f]{64}$/.test(tag[4] || "") ? tag[4] : undefined
    return {
      type: tag[0] as "e" | "a",
      value: tag[1],
      key: targetKeys[index],
      kind: legacy ? legacyKind! : parsePersistedGitKind(tag[3])!,
      ...(taggedAuthor || addressAuthor ? {author: taggedAuthor || addressAuthor} : {}),
    }
  })
  if (
    targets.some(target => {
      if (target.type !== "a") return false
      const match = target.value.match(/^(\d+):([0-9a-f]{64}):(.+)$/)
      return !match || Number(match[1]) !== target.kind
    })
  ) {
    return
  }
  if (targets.some(target => target.author && target.author !== event.pubkey)) return

  return {repositoryAddress: repoTags[0][1], targets}
}

export const isPersistedCommunityDefinitionEvent = (event: TrustedEvent) => {
  if (event.kind !== COMMUNITY_DEFINITION_KIND) return false

  const identifiers = event.tags.filter(tag => tag[0] === "d")

  return (
    identifiers.length === 1 &&
    identifiers[0].length === 2 &&
    Boolean(parseCommunityId(identifiers[0][1] || ""))
  )
}

export const isPersistedGitDeleteEvent = (event: TrustedEvent) => {
  return Boolean(parseRepositoryDeleteShape(event))
}

export const isPersistedCommunityReportDeleteEvent = (event: TrustedEvent) => {
  if (event.kind !== DELETE) return false
  if (!event.tags.some(tag => tag[0] === "e" && tag[1])) return false

  return event.tags.some(tag => tag[0] === "k" && tag[1] === String(COMMUNITY_REPORT_KIND))
}

export const isPersistedMobileContentEvent = (event: TrustedEvent) =>
  mobilePersistedContentKinds.has(event.kind)
