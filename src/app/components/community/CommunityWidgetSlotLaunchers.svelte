<script lang="ts">
  import WidgetIcon from "@assets/icons/widget.svg?dataurl"
  import {pubkey} from "@welshman/app"
  import {onDestroy, onMount} from "svelte"
  import {get} from "svelte/store"
  import WidgetModal from "@app/components/WidgetModal.svelte"
  import {normalizePubkey} from "@app/core/community"
  import {
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    activeExactCommunityDefinition,
    activeExactCommunityPointer,
    activeExactCommunityRelays,
  } from "@app/core/community-state"
  import {makeCommunityWidgetContext} from "@app/extensions/community-context"
  import {
    getCommunityWidgetCurationEvidenceKey,
    getEnabledCommunitySlotWidgets,
    loadCachedCommunityCuratedWidgets,
  } from "@app/extensions/community-widget-slots"
  import {logCommunityWidgetDebug} from "@app/extensions/community-widget-debug"
  import {effectiveExtensionSettings} from "@app/extensions/settings"
  import {getWidgetLineId} from "@app/extensions/widget-identity"
  import type {SmartWidgetEvent, WidgetActionSlotType} from "@app/extensions/types"
  import {pushModal} from "@app/util/modal"
  import {makeExactCommunityInputValue} from "@app/util/community-stars"

  type LauncherVariant = "message-actions" | "top-menu"

  type Props = {
    communityPubkey: string
    communityAddress?: string
    relayHints?: string[]
    slotType: WidgetActionSlotType
    variant?: LauncherVariant
    context?: Record<string, unknown>
  }

  const {
    communityPubkey,
    communityAddress = "",
    relayHints = [],
    slotType,
    variant = "message-actions",
    context = {},
  }: Props = $props()
  const exactCommunity = $derived(
    $activeExactCommunityPointer?.address === communityAddress ||
      (!communityAddress &&
        normalizePubkey($activeExactCommunityPointer?.controllerPubkey || "") ===
          normalizePubkey(communityPubkey))
      ? $activeExactCommunityPointer
      : undefined,
  )
  const exactDefinition = $derived(
    exactCommunity && $activeExactCommunityDefinition?.pointer.address === exactCommunity.address
      ? $activeExactCommunityDefinition
      : undefined,
  )
  const contextDefinition = $derived(
    exactDefinition ? {...exactDefinition, pubkey: exactDefinition.controllerPubkey} : undefined,
  )
  let curatedWidgets = $state<SmartWidgetEvent[]>([])
  let loadKey = ""
  let loadRequestId = 0
  let loadRefreshNonce = $state(0)
  let forceNextLoad = false
  let lastForcedRefreshAt = 0
  const FORCED_REFRESH_DEBOUNCE_MS = 1_000

  const installedWidgets = $derived($effectiveExtensionSettings.installed?.widget || {})
  const enabledWidgetIds = $derived(new Set($effectiveExtensionSettings.enabled || []))
  const slotWidgets = $derived(
    getEnabledCommunitySlotWidgets({
      curatedWidgets,
      installedWidgets,
      enabledIds: enabledWidgetIds,
      slotType,
    }),
  )
  const containerClass = $derived(
    variant === "top-menu" ? "relative isolate flex items-center gap-1" : "flex items-center gap-1",
  )
  const buttonClass = $derived(
    variant === "top-menu"
      ? "btn btn-outline btn-sm gap-1"
      : "btn btn-circle btn-xs border border-solid border-neutral bg-base-100/90 shadow-sm backdrop-blur",
  )

  const getWidgetTitle = (widget: SmartWidgetEvent) =>
    widget.slot?.label || widget.content || widget.identifier || "Widget"

  const communityContext = $derived.by(() => {
    if (!exactDefinition || !exactCommunity) {
      return undefined
    }

    return makeCommunityWidgetContext({
      definition: contextDefinition as any,
      profileListEvents: $activeCommunityProfileListEvents,
      reportState: $activeCommunityReportState,
      userPubkey: $pubkey || "",
      relays: $activeExactCommunityRelays.length ? $activeExactCommunityRelays : relayHints,
      relayHints,
    })
  })
  const getCurrentCommunityRuntimeContext = () => {
    const exactCommunity = get(activeExactCommunityPointer)
    const definition = get(activeExactCommunityDefinition)
    if (
      !exactCommunity ||
      (communityAddress && exactCommunity.address !== communityAddress) ||
      normalizePubkey(exactCommunity.controllerPubkey) !== normalizePubkey(communityPubkey) ||
      definition?.pointer.address !== exactCommunity.address
    ) {
      return undefined
    }

    const profileListEvents = get(activeCommunityProfileListEvents)
    const reportState = get(activeCommunityReportState)
    const relays = get(activeExactCommunityRelays)
    const currentCommunityContext = makeCommunityWidgetContext({
      definition: {...definition, pubkey: definition.controllerPubkey} as any,
      profileListEvents,
      reportState,
      userPubkey: get(pubkey) || "",
      relays: relays.length ? relays : relayHints,
      relayHints,
    })

    return {
      community: exactCommunity,
      definition,
      profileListEvents,
      reportState,
      relays: relays.length ? relays : relayHints,
      relayHints,
      communityContext: currentCommunityContext,
    }
  }
  const curationEvidence = $derived.by(() => {
    const definition = exactDefinition
    const matchesCommunity =
      definition && exactCommunity && definition.pointer.address === exactCommunity.address
    const profileListEvents = matchesCommunity ? $activeCommunityProfileListEvents : []
    const reportState = matchesCommunity ? $activeCommunityReportState : undefined

    return {
      ready: Boolean(matchesCommunity),
      key: matchesCommunity
        ? getCommunityWidgetCurationEvidenceKey({
            definitionEventId: definition.event.id,
            profileListEvents,
            reportState,
          })
        : "",
      profileListEvents,
      reportState,
    }
  })

  const openWidget = (widget: SmartWidgetEvent) => {
    if (!widget.appUrl || !exactCommunity) return

    pushModal(WidgetModal, {
      widget,
      context: {
        ...context,
        slot: {type: slotType, label: widget.slot?.label},
        community: {
          address: exactCommunity.address,
          controllerPubkey: exactCommunity.controllerPubkey,
          communityId: exactCommunity.communityId,
          naddr: exactCommunity.naddr,
          relays: relayHints,
        },
        ...(communityContext ? {communityContext} : {}),
      },
      communityRuntimeContextProvider: getCurrentCommunityRuntimeContext,
    })
  }

  const refreshWidgets = (force = false) => {
    if (force) {
      const now = Date.now()
      if (now - lastForcedRefreshAt < FORCED_REFRESH_DEBOUNCE_MS) return
      lastForcedRefreshAt = now
      forceNextLoad = true
    }

    loadKey = ""
    loadRefreshNonce += 1
  }

  const refreshVisibleWidgets = () => {
    if (document.visibilityState === "visible") refreshWidgets(true)
  }

  $effect(() => {
    void loadRefreshNonce
    const input = exactCommunity ? makeExactCommunityInputValue(exactCommunity) : ""
    const evidence = curationEvidence
    const key =
      input && evidence.ready
        ? `${normalizePubkey($pubkey || "")}:${slotType}:${input}:${evidence.key}`
        : ""

    if (!key || !input) {
      curatedWidgets = []
      loadKey = ""
      loadRequestId += 1
      return
    }

    if (key === loadKey) return
    loadKey = key
    curatedWidgets = []
    const force = forceNextLoad
    forceNextLoad = false
    const requestId = ++loadRequestId

    loadCachedCommunityCuratedWidgets(input, {
      evidenceKey: evidence.key,
      force,
      profileListEvents: evidence.profileListEvents,
      reportState: evidence.reportState,
    })
      .then(result => {
        if (requestId !== loadRequestId || key !== loadKey) {
          logCommunityWidgetDebug("launcher slot discarded stale curated widgets result", {
            slotType,
            communityPubkey,
            key,
            currentKey: loadKey,
            requestId,
            currentRequestId: loadRequestId,
            status: result?.status,
            widgetCount: result?.status === "community" ? result.widgets.length : 0,
          })
          return
        }

        curatedWidgets = result?.status === "community" ? result.widgets : []
      })
      .catch(error => {
        if (requestId !== loadRequestId || key !== loadKey) return

        console.warn("[community-widget-slots] Failed to load widgets", error)
        curatedWidgets = []
        loadKey = ""
      })
  })

  onMount(() => {
    const refresh = () => refreshWidgets(true)

    window.addEventListener("pageshow", refresh)
    window.addEventListener("focus", refresh)
    window.addEventListener("online", refresh)
    document.addEventListener("visibilitychange", refreshVisibleWidgets)

    return () => {
      window.removeEventListener("pageshow", refresh)
      window.removeEventListener("focus", refresh)
      window.removeEventListener("online", refresh)
      document.removeEventListener("visibilitychange", refreshVisibleWidgets)
    }
  })

  onDestroy(() => {
    loadRequestId += 1
  })
</script>

{#if slotWidgets.length > 0}
  <div class={containerClass} data-widget-slot={slotType}>
    {#each slotWidgets as widget (getWidgetLineId(widget))}
      {@const title = getWidgetTitle(widget)}
      <button class={buttonClass} {title} aria-label={title} onclick={() => openWidget(widget)}>
        {#if widget.iconUrl || widget.imageUrl}
          <img
            src={widget.iconUrl || widget.imageUrl}
            alt=""
            class="h-4 w-4 shrink-0 rounded object-cover" />
        {:else}
          <img src={WidgetIcon} alt="" class="h-4 w-4 shrink-0" />
        {/if}
        {#if variant === "top-menu"}
          <span class="hidden max-w-[100px] truncate lg:inline">{title}</span>
        {/if}
      </button>
    {/each}
  </div>
{/if}
