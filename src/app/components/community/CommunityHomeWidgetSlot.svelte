<script lang="ts">
  import {getTagValue} from "@welshman/util"
  import {pubkey} from "@welshman/app"
  import {onDestroy} from "svelte"
  import WidgetFrame from "@app/components/WidgetFrame.svelte"
  import {normalizePubkey} from "@app/core/community"
  import {
    activeCommunityAuthorityReadiness,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    activeExactCommunityDefinition,
    activeExactCommunityPointer,
    activeExactCommunityRelays,
  } from "@app/core/community-state"
  import {makeCommunityWidgetContext} from "@app/extensions/community-context"
  import {
    getEnabledCommunitySlotWidgetsWithSharedConfig,
    getEnabledCommunitySlotWidgets,
    mergeCommunitySlotWidgets,
  } from "@app/extensions/community-widget-slots"
  import {effectiveExtensionSettings} from "@app/extensions/settings"
  import {getWidgetLineId} from "@app/extensions/widget-identity"
  import type {CommunityHomeWidgetRecoveryState} from "@app/extensions/community-home-widget-recovery"
  import type {
    SmartWidgetEvent,
    WidgetHomeSlotType,
    WidgetResizeRequest,
  } from "@app/extensions/types"

  type Props = {
    communityPubkey: string
    communityAddress: string
    relayHints?: string[]
    recovery: CommunityHomeWidgetRecoveryState
    slotType: WidgetHomeSlotType
  }

  const {communityPubkey, communityAddress, relayHints = [], recovery, slotType}: Props = $props()
  const exactCommunity = $derived(
    $activeExactCommunityPointer?.address === communityAddress
      ? $activeExactCommunityPointer
      : undefined,
  )
  const exactDefinition = $derived(
    $activeExactCommunityDefinition?.pointer.address === communityAddress
      ? $activeExactCommunityDefinition
      : undefined,
  )
  const contextDefinition = $derived(
    exactDefinition ? {...exactDefinition, pubkey: exactDefinition.ownerPubkey} : undefined,
  )
  const recoveryMatchesCommunity = $derived(recovery.communityAddress === communityAddress)
  const installedWidgets = $derived($effectiveExtensionSettings.installed?.widget || {})
  const enabledWidgetIds = $derived(new Set($effectiveExtensionSettings.enabled || []))
  const slotWidgets = $derived.by(() =>
    getEnabledCommunitySlotWidgets({
      curatedWidgets: recoveryMatchesCommunity ? recovery.curatedWidgets : [],
      installedWidgets,
      enabledIds: enabledWidgetIds,
      slotType,
    }),
  )
  const sharedConfigSlotWidgets = $derived.by(() =>
    getEnabledCommunitySlotWidgetsWithSharedConfig({
      communityAddress,
      sharedConfigEvents: recoveryMatchesCommunity ? recovery.sharedConfigEvents : [],
      authorizedPubkeys: recoveryMatchesCommunity ? recovery.authorizedPubkeys : new Set(),
      descriptorAuthorities: recoveryMatchesCommunity ? recovery.descriptorAuthorities : [],
      installedWidgets,
      enabledIds: enabledWidgetIds,
      slotType,
    }),
  )
  const frameWidgets = $derived.by(() =>
    exactCommunity ? mergeCommunitySlotWidgets(slotWidgets, sharedConfigSlotWidgets) : [],
  )
  const communityReadinessKey = $derived.by(() => {
    const readiness = $activeCommunityAuthorityReadiness
    return normalizePubkey(readiness.communityPubkey) === normalizePubkey(communityPubkey) &&
      readiness.state === "ready"
      ? JSON.stringify({authorityKey: readiness.key, authorityState: readiness.state})
      : ""
  })
  const communityContext = $derived.by(() => {
    if (!exactDefinition || !exactCommunity || !communityReadinessKey) return undefined
    return makeCommunityWidgetContext({
      definition: contextDefinition as any,
      profileListEvents: $activeCommunityProfileListEvents,
      reportState: $activeCommunityReportState,
      userPubkey: $pubkey || "",
      relays: $activeExactCommunityRelays.length ? $activeExactCommunityRelays : relayHints,
      relayHints,
      readinessKey: communityReadinessKey,
    })
  })
  const communityRuntimeContext = $derived.by(() => {
    if (!communityContext || !exactDefinition || !exactCommunity) return undefined
    return {
      community: exactCommunity,
      definition: exactDefinition,
      profileListEvents: $activeCommunityProfileListEvents,
      authorityEvidenceSettled: true,
      reportState: $activeCommunityReportState,
      relays: $activeExactCommunityRelays.length ? $activeExactCommunityRelays : relayHints,
      relayHints,
      communityContext,
    }
  })

  let initiallyResolvedWidgetLoads = $state<Record<string, true>>({})
  const initialWidgetResizeTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const INITIAL_WIDGET_RESIZE_TIMEOUT_MS = 15_000

  const getWidgetTitle = (widget: SmartWidgetEvent) =>
    getTagValue("title", widget.tags) || widget.content || widget.identifier || "Widget"
  const getWidgetDescription = (widget: SmartWidgetEvent) =>
    getTagValue("description", widget.tags) ||
    (getTagValue("title", widget.tags) ? widget.content : "")
  const getWidgetLoadKey = (widget: SmartWidgetEvent) =>
    [
      communityAddress,
      normalizePubkey($pubkey || ""),
      slotType,
      getWidgetLineId(widget),
      widget.appUrls?.join("|") || widget.appUrl || "",
    ].join(":")
  const makeWidgetContext = (widget: SmartWidgetEvent) => {
    if (!exactCommunity) return {}
    return {
      slot: {type: slotType, label: widget.slot?.label},
      community: {
        address: exactCommunity.address,
        ownerPubkey: exactCommunity.ownerPubkey,
        communityId: exactCommunity.communityId,
        naddr: exactCommunity.naddr,
        relays: relayHints,
      },
      ...(communityContext ? {communityContext} : {}),
      ...(communityRuntimeContext ? {communityRuntimeContext} : {}),
    }
  }
  const resolveInitialWidgetHeight = (loadKey: string, request: WidgetResizeRequest) => {
    if (request.height === undefined || initiallyResolvedWidgetLoads[loadKey]) return
    const timer = initialWidgetResizeTimers.get(loadKey)
    if (timer) clearTimeout(timer)
    initialWidgetResizeTimers.delete(loadKey)
    initiallyResolvedWidgetLoads[loadKey] = true
  }

  $effect(() => {
    const activeLoadKeys = new Set(frameWidgets.map(getWidgetLoadKey))
    for (const loadKey of Object.keys(initiallyResolvedWidgetLoads)) {
      if (!activeLoadKeys.has(loadKey)) delete initiallyResolvedWidgetLoads[loadKey]
    }
    for (const [loadKey, timer] of initialWidgetResizeTimers) {
      if (activeLoadKeys.has(loadKey) && !initiallyResolvedWidgetLoads[loadKey]) continue
      clearTimeout(timer)
      initialWidgetResizeTimers.delete(loadKey)
    }
    for (const loadKey of activeLoadKeys) {
      if (initiallyResolvedWidgetLoads[loadKey] || initialWidgetResizeTimers.has(loadKey)) continue
      const timer = setTimeout(() => {
        initialWidgetResizeTimers.delete(loadKey)
        initiallyResolvedWidgetLoads[loadKey] = true
      }, INITIAL_WIDGET_RESIZE_TIMEOUT_MS)
      initialWidgetResizeTimers.set(loadKey, timer)
    }
  })

  onDestroy(() => {
    for (const timer of initialWidgetResizeTimers.values()) clearTimeout(timer)
    initialWidgetResizeTimers.clear()
  })
