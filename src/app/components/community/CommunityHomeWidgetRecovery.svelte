<script lang="ts">
  import {onDestroy, onMount} from "svelte"
  import {pubkey, repository} from "@welshman/app"
  import {normalizePubkey} from "@app/core/community"
  import {measurePerformanceDiagnosticsWork} from "@app/core/performance-diagnostics"
  import {getCommunitySectionAuthorityPubkeys} from "@app/core/community-permissions"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
  import {
    activeCommunityAuthorityReadiness,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    activeExactCommunityDefinition,
    activeExactCommunityRelays,
    loadCommunityEventsWithStatus,
  } from "@app/core/community-state"
  import {
    getCommunityWidgetCurationEvidenceKey,
    getLastValidatedCommunityCuratedWidgets,
    loadCachedCommunityCuratedWidgets,
    makeCommunitySharedConfigRecoveryFilter,
    shouldPreserveCuratedWidgetView,
    shouldRetryCommunitySharedConfigRecovery,
  } from "@app/extensions/community-widget-slots"
  import {logCommunityWidgetDebug} from "@app/extensions/community-widget-debug"
  import {
    getCommunitySharedConfigDescriptorKey,
    type CommunitySharedConfigDescriptorAuthority,
  } from "@app/extensions/community-shared-config"
  import type {SmartWidgetEvent} from "@app/extensions/types"
  import type {CommunityHomeWidgetRecoveryStore} from "@app/extensions/community-home-widget-recovery"
  import {emptyCommunityHomeWidgetRecoveryState} from "@app/extensions/community-home-widget-recovery"
  import {makeExactCommunityInputValue} from "@app/util/community-stars"

  type Props = {
    communityAddress: string
    relayHints?: string[]
    ready: boolean
    recoveryStore: CommunityHomeWidgetRecoveryStore
  }

  const {communityAddress, relayHints = [], ready, recoveryStore}: Props = $props()
  const exactDefinition = $derived(
    $activeExactCommunityDefinition?.pointer.address === communityAddress
      ? $activeExactCommunityDefinition
      : undefined,
  )
  const exactCommunity = $derived(
    $activeExactCommunityDefinition?.pointer.address === communityAddress
      ? $activeExactCommunityDefinition.pointer
      : undefined,
  )
  const communityReadinessKey = $derived.by(() => {
    const readiness = $activeCommunityAuthorityReadiness
    return exactDefinition &&
      normalizePubkey(readiness.communityPubkey) === normalizePubkey(exactDefinition.ownerPubkey) &&
      readiness.state === "ready"
      ? JSON.stringify({authorityKey: readiness.key, authorityState: readiness.state})
      : ""
  })
  const curationEvidence = $derived.by(() => {
    const definition = exactDefinition
    const profileListEvents = definition ? $activeCommunityProfileListEvents : []
    const reportState = definition ? $activeCommunityReportState : undefined

    return {
      ready: Boolean(ready && definition && communityReadinessKey),
      key: definition
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
  const sharedConfigAuthority = $derived.by(() => {
    const definition = exactDefinition
    if (!definition) {
      return {
        authorizedPubkeys: new Set<string>(),
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
        normalizePubkey(definition.ownerPubkey),
        ...descriptorAuthorities.flatMap(authority => Array.from(authority.moderatorPubkeys)),
      ]),
      descriptorAuthorities,
    }
  })

  let curatedWidgets = $state<SmartWidgetEvent[]>([])
  let loadedSharedConfigEvents = $state<any[]>([])
  let refreshNonce = $state(0)
  let curatedBaseKey = ""
  let curatedLoadKey = ""
  let curatedRequestId = 0
  let curatedFirstAttemptTerminal = $state(false)
  let curatedFirstAttemptComplete = $state(false)
  let lastEvidenceKey = ""
  let lastReadinessKey = ""
  let forceNextLoad = false
  let lastForcedRefreshAt = 0
  let curationRetryTimer: ReturnType<typeof setTimeout> | undefined
  let curationController: AbortController | undefined
  let curationRetryDelay = 1_000
  let sharedConfigLoadKey = ""
  let sharedConfigRequestId = 0
  let sharedConfigBaseKey = ""
  let sharedConfigFirstAttemptTerminal = $state(false)
  let sharedConfigFirstAttemptComplete = $state(false)
  let sharedConfigRetryTimer: ReturnType<typeof setTimeout> | undefined
  let sharedConfigController: AbortController | undefined
  let sharedConfigRetryDelay = 1_000
  const FORCED_REFRESH_DEBOUNCE_MS = 1_000
  const MAX_RETRY_DELAY_MS = 15_000

  const cachedSharedConfigEvents = $derived.by(() => {
    void refreshNonce
    if (!ready || sharedConfigAuthority.authorizedPubkeys.size === 0) return []
    try {
      return repository.query([
        makeCommunitySharedConfigRecoveryFilter(sharedConfigAuthority.authorizedPubkeys) as any,
      ])
    } catch (error) {
      console.warn("[community-home-widgets] Failed to query cached shared config", error)
      return []
    }
  })
  const sharedConfigEvents = $derived.by(() => {
    const byId = new Map<string, any>()
    for (const event of [...cachedSharedConfigEvents, ...loadedSharedConfigEvents]) {
      const key = event?.id || JSON.stringify(event?.tags || [])
      if (key && !byId.has(key)) byId.set(key, event)
    }
    return Array.from(byId.values())
  })

  const clearCurationRetry = () => {
    if (curationRetryTimer) clearTimeout(curationRetryTimer)
    curationRetryTimer = undefined
  }
  const clearSharedConfigRetry = () => {
    if (sharedConfigRetryTimer) clearTimeout(sharedConfigRetryTimer)
    sharedConfigRetryTimer = undefined
  }
  const refresh = (force = false) => {
    if (force) {
      const now = Date.now()
      if (now - lastForcedRefreshAt < FORCED_REFRESH_DEBOUNCE_MS) return
      lastForcedRefreshAt = now
      forceNextLoad = true
    }
    curatedLoadKey = ""
    sharedConfigLoadKey = ""
    refreshNonce += 1
  }
  const refreshVisible = () => {
    if (document.visibilityState === "visible") refresh(true)
  }
  const scheduleCurationRetry = () => {
    if (curationRetryTimer) return
    curationRetryTimer = setTimeout(() => {
      curationRetryTimer = undefined
      if (document.visibilityState === "visible") refresh(true)
    }, curationRetryDelay)
    curationRetryDelay = Math.min(curationRetryDelay * 2, MAX_RETRY_DELAY_MS)
  }
  const scheduleSharedConfigRetry = () => {
    if (sharedConfigRetryTimer) return
    sharedConfigRetryTimer = setTimeout(() => {
      sharedConfigRetryTimer = undefined
      sharedConfigLoadKey = ""
      refreshNonce += 1
    }, sharedConfigRetryDelay)
    sharedConfigRetryDelay = Math.min(sharedConfigRetryDelay * 2, MAX_RETRY_DELAY_MS)
  }

  $effect(() => {
    void refreshNonce
    const relays = $activeExactCommunityRelays.length ? $activeExactCommunityRelays : relayHints
    const authorizedPubkeys = sharedConfigAuthority.authorizedPubkeys
    const key =
      ready && communityReadinessKey && relays.length > 0 && authorizedPubkeys.size > 0
        ? `${communityAddress}:${relays.join("|")}:${Array.from(authorizedPubkeys).sort().join("|")}:${communityReadinessKey}`
        : ""

    if (!key) {
      sharedConfigController?.abort()
      sharedConfigController = undefined
      clearSharedConfigRetry()
      loadedSharedConfigEvents = []
      sharedConfigLoadKey = ""
      sharedConfigRequestId += 1
      sharedConfigBaseKey = ""
      sharedConfigFirstAttemptTerminal = false
      sharedConfigFirstAttemptComplete = false
      return
    }
    if (key !== sharedConfigBaseKey) {
      sharedConfigBaseKey = key
      sharedConfigFirstAttemptTerminal = false
      sharedConfigFirstAttemptComplete = false
    }
    if (key === sharedConfigLoadKey) return

    clearSharedConfigRetry()
    sharedConfigController?.abort()
    const controller = new AbortController()
    sharedConfigController = controller
    sharedConfigLoadKey = key
    const requestId = ++sharedConfigRequestId
    loadCommunityEventsWithStatus(
      relays,
      [makeCommunitySharedConfigRecoveryFilter(authorizedPubkeys) as any],
      {
        authenticate: true,
        priority: RELAY_REQUEST_PRIORITY.interactive,
        priorityAuthRelays: relayHints,
        settle: "all",
        timeout: 3_000,
        signal: controller.signal,
      },
    )
      .then(result => {
        if (requestId !== sharedConfigRequestId || key !== sharedConfigLoadKey) return
        loadedSharedConfigEvents = result.events
        sharedConfigFirstAttemptTerminal = true
        sharedConfigFirstAttemptComplete = result.complete
        if (shouldRetryCommunitySharedConfigRecovery(result)) scheduleSharedConfigRetry()
        else {
          clearSharedConfigRetry()
          sharedConfigRetryDelay = 1_000
        }
      })
      .catch(error => {
        if (requestId !== sharedConfigRequestId || key !== sharedConfigLoadKey) return
        if (controller.signal.aborted) return
        loadedSharedConfigEvents = []
        sharedConfigFirstAttemptTerminal = true
        sharedConfigFirstAttemptComplete = false
        scheduleSharedConfigRetry()
        console.warn("[community-home-widgets] Failed to load shared config hints", error)
      })
  })

  $effect(() => {
    void refreshNonce
    const input = exactCommunity ? makeExactCommunityInputValue(exactCommunity) : ""
    const evidence = curationEvidence
    const baseKey =
      input && evidence.ready
        ? `${communityAddress}:${normalizePubkey($pubkey || "")}:${relayHints.slice().sort().join(",")}:${evidence.key}`
        : ""
    const key = baseKey ? `${baseKey}:${communityReadinessKey}` : ""

    if (!key || !input) {
      curationController?.abort()
      curationController = undefined
      clearCurationRetry()
      curatedWidgets = []
      curatedBaseKey = ""
      lastReadinessKey = ""
      curatedLoadKey = ""
      curatedRequestId += 1
      curatedFirstAttemptTerminal = false
      curatedFirstAttemptComplete = false
      return
    }

    const evidenceChanged = Boolean(lastEvidenceKey && lastEvidenceKey !== evidence.key)
    if (baseKey !== curatedBaseKey) {
      clearCurationRetry()
      curationRetryDelay = 1_000
      curatedWidgets = evidenceChanged
        ? []
        : getLastValidatedCommunityCuratedWidgets(input, $pubkey || "", evidence.key)
      curatedBaseKey = baseKey
      curatedFirstAttemptTerminal = false
      curatedFirstAttemptComplete = false
      lastReadinessKey = ""
    }
    if (key === curatedLoadKey) return

    curatedLoadKey = key
    const readinessChanged = Boolean(lastReadinessKey && lastReadinessKey !== communityReadinessKey)
    lastReadinessKey = communityReadinessKey
    lastEvidenceKey = evidence.key
    const force = forceNextLoad || readinessChanged || evidenceChanged
    forceNextLoad = false
    const requestId = ++curatedRequestId
    curationController?.abort()
    const controller = new AbortController()
    curationController = controller

    logCommunityWidgetDebug("home loading curated widgets", {input, key, force})
    loadCachedCommunityCuratedWidgets(input, {
      evidenceKey: evidence.key,
      force,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      profileListEvents: evidence.profileListEvents,
      reportState: evidence.reportState,
      signal: controller.signal,
      onWidgets: nextWidgets => {
        if (
          controller.signal.aborted ||
          requestId !== curatedRequestId ||
          key !== curatedLoadKey ||
          nextWidgets.length === 0
        ) {
          return
        }
        curatedWidgets = nextWidgets
      },
    })
      .then(result => {
        if (requestId !== curatedRequestId || key !== curatedLoadKey) return
        const nextWidgets = result?.status === "community" ? result.widgets : []
        curatedFirstAttemptTerminal = true
        curatedFirstAttemptComplete = result?.complete ?? true
        if (
          !shouldPreserveCuratedWidgetView(
            curatedWidgets,
            nextWidgets,
            curatedBaseKey === baseKey,
            result?.complete ?? true,
          )
        ) {
          curatedWidgets = nextWidgets
        }
        if (result?.complete ?? true) {
          clearCurationRetry()
          curationRetryDelay = 1_000
        } else scheduleCurationRetry()
      })
      .catch(error => {
        if (requestId !== curatedRequestId || key !== curatedLoadKey) return
        if (controller.signal.aborted || error?.name === "AbortError") return
        curatedLoadKey = ""
        curatedFirstAttemptTerminal = true
        curatedFirstAttemptComplete = false
        scheduleCurationRetry()
        console.warn("[community-home-widgets] Failed to load widgets", error)
      })
  })

  $effect(() => {
    measurePerformanceDiagnosticsWork(
      {
        owner: "widget-recovery",
        phase: "reactive-commit",
        detail: {
          curatedWidgets: ready ? curatedWidgets.length : 0,
          sharedConfigEvents: ready ? sharedConfigEvents.length : 0,
        },
      },
      () =>
        recoveryStore.set({
          communityAddress: ready ? communityAddress : "",
          curatedWidgets: ready ? curatedWidgets : [],
          sharedConfigEvents: ready ? sharedConfigEvents : [],
          authorizedPubkeys: ready ? sharedConfigAuthority.authorizedPubkeys : new Set(),
          descriptorAuthorities: ready ? sharedConfigAuthority.descriptorAuthorities : [],
          curatedFirstAttemptTerminal: ready && curatedFirstAttemptTerminal,
          curatedFirstAttemptComplete: ready && curatedFirstAttemptComplete,
          sharedConfigFirstAttemptTerminal: ready && sharedConfigFirstAttemptTerminal,
          sharedConfigFirstAttemptComplete: ready && sharedConfigFirstAttemptComplete,
        }),
    )
  })

  onMount(() => {
    const forceRefresh = () => refresh(true)
    window.addEventListener("pageshow", forceRefresh)
    window.addEventListener("focus", forceRefresh)
    window.addEventListener("online", forceRefresh)
    document.addEventListener("visibilitychange", refreshVisible)
    return () => {
      window.removeEventListener("pageshow", forceRefresh)
      window.removeEventListener("focus", forceRefresh)
      window.removeEventListener("online", forceRefresh)
      document.removeEventListener("visibilitychange", refreshVisible)
    }
  })

  onDestroy(() => {
    curationController?.abort()
    sharedConfigController?.abort()
    curatedRequestId += 1
    sharedConfigRequestId += 1
    clearCurationRetry()
    clearSharedConfigRetry()
    recoveryStore.set(emptyCommunityHomeWidgetRecoveryState())
  })
</script>
