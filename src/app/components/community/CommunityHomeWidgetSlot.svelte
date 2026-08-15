<script lang="ts">
  import {getTagValue} from "@welshman/util"
  import {pubkey, repository} from "@welshman/app"
  import {onDestroy, onMount} from "svelte"
  import WidgetFrame from "@app/components/WidgetFrame.svelte"
  import {normalizePubkey} from "@app/core/community"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
  import {
    activeCommunityDefinition,
    activeCommunityAuthorityReadiness,
    activeCommunityProfile,
    activeCommunityProfileListEvents,
    activeCommunityRelays,
    activeCommunityReportState,
    loadCommunityEventsWithStatus,
  } from "@app/core/community-state"
  import {getCommunitySectionAuthorityPubkeys} from "@app/core/community-permissions"
  import {makeCommunityWidgetContext} from "@app/extensions/community-context"
  import {
    getCommunityWidgetCurationEvidenceKey,
    getEnabledCommunitySlotWidgetsWithSharedConfig,
    getEnabledCommunitySlotWidgets,
    getLastValidatedCommunityCuratedWidgets,
    loadCachedCommunityCuratedWidgets,
    makeCommunitySharedConfigRecoveryFilter,
    mergeCommunitySlotWidgets,
    shouldRetryCommunitySharedConfigRecovery,
    shouldPreserveCuratedWidgetView,
  } from "@app/extensions/community-widget-slots"
  import {logCommunityWidgetDebug} from "@app/extensions/community-widget-debug"
  import {
    getCommunitySharedConfigDescriptorKey,
    type CommunitySharedConfigDescriptorAuthority,
  } from "@app/extensions/community-shared-config"
  import {effectiveExtensionSettings} from "@app/extensions/settings"
  import {getWidgetLineId} from "@app/extensions/widget-identity"
  import type {
    SmartWidgetEvent,
    WidgetHomeSlotType,
    WidgetResizeRequest,
  } from "@app/extensions/types"
  import {makeCommunityInputValue} from "@app/util/community-stars"

  type Props = {
    communityPubkey: string
    relayHints?: string[]
    slotType: WidgetHomeSlotType
  }

  const {communityPubkey, relayHints = [], slotType}: Props = $props()

  let curatedWidgets = $state<SmartWidgetEvent[]>([])
  let loadKey = ""
  let loadRequestId = 0
  let loadRefreshNonce = $state(0)
  let forceNextLoad = false
  let lastForcedRefreshAt = 0
  let curatedWidgetsBaseKey = ""
  let lastLoadReadinessKey = ""
  let lastLoadEvidenceKey = ""
  let curationRetryTimer: ReturnType<typeof setTimeout> | undefined
  let curationRetryDelay = 1_000
  let initiallyResolvedWidgetLoads = $state<Record<string, true>>({})
  const initialWidgetResizeTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let loadedCommunitySharedConfigEvents = $state<any[]>([])
  let sharedConfigLoadKey = ""
  let sharedConfigLoadRequestId = 0
  let sharedConfigRetryTimer: ReturnType<typeof setTimeout> | undefined
  let sharedConfigRetryDelay = 1_000
  const FORCED_REFRESH_DEBOUNCE_MS = 1_000
  const MAX_CURATION_RETRY_DELAY_MS = 15_000
  const INITIAL_WIDGET_RESIZE_TIMEOUT_MS = 15_000
  const MAX_SHARED_CONFIG_RETRY_DELAY_MS = 15_000

  const installedWidgets = $derived($effectiveExtensionSettings.installed?.widget || {})
  const enabledWidgetIds = $derived(new Set($effectiveExtensionSettings.enabled || []))
  const slotWidgets = $derived.by(() => {
    return getEnabledCommunitySlotWidgets({
      curatedWidgets,
      installedWidgets,
      enabledIds: enabledWidgetIds,
      slotType,
    })
  })

  const getWidgetTitle = (widget: SmartWidgetEvent) =>
    getTagValue("title", widget.tags) || widget.content || widget.identifier || "Widget"

  const getWidgetDescription = (widget: SmartWidgetEvent) =>
    getTagValue("description", widget.tags) ||
    (getTagValue("title", widget.tags) ? widget.content : "")

  const getWidgetLoadKey = (widget: SmartWidgetEvent) =>
    [
      normalizePubkey(communityPubkey),
      normalizePubkey($pubkey || ""),
      slotType,
      getWidgetLineId(widget),
      widget.appUrls?.join("|") || widget.appUrl || "",
    ].join(":")

  const communityReadinessKey = $derived.by(() => {
    const readiness = $activeCommunityAuthorityReadiness

    return normalizePubkey(readiness.communityPubkey) === normalizePubkey(communityPubkey) &&
      readiness.state === "ready"
      ? JSON.stringify({
          authorityKey: readiness.key,
          authorityState: readiness.state,
        })
      : ""
  })
  const curationEvidence = $derived.by(() => {
    const definition = $activeCommunityDefinition
    const matchesCommunity =
      definition && normalizePubkey(definition.pubkey) === normalizePubkey(communityPubkey)
    const profileListEvents = matchesCommunity ? $activeCommunityProfileListEvents : []
    const reportState = matchesCommunity ? $activeCommunityReportState : undefined

    return {
      ready: Boolean(matchesCommunity && communityReadinessKey),
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
  const communitySharedConfigAuthority = $derived.by(() => {
    const definition = $activeCommunityDefinition
    if (!definition || normalizePubkey(definition.pubkey) !== normalizePubkey(communityPubkey)) {
      return {
        authorizedPubkeys: new Set<string>(),
        legacyAuthorizedPubkeys: new Set<string>(),
        descriptorAuthorities: [] as CommunitySharedConfigDescriptorAuthority[],
      }
    }

    const moderatorsByDescriptor = new Map<string, CommunitySharedConfigDescriptorAuthority>()
    for (const section of definition.sections) {
      const moderatorPubkeys = getCommunitySectionAuthorityPubkeys({
        definition,
        sectionName: section.name,
        profileListEvents: $activeCommunityProfileListEvents,
        reportState: $activeCommunityReportState,
      })
      for (const descriptor of section.kinds) {
        const key = getCommunitySharedConfigDescriptorKey(descriptor)
        const current = moderatorsByDescriptor.get(key)
        moderatorsByDescriptor.set(key, {
          descriptor,
          moderatorPubkeys: new Set([
            ...(current ? Array.from(current.moderatorPubkeys) : []),
            ...moderatorPubkeys,
          ]),
        })
      }
    }

    const descriptorAuthorities = Array.from(moderatorsByDescriptor.values())
    return {
      authorizedPubkeys: new Set([
        normalizePubkey(definition.pubkey),
        ...descriptorAuthorities.flatMap(authority => Array.from(authority.moderatorPubkeys)),
      ]),
      // Untagged legacy configs cannot be scoped to a section, so only the
      // community owner is accepted for home-slot recovery.
      legacyAuthorizedPubkeys: new Set([normalizePubkey(definition.pubkey)]),
      descriptorAuthorities,
    }
  })
  const cachedCommunitySharedConfigEvents = $derived.by(() => {
    void communityReadinessKey
    void loadRefreshNonce

    try {
      return repository.query([
        makeCommunitySharedConfigRecoveryFilter(
          communitySharedConfigAuthority.authorizedPubkeys,
        ) as any,
      ])
    } catch (error) {
      console.warn("[community-home-widgets] Failed to query cached shared config", error)
      return []
    }
  })
  const communitySharedConfigEvents = $derived.by(() => {
    const byId = new Map<string, any>()

    for (const event of [
      ...cachedCommunitySharedConfigEvents,
      ...loadedCommunitySharedConfigEvents,
    ]) {
      const key = event?.id || JSON.stringify(event?.tags || [])
      if (key && !byId.has(key)) byId.set(key, event)
    }

    return Array.from(byId.values())
  })
  const sharedConfigSlotWidgets = $derived.by(() => {
    return getEnabledCommunitySlotWidgetsWithSharedConfig({
      communityPubkey,
      sharedConfigEvents: communitySharedConfigEvents,
      authorizedPubkeys: communitySharedConfigAuthority.authorizedPubkeys,
      descriptorAuthorities: communitySharedConfigAuthority.descriptorAuthorities,
      legacyAuthorizedPubkeys: communitySharedConfigAuthority.legacyAuthorizedPubkeys,
      installedWidgets,
      enabledIds: enabledWidgetIds,
      slotType,
    })
  })

  const communityContext = $derived.by(() => {
    if (
      !$activeCommunityDefinition ||
      normalizePubkey($activeCommunityDefinition.pubkey) !== normalizePubkey(communityPubkey) ||
      !communityReadinessKey
    ) {
      return undefined
    }

    return makeCommunityWidgetContext({
      definition: $activeCommunityDefinition,
      profile: $activeCommunityProfile,
      profileListEvents: $activeCommunityProfileListEvents,
      reportState: $activeCommunityReportState,
      userPubkey: $pubkey || "",
      relays: $activeCommunityRelays.length ? $activeCommunityRelays : relayHints,
      relayHints,
      readinessKey: communityReadinessKey,
    })
  })
  const communityRuntimeContext = $derived.by(() => {
    const definition = $activeCommunityDefinition
    if (
      !communityContext ||
      !definition ||
      normalizePubkey(definition.pubkey) !== normalizePubkey(communityPubkey)
    ) {
      return undefined
    }

    return {
      definition,
      profileListEvents: $activeCommunityProfileListEvents,
      authorityEvidenceSettled: true,
      reportState: $activeCommunityReportState,
      relays: $activeCommunityRelays.length ? $activeCommunityRelays : relayHints,
      relayHints,
      communityContext,
    }
  })
  const frameWidgets = $derived.by(() => {
    return mergeCommunitySlotWidgets(slotWidgets, sharedConfigSlotWidgets)
  })

  const makeWidgetContext = (widget: SmartWidgetEvent) => ({
    slot: {type: slotType, label: widget.slot?.label},
    community: {pubkey: communityPubkey, relays: relayHints},
    ...(communityContext ? {communityContext} : {}),
    ...(communityRuntimeContext ? {communityRuntimeContext} : {}),
  })

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

  const clearCurationRetry = () => {
    if (curationRetryTimer) clearTimeout(curationRetryTimer)
    curationRetryTimer = undefined
  }

  const scheduleCurationRetry = () => {
    if (curationRetryTimer) return
    curationRetryTimer = setTimeout(() => {
      curationRetryTimer = undefined
      if (document.visibilityState === "visible") refreshWidgets(true)
    }, curationRetryDelay)
    curationRetryDelay = Math.min(curationRetryDelay * 2, MAX_CURATION_RETRY_DELAY_MS)
  }

  const clearSharedConfigRetry = () => {
    if (sharedConfigRetryTimer) clearTimeout(sharedConfigRetryTimer)
    sharedConfigRetryTimer = undefined
  }

  const scheduleSharedConfigRetry = () => {
    if (sharedConfigRetryTimer) return
    sharedConfigRetryTimer = setTimeout(() => {
      sharedConfigRetryTimer = undefined
      sharedConfigLoadKey = ""
      loadRefreshNonce += 1
    }, sharedConfigRetryDelay)
    sharedConfigRetryDelay = Math.min(sharedConfigRetryDelay * 2, MAX_SHARED_CONFIG_RETRY_DELAY_MS)
  }

  $effect(() => {
    void loadRefreshNonce
    const normalizedCommunityPubkey = normalizePubkey(communityPubkey)
    const relays = $activeCommunityRelays.length ? $activeCommunityRelays : relayHints
    const authorizedPubkeys = communitySharedConfigAuthority.authorizedPubkeys
    const key = normalizedCommunityPubkey
      ? `${normalizedCommunityPubkey}:${relays.join("|")}:${Array.from(authorizedPubkeys).sort().join("|")}:${communityReadinessKey}`
      : ""

    if (!key || relays.length === 0 || authorizedPubkeys.size === 0) {
      clearSharedConfigRetry()
      loadedCommunitySharedConfigEvents = []
      sharedConfigLoadKey = ""
      sharedConfigLoadRequestId += 1
      return
    }

    if (key === sharedConfigLoadKey) return
    clearSharedConfigRetry()
    sharedConfigLoadKey = key
    const requestId = ++sharedConfigLoadRequestId

    loadCommunityEventsWithStatus(
      relays,
      [makeCommunitySharedConfigRecoveryFilter(authorizedPubkeys) as any],
      {
        authenticate: true,
        priority: RELAY_REQUEST_PRIORITY.interactive,
        priorityAuthRelays: relayHints,
        settle: "all",
        timeout: 3_000,
      },
    )
      .then(result => {
        if (requestId === sharedConfigLoadRequestId && key === sharedConfigLoadKey) {
          loadedCommunitySharedConfigEvents = result.events
          if (shouldRetryCommunitySharedConfigRecovery(result)) {
            scheduleSharedConfigRetry()
          } else {
            clearSharedConfigRetry()
            sharedConfigRetryDelay = 1_000
          }
        }
      })
      .catch(error => {
        if (requestId !== sharedConfigLoadRequestId || key !== sharedConfigLoadKey) return

        console.warn("[community-home-widgets] Failed to load shared config hints", error)
        loadedCommunitySharedConfigEvents = []
        scheduleSharedConfigRetry()
      })
  })

  $effect(() => {
    void loadRefreshNonce
    const input = makeCommunityInputValue({pubkey: communityPubkey, relayHints})
    const evidence = curationEvidence
    const baseKey =
      input && evidence.ready
        ? `${slotType}:${normalizePubkey(communityPubkey)}:${normalizePubkey($pubkey || "")}:${relayHints.slice().sort().join(",")}:${evidence.key}`
        : ""
    const readinessKey = communityReadinessKey
    const key = baseKey ? `${baseKey}:${readinessKey}` : ""

    if (!key || !input) {
      clearCurationRetry()
      curatedWidgets = []
      curatedWidgetsBaseKey = ""
      lastLoadReadinessKey = ""
      loadKey = ""
      loadRequestId += 1
      return
    }

    const evidenceChanged = Boolean(lastLoadEvidenceKey && lastLoadEvidenceKey !== evidence.key)

    if (baseKey !== curatedWidgetsBaseKey) {
      clearCurationRetry()
      curationRetryDelay = 1_000
      curatedWidgets = evidenceChanged
        ? []
        : getLastValidatedCommunityCuratedWidgets(input, $pubkey || "", evidence.key)
      curatedWidgetsBaseKey = baseKey
      lastLoadReadinessKey = ""
    }

    if (key === loadKey) return
    loadKey = key
    const readinessChanged = Boolean(lastLoadReadinessKey && lastLoadReadinessKey !== readinessKey)
    lastLoadReadinessKey = readinessKey
    lastLoadEvidenceKey = evidence.key
    const force = forceNextLoad || readinessChanged || evidenceChanged
    forceNextLoad = false
    const requestId = ++loadRequestId

    logCommunityWidgetDebug("home slot loading curated widgets", {
      slotType,
      communityPubkey,
      relayHints,
      input,
      key,
      force,
    })

    loadCachedCommunityCuratedWidgets(input, {
      evidenceKey: evidence.key,
      force,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      profileListEvents: evidence.profileListEvents,
      reportState: evidence.reportState,
    })
      .then(result => {
        if (requestId !== loadRequestId || key !== loadKey) {
          logCommunityWidgetDebug("home slot discarded stale curated widgets result", {
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

        const nextCuratedWidgets = result?.status === "community" ? result.widgets : []
        const complete = result?.complete ?? true
        const preserveCurrentWidgets = shouldPreserveCuratedWidgetView(
          curatedWidgets,
          nextCuratedWidgets,
          curatedWidgetsBaseKey === baseKey,
          complete,
        )

        if (!preserveCurrentWidgets) curatedWidgets = nextCuratedWidgets
        if (complete) {
          clearCurationRetry()
          curationRetryDelay = 1_000
        } else {
          scheduleCurationRetry()
        }
        logCommunityWidgetDebug("home slot loaded curated widgets", {
          slotType,
          communityPubkey,
          key,
          status: result?.status,
          preservedCurrentWidgets: preserveCurrentWidgets,
          widgets: curatedWidgets.map(widget => ({
            id: getWidgetLineId(widget),
            identifier: widget.identifier,
            pubkey: widget.pubkey,
            slot: widget.slot,
            appUrl: widget.appUrl,
          })),
        })
      })
      .catch(error => {
        if (requestId !== loadRequestId || key !== loadKey) return

        scheduleCurationRetry()
        console.warn("[community-home-widgets] Failed to load widgets", error)
        logCommunityWidgetDebug("home slot failed to load curated widgets", {
          slotType,
          communityPubkey,
          key,
          error: error instanceof Error ? error.message : String(error),
        })
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
    clearCurationRetry()
    clearSharedConfigRetry()
    for (const timer of initialWidgetResizeTimers.values()) clearTimeout(timer)
    initialWidgetResizeTimers.clear()
  })
</script>

{#if frameWidgets.length > 0}
  <div class="flex flex-col gap-2">
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