</script>

{#if frameWidgets.length > 0}
  <div class="flex flex-col gap-4 px-2 py-3 sm:px-4 sm:py-4">
    {#each frameWidgets as widget (getWidgetLineId(widget))}
      {@const title = getWidgetTitle(widget)}
      {@const description = getWidgetDescription(widget)}
      {@const widgetLoadKey = getWidgetLoadKey(widget)}
      {@const initialHeightResolved = Boolean(initiallyResolvedWidgetLoads[widgetLoadKey])}
      <section
        class="overflow-visible"
        aria-label={widget.slot?.label || title}
        aria-busy={!initialHeightResolved}
        title={description || undefined}>
        <div
          class={`relative ${initialHeightResolved ? "" : "min-h-[220px] overflow-hidden rounded-box"}`}>
          <div inert={!initialHeightResolved} aria-hidden={!initialHeightResolved}>
            <WidgetFrame
              {widget}
              context={makeWidgetContext(widget)}
              class="w-full"
              minHeight={1}
              resizeMinHeight={1}
              onResizeRequest={request => resolveInitialWidgetHeight(widgetLoadKey, request)} />
          </div>
          {#if !initialHeightResolved}
            <div
              class="absolute inset-0 flex animate-pulse items-center justify-center border border-base-content/10 bg-base-200 p-6"
              role="status"
              aria-label="Loading community widget">
              <div class="w-full max-w-lg space-y-4" aria-hidden="true">
                <div class="h-5 w-2/5 rounded bg-base-content/25"></div>
                <div class="h-4 w-full rounded bg-base-content/20"></div>
                <div class="h-4 w-4/5 rounded bg-base-content/20"></div>
                <div class="h-10 w-32 rounded-box bg-base-content/25"></div>
              </div>
            </div>
          {/if}
        </div>
      </section>
    {/each}
  </div>
{/if}
