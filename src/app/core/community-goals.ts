import type {EventContent, TrustedEvent} from "@welshman/util"
import {COMMENT, ZAP_GOAL, getTagValue} from "@welshman/util"
import {makeCommunityScopeTags} from "@app/core/community"
import {eventTargetsCommunity} from "@app/core/community-feeds"

export type CommunityGoalReplyParent = {
  id: string
  pubkey: string
  kind?: number
  relay?: string
}

export const makeCommunityGoalReply = ({
  communityPubkey,
  goal,
  content,
  relay,
  parent,
  tags = [],
}: {
  communityPubkey: string
  goal: Pick<TrustedEvent, "id" | "pubkey">
  content: string
  relay?: string
  parent?: CommunityGoalReplyParent
  tags?: string[][]
}): EventContent => {
  const relayHint = relay || ""
  const eventTags = [
    ["E", goal.id, relayHint, goal.pubkey],
    ["K", String(ZAP_GOAL)],
    ["P", goal.pubkey, relayHint],
  ]

  if (parent) {
    const parentRelay = parent.relay || relayHint

    eventTags.push(
      ["e", parent.id, parentRelay, parent.pubkey],
      ["k", String(parent.kind || COMMENT)],
      ["p", parent.pubkey, parentRelay],
    )
  } else {
    eventTags.push(
      ["e", goal.id, relayHint, goal.pubkey],
      ["k", String(ZAP_GOAL)],
      ["p", goal.pubkey, relayHint],
    )
  }

  return {content, tags: makeCommunityScopeTags(communityPubkey, [...eventTags, ...tags])}
}

export const readCommunityGoalReply = (
  event: TrustedEvent,
  communityPubkey?: string,
  goalId?: string,
) => {
  if (event.kind !== COMMENT) return undefined
  if (communityPubkey && !eventTargetsCommunity(event, communityPubkey)) return undefined
  if (getTagValue("K", event.tags) !== String(ZAP_GOAL)) return undefined

  const rootId = getTagValue("E", event.tags) || ""
  if (!rootId || (goalId && rootId !== goalId)) return undefined

  const parentId = getTagValue("e", event.tags) || ""
  const parentKind = getTagValue("k", event.tags) || ""

  return {
    id: event.id,
    event,
    communityPubkey: getTagValue("h", event.tags) || "",
    goalId: rootId,
    parentReplyId:
      parentId && parentId !== rootId && parentKind !== String(ZAP_GOAL) ? parentId : "",
  }
}
