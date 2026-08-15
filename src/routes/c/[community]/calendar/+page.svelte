<script lang="ts">
  import {onDestroy} from "svelte"
  import {readable, type Readable} from "svelte/store"
  import {page} from "$app/stores"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {formatTimestampAsDate, last, now} from "@welshman/lib"
  import {matchFilters, type Filter, type TrustedEvent} from "@welshman/util"
  import CalendarMinimalistic from "@assets/icons/calendar-minimalistic.svg?dataurl"
  import CalendarAdd from "@assets/icons/calendar-add.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Divider from "@lib/components/Divider.svelte"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import CalendarEventItem from "@app/components/CalendarEventItem.svelte"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityAuthorityReadiness,
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityPublishRelays,
    activeCommunityReportState,
    activeCommunityRelays,
    activeCommunitySession,
    getUserOutboxRelays,
    hasCommunityHydrationCompleted,
    makeCommunitySession,
    markCommunityHydrationCompleted,
    recoverCommunityBootstrap,
    type CommunityHydrationStatus,
  } from "@app/core/community-state"
  import {normalizeRelays} from "@app/core/community"
  import {
    CALENDAR_EVENT_KINDS,
    getCalendarEventRange,
    isCalendarEventKind,
  } from "@app/core/calendar-events"
  import {
    makeCommunityContentFilterPlan,
    makeCommunityTargetingFilter,
    makeTargetedPublicationOriginalFilterPlan,
    makeTargetedPublicationOriginalRelayHintPlans,
  } from "@app/core/community-feeds"
  import {
    COMMUNITY_CALENDAR_WRITE_TARGETS,
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    filterAuthorizedCommunityTargetingEvents,
    getCommunityCalendarTargetWriterPubkeys,
    getCommunityCalendarWriteTargetSectionName,
    getCommunityTargetWriterPubkeys,
  } from "@app/core/community-permissions"
  import {isCommunityPersonBanned} from "@app/core/community-reports"
  import {loadBoundedCommunityHistory, makeCalendarFeed} from "@app/core/requests"
  import {publicationOperations} from "@app/core/publication-operations"
  import {projectAuthoredPublicationEvents} from "@app/core/authored-publication-operations"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
  import {setChecked} from "@app/util/notifications"
  import {makeCommunityCalendarPath, parseCommunityRouteParam} from "@app/util/routes"

  const REQUEST_HARD_TIMEOUT_MS = 10_000

  type CalendarItem = {
    event: TrustedEvent
    dateDisplay?: string
    isFirstFutureEvent?: boolean
  }

  let element: HTMLElement | undefined = $state()
  let loadingTargets = $state(false)
  let targetLoadStatus = $state<CommunityHydrationStatus>("idle")
  let loadingHintedOriginals = $state(false)
  let hintedOriginalLoadStatus = $state<CommunityHydrationStatus>("idle")
  let loadingEvents = $state(false)
  let feedLoadStatus = $state<CommunityHydrationStatus>("idle")
  let emptyStateSettled = $state(false)
  let exhaustedEvents = $state(false)
  let events: Readable<TrustedEvent[]> = $state(readable([]))
  let feedCleanup: (() => void) | undefined = $state()
  let feedInitialized = $state(false)
  let emptyStateSettleTimer: ReturnType<typeof setTimeout> | undefined
  let lastFeedKey = ""
  let previousScrollHeight = 0
  let previousFirstEventId = ""
  let initialScrollDone = false
  let historicalLoadRetryVersion = $state(0)
  let retryingCommunityAccess = $state(false)

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const calendarPath = $derived(
    communityPubkey ? makeCommunityCalendarPath(communityPubkey) : $page.url.pathname,
  )
  const createPath = $derived(
    communityPubkey ? makeCommunityCalendarPath(communityPubkey, "create") : "",
  )
  const calendarEditPublishRelays = $derived(
    normalizeRelays([...getUserOutboxRelays(), ...$activeCommunityPublishRelays]),
  )
  const communityBootstrapReady = $derived(
    Boolean(
      communityPubkey &&
      $activeCommunityDefinition?.pubkey === communityPubkey &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading,
    ),
  )
  const communityBootstrapLoading = $derived(
    Boolean(communityPubkey && !communityBootstrapReady && !$activeCommunityBootstrapStatus.error),
  )
  const communityAuthorityReadiness = $derived(
    $activeCommunityAuthorityReadiness.communityPubkey === communityPubkey
      ? $activeCommunityAuthorityReadiness.state
      : "loading",
  )
  const communityAuthorityLoading = $derived(
    communityBootstrapReady && communityAuthorityReadiness === "loading",
  )
  const communityAuthorityReady = $derived(
    communityBootstrapReady && communityAuthorityReadiness === "ready",
  )
  const communityAuthorityUnavailable = $derived(communityAuthorityReadiness === "unavailable")
  const communityBootstrapFailed = $derived(
    Boolean(communityPubkey && !communityBootstrapReady && $activeCommunityBootstrapStatus.error),
  )
  const getCalendarEventSectionName = (_kind: number) =>
    getCommunityCalendarWriteTargetSectionName(
      communityAuthorityReady ? $activeCommunityDefinition : undefined,
    )
  const calendarWriterPubkeys = $derived(
    communityAuthorityReady && $activeCommunityDefinition
      ? getCommunityCalendarTargetWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const targetingFilterPlan = $derived.by(() => {
    const relayFilters: Filter[] = []
    const localFilters: Filter[] = []
    if (!communityAuthorityReady || !communityPubkey) return {relayFilters, localFilters}

    for (const target of COMMUNITY_CALENDAR_WRITE_TARGETS) {
      const plan = makeCommunityContentFilterPlan(
        [makeCommunityTargetingFilter(communityPubkey, [target.kind])],
        calendarWriterPubkeys,
      )
      relayFilters.push(...plan.relayFilters)
      localFilters.push(...plan.localFilters)
    }

    return {relayFilters, localFilters}
  })
  const targetingFilters = $derived(targetingFilterPlan.localFilters)
  const targetingEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: targetingFilters})),
  )
  const authorizedTargetingEvents = $derived.by(() =>
    communityAuthorityReady && $activeCommunityDefinition
      ? filterAuthorizedCommunityTargetingEvents({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          events: $targetingEvents,
          reportState: $activeCommunityReportState,
          kinds: CALENDAR_EVENT_KINDS,
        })
      : [],
  )
  const commentAuthorPubkeys = $derived(
    communityAuthorityReady && $activeCommunityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.comment,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const reactionAuthorPubkeys = $derived(
    communityAuthorityReady && $activeCommunityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.reaction,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const reportAuthorPubkeys = $derived(
    communityAuthorityReady && $activeCommunityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.report,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const targetedOriginalFilterPlan = $derived(
    makeTargetedPublicationOriginalFilterPlan(authorizedTargetingEvents),
  )
  const targetedOriginalRelayHintPlans = $derived(
    makeTargetedPublicationOriginalRelayHintPlans(authorizedTargetingEvents),
  )
  const targetedOriginalEvents = $derived(
    targetedOriginalFilterPlan.localFilters.length
      ? deriveEventsAsc(
          deriveEventsById({repository, filters: targetedOriginalFilterPlan.localFilters}),
        )
      : readable<TrustedEvent[]>([]),
  )
  const directCalendarFilterPlan = $derived.by(() => {
    const relayFilters: Filter[] = []
    const localFilters: Filter[] = []
    if (!communityAuthorityReady || !communityPubkey) return {relayFilters, localFilters}

    for (const target of COMMUNITY_CALENDAR_WRITE_TARGETS) {
      const plan = makeCommunityContentFilterPlan(
        [{kinds: [target.kind], "#h": [communityPubkey]}],
        calendarWriterPubkeys,
      )
      relayFilters.push(...plan.relayFilters)
      localFilters.push(...plan.localFilters)
    }

    return {relayFilters, localFilters}
  })
  const calendarFeedFilters = $derived([
    ...directCalendarFilterPlan.localFilters,
    ...targetedOriginalFilterPlan.localFilters,
  ] as Filter[])
  const calendarFeedRelayFilters = $derived([
    ...directCalendarFilterPlan.relayFilters,
    ...targetedOriginalFilterPlan.relayFilters,
  ] as Filter[])
  const feedKey = $derived.by(() =>
    communityAuthorityReady &&
    communityPubkey &&
    calendarFeedFilters.length &&
    $activeCommunityRelays.length
      ? [
          communityPubkey,
          ...$activeCommunityRelays,
          JSON.stringify(calendarFeedFilters),
          ...authorizedTargetingEvents.map(event => event.id),
        ].join("|")
      : "",
  )
  const waitingForFeed = $derived(Boolean(feedKey && !feedInitialized))
  const canReact = $derived(
    Boolean(
      $pubkey &&
      communityAuthorityReady &&
      $activeCommunityPublishRelays.length > 0 &&
      $activeCommunityDefinition &&
      canWriteCommunityTarget({
        definition: $activeCommunityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.reaction,
        reportState: $activeCommunityReportState,
      }),
    ),
  )

  const getRange = (event: TrustedEvent) => getCalendarEventRange(event)
  const isActiveOrFutureEvent = (event: TrustedEvent) => {
    const range = getRange(event)

    return Boolean(range && (range.end ?? range.start) >= now())
  }

  const calendarProjection = $derived.by(() =>
    projectAuthoredPublicationEvents({
      events: Array.from(
        new Map([...$events, ...$targetedOriginalEvents].map(event => [event.id, event])).values(),
      ),
      operations: $publicationOperations.values(),
      ownerPubkey: $pubkey || "",
      matches: event => isCalendarEventKind(event.kind) && matchFilters(calendarFeedFilters, event),
    }),
  )
  const projectedCalendarEvents = $derived.by(() =>
    calendarProjection.events.toSorted(
      (a, b) =>
        (getCalendarEventRange(a)?.start ?? Number.POSITIVE_INFINITY) -
        (getCalendarEventRange(b)?.start ?? Number.POSITIVE_INFINITY),
    ),
  )
  const items = $derived.by(() => {
    let haveSeenFutureEvent = false
    let previousDateDisplay: string | undefined

    return projectedCalendarEvents
      .filter(event => !isCommunityPersonBanned($activeCommunityReportState, event.pubkey))
      .filter(event => Boolean(getRange(event)))
      .map<CalendarItem>(event => {
        const range = getRange(event)!
        const dateDisplayValue = formatTimestampAsDate(range.start)
        const dateDisplay = previousDateDisplay === dateDisplayValue ? undefined : dateDisplayValue
        const isFutureEvent = isActiveOrFutureEvent(event)
        const isFirstFutureEvent = !haveSeenFutureEvent && isFutureEvent

        previousDateDisplay = dateDisplayValue
        if (isFutureEvent) haveSeenFutureEvent = true

        return {event, dateDisplay, isFirstFutureEvent}
      })
  })

  const clearEmptyStateSettleTimer = () => {
    if (!emptyStateSettleTimer) return

    clearTimeout(emptyStateSettleTimer)
    emptyStateSettleTimer = undefined
  }

  const startEmptyStateSettleTimer = () => {
    clearEmptyStateSettleTimer()
    emptyStateSettled = false
    emptyStateSettleTimer = setTimeout(() => {
      emptyStateSettleTimer = undefined
      emptyStateSettled = true
    }, REQUEST_HARD_TIMEOUT_MS)
  }

  const resetFeed = () => {
    feedCleanup?.()
    feedCleanup = undefined
    events = readable([])
    loadingEvents = false
    feedLoadStatus = "idle"
    emptyStateSettled = false
    exhaustedEvents = false
    feedInitialized = false
    lastFeedKey = ""
    previousScrollHeight = 0
    previousFirstEventId = ""
    initialScrollDone = false
  }

  const startFeed = (key: string) => {
    if (
      !element ||
      !key ||
      calendarFeedFilters.length === 0 ||
      calendarFeedRelayFilters.length === 0 ||
      $activeCommunityRelays.length === 0
    )
      return

    const hydrationKey = `calendar:feed:${key}`

    loadingEvents = !hasCommunityHydrationCompleted(hydrationKey)
    feedLoadStatus = "loading"
    startEmptyStateSettleTimer()
    exhaustedEvents = false
    lastFeedKey = key
    feedInitialized = true

    const feed = makeCalendarFeed({
      element,
      relays: $activeCommunityRelays,
      filters: calendarFeedFilters,
      relayFilters: calendarFeedRelayFilters,
      onInitialLoad: ({complete}) => {
        if (complete) markCommunityHydrationCompleted(hydrationKey)
        loadingEvents = false
        feedLoadStatus = complete ? "complete" : "incomplete"
      },
      onIncomplete: () => {
        feedLoadStatus = "incomplete"
      },
      onExhausted: () => {
        if (feedLoadStatus !== "incomplete") markCommunityHydrationCompleted(hydrationKey)
        loadingEvents = false
        if (feedLoadStatus !== "incomplete") feedLoadStatus = "complete"
        emptyStateSettled = true
        clearEmptyStateSettleTimer()
        exhaustedEvents = true
      },
    })

    events = feed.events
    feedCleanup = feed.cleanup
  }

  $effect(() => {
    void historicalLoadRetryVersion
    const relays = $activeCommunityRelays
    const relayFilters = targetingFilterPlan.relayFilters
    const localFilters = targetingFilterPlan.localFilters

    if (!communityBootstrapReady || !communityPubkey) {
      loadingTargets = false
      targetLoadStatus = "idle"
      emptyStateSettled = false
      clearEmptyStateSettleTimer()
      return
    }
    if (relayFilters.length === 0 || localFilters.length === 0) {
      loadingTargets = false
      targetLoadStatus = "complete"
      return
    }
    if (relays.length === 0) {
      loadingTargets = false
      targetLoadStatus = "incomplete"
      return
    }

    const controller = new AbortController()

    loadingTargets = true
    targetLoadStatus = "loading"
    startEmptyStateSettleTimer()
    void loadBoundedCommunityHistory({
      relays,
      relayFilters,
      localFilters,
      timeoutMs: REQUEST_HARD_TIMEOUT_MS,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      owner: `community-calendar-targets:${communityPubkey}`,
      signal: controller.signal,
    })
      .then(result => {
        if (controller.signal.aborted) return
        targetLoadStatus = result.complete ? "complete" : "incomplete"
      })
      .catch(error => {
        if (controller.signal.aborted) return
        console.warn("[community-calendar] Failed to load targeting history", error)
        targetLoadStatus = "failed"
      })
      .finally(() => {
        if (!controller.signal.aborted) loadingTargets = false
      })

    return () => controller.abort()
  })

  $effect(() => {
    void historicalLoadRetryVersion
    const plans = targetedOriginalRelayHintPlans

    if (!communityBootstrapReady) {
      loadingHintedOriginals = false
      hintedOriginalLoadStatus = "idle"
      return
    }
    if (plans.length === 0) {
      loadingHintedOriginals = false
      hintedOriginalLoadStatus = "complete"
      return
    }

    const controller = new AbortController()
    loadingHintedOriginals = true
    hintedOriginalLoadStatus = "loading"
    void Promise.all(
      plans.map(plan =>
        loadBoundedCommunityHistory({
          ...plan,
          timeoutMs: REQUEST_HARD_TIMEOUT_MS,
          priority: RELAY_REQUEST_PRIORITY.interactive,
          owner: `community-calendar-target-originals:${communityPubkey}`,
          signal: controller.signal,
        }),
      ),
    )
      .then(results => {
        if (controller.signal.aborted) return
        hintedOriginalLoadStatus = results.every(result => result.complete)
          ? "complete"
          : "incomplete"
      })
      .catch(error => {
        if (controller.signal.aborted) return
        console.warn("[community-calendar] Failed to load hinted event originals", error)
        hintedOriginalLoadStatus = "failed"
      })
      .finally(() => {
        if (!controller.signal.aborted) loadingHintedOriginals = false
      })

    return () => controller.abort()
  })

  $effect(() => {
    const key = feedKey

    if (!key || !element) {
      resetFeed()
      return
    }

    if (!feedInitialized || key !== lastFeedKey) {
      resetFeed()
      startFeed(key)
    }
  })

  const retryHistoricalLoad = async () => {
    if (communityBootstrapFailed || communityAuthorityUnavailable) {
      const session =
        $activeCommunitySession ||
        (parsedCommunity
          ? makeCommunitySession(parsedCommunity, $activeCommunityDefinition)
          : undefined)
      if (!session || retryingCommunityAccess) return

      retryingCommunityAccess = true
      try {
        await recoverCommunityBootstrap(session, {recoverAuth: true})
      } catch (error) {
        console.warn("[community-calendar] Failed to recover community access", error)
      } finally {
        retryingCommunityAccess = false
      }
      return
    }

    historicalLoadRetryVersion += 1
    resetFeed()
  }

  $effect(() => {
    if (items.length === 0) return

    emptyStateSettled = true
    clearEmptyStateSettleTimer()
  })

  $effect(() => {
    if (!element || items.length === 0) return

    requestAnimationFrame(() => {
      if (!element || items.length === 0) return

      if (initialScrollDone) {
        if (previousFirstEventId && items[0].event.id !== previousFirstEventId) {
          const delta = element.scrollHeight - previousScrollHeight

          if (delta > 0) element.scrollTop += delta
        }
      } else {
        const firstFutureItem = items.find(({event}) => isActiveOrFutureEvent(event)) || last(items)
        const eventElement = firstFutureItem
          ? (document.querySelector(`.calendar-event-${firstFutureItem.event.id}`) as HTMLElement)
          : undefined

        if (eventElement) {
          element.scrollTop =
            eventElement.offsetTop - element.clientHeight / 2 + eventElement.clientHeight / 2
        }

        initialScrollDone = true
      }

      previousScrollHeight = element.scrollHeight
      previousFirstEventId = items[0].event.id
    })
  })

  onDestroy(() => {
    resetFeed()
    clearEmptyStateSettleTimer()
    setChecked(calendarPath)
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center">
      <Icon icon={CalendarMinimalistic} />
    </div>
  {/snippet}
  {#snippet title()}
    <strong>Calendar</strong>
  {/snippet}
  {#snippet action()}
    <div class="row-2">
      <PublishGate
        target={COMMUNITY_WRITE_TARGETS.calendar}
        alternateTargets={COMMUNITY_CALENDAR_WRITE_TARGETS}
        action="publish calendar events"
        href={createPath}
        class="btn btn-primary btn-sm">
        <Icon icon={CalendarAdd} />
        Create
      </PublishGate>
      <CommunityMenuButton community={communityPubkey} />
    </div>
  {/snippet}
</PageBar>

<PageContent bind:element class="flex flex-col gap-2 p-2 pt-4">
  {#each items as { event, dateDisplay, isFirstFutureEvent } (event.id)}
    <div class={"calendar-event-" + event.id}>
      {#if isFirstFutureEvent}
        <div class="flex items-center gap-2 p-2">
          <div class="h-px flex-grow bg-primary"></div>
          <p class="text-xs uppercase text-primary">Today</p>
          <div class="h-px flex-grow bg-primary"></div>
        </div>
      {/if}
      {#if dateDisplay}
        <Divider>{dateDisplay}</Divider>
      {/if}
      <CalendarEventItem
        url={communityPubkey}
        relays={$activeCommunityRelays}
        publishRelays={calendarEditPublishRelays}
        reactionRelays={$activeCommunityPublishRelays}
        scopeH={communityPubkey}
        activityLiveCovered
        communitySectionName={getCalendarEventSectionName(event.kind)}
        allowedAuthors={commentAuthorPubkeys}
        reactionAllowedAuthors={reactionAuthorPubkeys}
        reportAllowedAuthors={reportAuthorPubkeys}
        readOnly={!canReact}
        operationId={calendarProjection.operationIds.get(event.id)}
        {event} />
    </div>
  {/each}
  {#if communityBootstrapLoading || communityAuthorityLoading}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading Calendar...</Spinner>
    </p>
  {:else if communityBootstrapFailed || communityAuthorityUnavailable}
    <div class="flex flex-col items-center gap-3 py-20 text-center">
      <p>Calendar unavailable.</p>
      <button
        class="btn btn-neutral btn-sm"
        type="button"
        disabled={retryingCommunityAccess}
        onclick={retryHistoricalLoad}>{retryingCommunityAccess ? "Retrying..." : "Retry"}</button>
    </div>
  {:else if loadingTargets || loadingHintedOriginals || waitingForFeed || loadingEvents || (!emptyStateSettled && items.length === 0 && targetLoadStatus !== "incomplete" && targetLoadStatus !== "failed" && hintedOriginalLoadStatus !== "incomplete" && hintedOriginalLoadStatus !== "failed" && feedLoadStatus !== "incomplete" && feedLoadStatus !== "failed") || (targetLoadStatus === "idle" && items.length === 0)}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading
        >{!emptyStateSettled &&
        !loadingTargets &&
        !loadingHintedOriginals &&
        !waitingForFeed &&
        !loadingEvents
          ? "Still looking for events..."
          : "Looking for events..."}</Spinner>
    </p>
  {:else if items.length === 0}
    <p class="flex h-10 items-center justify-center py-20 text-center">No events found.</p>
  {:else if exhaustedEvents}
    <p class="flex h-10 items-center justify-center py-20 text-center">That's all!</p>
  {/if}
</PageContent>
