import {REPORT, type TrustedEvent} from "@welshman/util"

const isRelayHint = (value: string | undefined) => /^wss?:\/\//i.test(value?.trim() || "")

export const getReportReason = (tag: string[]) => {
  const markerReason = tag[3]?.trim()
  if (markerReason) return markerReason.toLowerCase()

  const maybeReason = tag[2]?.trim()
  return maybeReason && !isRelayHint(maybeReason) ? maybeReason.toLowerCase() : ""
}

export const getOwnerSpamReportTargetId = (event: TrustedEvent, repoOwner: string) => {
  if (event.kind !== REPORT || !repoOwner || event.pubkey !== repoOwner) return ""

  const targetTag = (event.tags || []).find(
    tag => tag[0] === "e" && tag[1] && getReportReason(tag) === "spam",
  )

  return targetTag?.[1] || ""
}

export const getHiddenRepoEventIds = (events: TrustedEvent[], repoOwner: string) => {
  const hidden = new Set<string>()

  for (const event of events || []) {
    const targetId = getOwnerSpamReportTargetId(event, repoOwner)
    if (targetId) hidden.add(targetId)
  }

  return hidden
}
