<script lang="ts">
  import {onDestroy} from "svelte"
  import {readable, type Readable} from "svelte/store"
  import {page} from "$app/stores"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {max, partition, pushToMapKey, sortBy, spec} from "@welshman/lib"
  import {
    COMMENT,
    ZAP_GOAL,
    getTagValue,
    matchFilters,
    type Filter,
    type TrustedEvent,
  } from "@welshman/util"
  import NotesMinimalistic from "@assets/icons/notes-minimalistic.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import GoalItem from "@app/components/GoalItem.svelte"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityAuthorityReadiness,
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityPublishRelays,
    activeCommunityReportState,
    activeCommunityRelays,
    hasCommunityHydrationCompleted,
    markCommunityHydrationCompleted,
    type CommunityHydrationStatus,
  } from "@app/core/community-state"
  import {
    makeCommunityContentFilterPlan,
    makeCommunityTargetingFilter,
    makeTargetedPublicationOriginalFilterPlan,
    makeTargetedPublicationOriginalRelayHintPlans,
  } from "@app/core/community-feeds"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    filterAuthorizedCommunityTargetingEvents,
    getCommunityWriteTargetSectionName,
    getCommunityTargetWriterPubkeys,
  } from "@app/core/community-permissions"
  import {isCommunityPersonBanned} from "@app/core/community-reports"
  import {loadBoundedCommunityHistory, makeFeed} from "@app/core/requests"
  import {publicationOperations} from "@app/core/publication-operations"
  import {projectAuthoredPublicationEvents} from "@app/core/authored-publication-operations"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
  import {setChecked} from "@app/util/notifications"
  import {makeCommunityGoalPath, parseCommunityRouteParam} from "@app/util/routes"

  const REQUEST_HARD_TIMEOUT_MS = 10_000

  let loadingTargets = $state(false)
  let targetLoadStatus = $state<CommunityHydrationStatus>("idle")
  let loadingHintedOriginals = $state(false)
  let hintedOriginalLoadStatus = $state<CommunityHydrationStatus>("idle")
  let loadingEvents = $state(false)
  let feedLoadStatus = $state<CommunityHydrationStatus>("idle")
  let emptyStateSettled = $state(false)
  let exhaustedEvents = $state(false)
  let element: HTMLElement | undefined = $state()
  let events: Readable<TrustedEvent[]> = $state(readable([]))
  let feedCleanup: (() => void) | undefined = $state()
  let feedInitialized = $state(false)
  let emptyStateSettleTimer: ReturnType<typeof setTimeout> | undefined
  let lastFeedKey = ""
  let historicalLoadRetryVersion = $state(0)

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const goalsPath = $derived(
    communityPubkey ? makeCommunityGoalPath(communityPubkey) : $page.url.pathname,
  )
  const createPath = $derived(
    communityPubkey ? makeCommunityGoalPath(communityPubkey, "create") : "",
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
  const goalSectionName = $derived(
    getCommunityWriteTargetSectionName(
      communityAuthorityReady ? $activeCommunityDefinition : undefined,
      COMMUNITY_WRITE_TARGETS.goal,
    ),
  )
  const targetingFilters = $derived(
    communityAuthorityReady && communityPubkey
      ? [makeCommunityTargetingFilter(communityPubkey, [ZAP_GOAL])]
      : [],
  )
  const goalAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.goal,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const targetingFilterPlan = $derived(
    communityAuthorityReady
      ? makeCommunityContentFilterPlan(targetingFilters, goalAuthorPubkeys)
      : {relayFilters: [], localFilters: []},
  )
  const targetingEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: targetingFilterPlan.localFilters})),
  )
  const authorizedTargetingEvents = $derived.by(() =>
    communityAuthorityReady && $activeCommunityDefinition
      ? filterAuthorizedCommunityTargetingEvents({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          events: $targetingEvents,
          reportState: $activeCommunityReportState,
          kinds: [ZAP_GOAL],
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
  const targetedGoalFilterPlan = $derived(
    makeTargetedPublicationOriginalFilterPlan(authorizedTargetingEvents),
  )
  const targetedGoalRelayHintPlans = $derived(
    makeTargetedPublicationOriginalRelayHintPlans(authorizedTargetingEvents),
  )
  const targetedGoalEvents = $derived(
    targetedGoalFilterPlan.localFilters.length
      ? deriveEventsAsc(
          deriveEventsById({repository, filters: targetedGoalFilterPlan.localFilters}),
        )
      : readable<TrustedEvent[]>([]),
  )
  const directGoalFilterPlan = $derived(
    communityAuthorityReady && communityPubkey
      ? makeCommunityContentFilterPlan(
          [{kinds: [ZAP_GOAL], "#h": [communityPubkey]}],
          goalAuthorPubkeys,
        )
      : {relayFilters: [], localFilters: []},
  )
  const goalFilterPlan = $derived({
    relayFilters: [...directGoalFilterPlan.relayFilters, ...targetedGoalFilterPlan.relayFilters],
    localFilters: [...directGoalFilterPlan.localFilters, ...targetedGoalFilterPlan.localFilters],
  })
  const commentFilterPlan = $derived(
    communityAuthorityReady && communityPubkey
      ? makeCommunityContentFilterPlan(
          [{kinds: [COMMENT], "#K": [String(ZAP_GOAL)], "#h": [communityPubkey]}],
          commentAuthorPubkeys,
        )
      : {relayFilters: [], localFilters: []},
  )
  const goalFeedFilters = $derived.by<Filter[]>(() => {
    return [...goalFilterPlan.localFilters, ...commentFilterPlan.localFilters]
  })
  const goalFeedRelayFilters = $derived([
    ...goalFilterPlan.relayFilters,
    ...commentFilterPlan.relayFilters,
  ] as Filter[])
  const feedKey = $derived.by(() =>
    communityAuthorityReady &&
    communityPubkey &&
    goalFeedFilters.length &&
    $activeCommunityRelays.length
      ? [
          communityPubkey,
          ...$activeCommunityRelays,
          JSON.stringify(goalFeedFilters),
          ...authorizedTargetingEvents.map(event => event.id),
        ].join("|")
      : "",
  )
  const waitingForFeed = $derived(Boolean(feedKey && !feedInitialized))
  const canReact = $derived(
    Boolean(
      $pubkey &&
      communityAuthorityReady &&
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

  const goalProjection = $derived.by(() =>
    projectAuthoredPublicationEvents({
      events: Array.from(
        new Map([...$events, ...$targetedGoalEvents].map(event => [event.id, event])).values(),
      ),
      operations: $publicationOperations.values(),
      ownerPubkey: $pubkey || "",
      matches: event => matchFilters(goalFeedFilters, event),
    }),
  )
  const items = $derived.by(() => {
    const scores = new Map<string, number[]>()
    const [goals, comments] = partition(
      spec({kind: ZAP_GOAL}),
      goalProjection.events.filter(
        event => !isCommunityPersonBanned($activeCommunityReportState, event.pubkey),
      ),
    )

    for (const comment of comments) {
      const id = getTagValue("E", comment.tags)

      if (id) pushToMapKey(scores, id, comment.created_at)
    }

    return sortBy(event => -max([...(scores.get(event.id) || []), event.created_at]), goals)
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
  }

  const startFeed = (key: string) => {
    if (
      !element ||
      !key ||
      goalFeedFilters.length === 0 ||
      goalFeedRelayFilters.length === 0 ||
      $activeCommunityRelays.length === 0
    )
      return

    const hydrationKey = `goals:feed:${key}`

    loadingEvents = !hasCommunityHydrationCompleted(hydrationKey)
    feedLoadStatus = "loading"
    startEmptyStateSettleTimer()
    exhaustedEvents = false
    lastFeedKey = key
    feedInitialized = true

    const feed = makeFeed({
      element,
      relays: $activeCommunityRelays,
      feedFilters: goalFeedFilters,
      relayFilters: goalFeedRelayFilters,
      subscriptionFilters: goalFeedFilters,
      onInitialLoad: ({complete}) => {
        if (complete) markCommunityHydrationCompleted(hydrationKey)
        loadingEvents = false
        feedLoadStatus = complete ? "complete" : "incomplete"
      },
      onExhausted: () => {
        markCommunityHydrationCompleted(hydrationKey)
        loadingEvents = false
        feedLoadStatus = "complete"
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
      owner: `community-goal-targets:${communityPubkey}`,
      signal: controller.signal,
    })
      .then(result => {
        if (controller.signal.aborted) return
        targetLoadStatus = result.complete ? "complete" : "incomplete"
      })
      .catch(error => {
        if (controller.signal.aborted) return
        console.warn("[community-goals] Failed to load targeting history", error)
        targetLoadStatus = "failed"
      })
      .finally(() => {
        if (!controller.signal.aborted) loadingTargets = false
      })

    return () => controller.abort()
  })

  $effect(() => {
    void historicalLoadRetryVersion
    const plans = targetedGoalRelayHintPlans

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
          owner: `community-goal-target-originals:${communityPubkey}`,
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
        console.warn("[community-goals] Failed to load hinted goal originals", error)
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

  const retryHistoricalLoad = () => {
    if (communityBootstrapFailed || communityAuthorityUnavailable) {
      window.location.reload()
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

  onDestroy(() => {
    resetFeed()
    clearEmptyStateSettleTimer()
    setChecked(goalsPath)
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center">
      <Icon icon={NotesMinimalistic} />
    </div>
  {/snippet}
  {#snippet title()}
    <strong>Goals</strong>
  {/snippet}
  {#snippet action()}
    <div class="row-2">
      <PublishGate
        target={COMMUNITY_WRITE_TARGETS.goal}
        action="publish goals"
        href={createPath}
        class="btn btn-primary btn-sm">
        <Icon icon={NotesMinimalistic} />
        Create
      </PublishGate>
      <CommunityMenuButton community={communityPubkey} />
    </div>
  {/snippet}
</PageBar>

<PageContent bind:element class="flex flex-col gap-2 p-2 pt-4">
  {#if items.length > 0 && (targetLoadStatus === "incomplete" || targetLoadStatus === "failed" || hintedOriginalLoadStatus === "incomplete" || hintedOriginalLoadStatus === "failed" || feedLoadStatus === "incomplete" || feedLoadStatus === "failed")}
    <div class="flex items-center justify-between gap-3 px-2 py-1 text-sm opacity-70">
      <p>Goal history is incomplete; some goals may be missing.</p>
      <button class="btn btn-neutral btn-xs" type="button" onclick={retryHistoricalLoad}
        >Retry</button>
    </div>
  {/if}
  {#each items as event (event.id)}
    <GoalItem
      url={communityPubkey}
      relays={$activeCommunityRelays}
      publishRelays={$activeCommunityPublishRelays}
      scopeH={communityPubkey}
      activityLiveCovered
      communitySectionName={goalSectionName}
      allowedAuthors={commentAuthorPubkeys}
      reactionAllowedAuthors={reactionAuthorPubkeys}
      reportAllowedAuthors={reportAuthorPubkeys}
      readOnly={!canReact}
      operationId={goalProjection.operationIds.get(event.id)}
      event={$state.snapshot(event)} />
  {/each}
  {#if communityBootstrapLoading || communityAuthorityLoading}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading Goals...</Spinner>
    </p>
  {:else if communityBootstrapFailed || communityAuthorityUnavailable}
    <div class="flex flex-col items-center gap-3 py-20 text-center">
      <p>Goals unavailable.</p>
      <button class="btn btn-neutral btn-sm" type="button" onclick={retryHistoricalLoad}
        >Retry</button>
    </div>
  {:else if loadingTargets || loadingHintedOriginals || waitingForFeed || loadingEvents || (!emptyStateSettled && items.length === 0 && targetLoadStatus !== "incomplete" && targetLoadStatus !== "failed" && hintedOriginalLoadStatus !== "incomplete" && hintedOriginalLoadStatus !== "failed" && feedLoadStatus !== "incomplete" && feedLoadStatus !== "failed") || (targetLoadStatus === "idle" && items.length === 0)}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading
        >{!emptyStateSettled &&
        !loadingTargets &&
        !loadingHintedOriginals &&
        !waitingForFeed &&
        !loadingEvents
          ? "Still looking for goals..."
          : "Looking for goals..."}</Spinner>
    </p>
  {:else if items.length === 0 && (targetLoadStatus === "incomplete" || targetLoadStatus === "failed" || hintedOriginalLoadStatus === "incomplete" || hintedOriginalLoadStatus === "failed" || feedLoadStatus === "incomplete" || feedLoadStatus === "failed")}
    <div class="flex flex-col items-center gap-3 py-20 text-center">
      <p>Goal history is incomplete or temporarily unavailable.</p>
      <button class="btn btn-neutral btn-sm" type="button" onclick={retryHistoricalLoad}
        >Retry</button>
    </div>
  {:else if items.length === 0}
    <p class="flex h-10 items-center justify-center py-20 text-center">No goals found.</p>
  {:else if exhaustedEvents}
    <p class="flex h-10 items-center justify-center py-20 text-center">That's all!</p>
  {/if}
</PageContent>
