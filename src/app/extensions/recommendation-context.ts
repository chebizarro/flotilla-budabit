import {
  normalizePubkey,
  normalizeRelays,
  type CommunityDefinition,
  type CommunityPointer,
} from "@app/core/community"
import type {EffectiveCommunityReportState} from "@app/core/community-reports"
import {makeCommunityWidgetContext} from "@app/extensions/community-context"
import type {TrustedEvent} from "@welshman/util"
import type {CommunityWidgetRuntimeContext} from "./types"

export type CommunityWidgetRecommendationContext = {
  community: CommunityPointer
  relays: string[]
  relayHints: string[]
  definition: CommunityDefinition
  profileListEvents: TrustedEvent[]
  trustedWidgetAuthorPubkeys: string[]
  widgetTargetAuthorPubkeys: string[]
  targetingEventIds: string[]
  targetingRelayHints: string[]
}

export type CommunityWidgetPreviewContextOption = {
  id: string
  community: CommunityPointer
  label: string
  runtimeContext: CommunityWidgetRuntimeContext
}

const recommendationContextsByWidgetLineId = new Map<
  string,
  CommunityWidgetRecommendationContext[]
>()

const uniqueStrings = (values: string[]) => Array.from(new Set(values.filter(Boolean)))

const uniquePubkeys = (values: string[]) => uniqueStrings(values.map(normalizePubkey))

const makeContextKey = (context: CommunityWidgetRecommendationContext) => context.community.address

const normalizeRecommendationContext = (
  context: CommunityWidgetRecommendationContext,
): CommunityWidgetRecommendationContext => ({
  ...context,
  relays: normalizeRelays(context.relays),
  relayHints: normalizeRelays(context.relayHints),
  trustedWidgetAuthorPubkeys: uniquePubkeys(context.trustedWidgetAuthorPubkeys),
  widgetTargetAuthorPubkeys: uniquePubkeys(context.widgetTargetAuthorPubkeys),
  targetingEventIds: uniqueStrings(context.targetingEventIds),
  targetingRelayHints: normalizeRelays(context.targetingRelayHints),
})

export const recordCommunityWidgetRecommendationContext = (
  widgetLineId: string,
  context: CommunityWidgetRecommendationContext,
) => {
  const lineId = widgetLineId.trim()
  if (!lineId) return

  const normalized = normalizeRecommendationContext(context)
  const contextKey = makeContextKey(normalized)
  const existing = recommendationContextsByWidgetLineId.get(lineId) || []

  recommendationContextsByWidgetLineId.set(lineId, [
    normalized,
    ...existing.filter(context => makeContextKey(context) !== contextKey),
  ])
}

export const getCommunityWidgetRecommendationContexts = (
  widgetLineId: string,
): CommunityWidgetRecommendationContext[] => [
  ...(recommendationContextsByWidgetLineId.get(widgetLineId.trim()) || []),
]

export const clearCommunityWidgetRecommendationContexts = () => {
  recommendationContextsByWidgetLineId.clear()
}

export const makeCommunityWidgetRuntimeContext = (
  context: CommunityWidgetRecommendationContext,
  {
    userPubkey = "",
    reportState,
  }: {
    userPubkey?: string
    reportState?: EffectiveCommunityReportState
  } = {},
): CommunityWidgetRuntimeContext => ({
  community: context.community,
  definition: context.definition,
  profileListEvents: context.profileListEvents,
  reportState,
  relays: context.relays,
  relayHints: context.relayHints,
  communityContext: makeCommunityWidgetContext({
    definition: context.definition,
    profileListEvents: context.profileListEvents,
    reportState,
    userPubkey,
    relays: context.relays,
    relayHints: context.relayHints,
  }),
})

export const makeCommunityWidgetPreviewContextOptions = ({
  widgetLineId,
  userPubkey = "",
  getLabel,
}: {
  widgetLineId: string
  userPubkey?: string
  getLabel?: (context: CommunityWidgetRecommendationContext) => string
}): CommunityWidgetPreviewContextOption[] =>
  getCommunityWidgetRecommendationContexts(widgetLineId).map(context => ({
    id: context.community.address,
    community: context.community,
    label: getLabel?.(context) || context.community.address,
    runtimeContext: makeCommunityWidgetRuntimeContext(context, {
      userPubkey,
    }),
  }))
