<script lang="ts">
  import {onDestroy, tick} from "svelte"
  import {page} from "$app/stores"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {sortBy} from "@welshman/lib"
  import {
    COMMENT,
    ZAP_GOAL,
    getTagValue,
    matchFilters,
    type EventContent,
    type Filter,
    type TrustedEvent,
  } from "@welshman/util"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import Reply from "@assets/icons/reply-2.svg?dataurl"
  import SortVertical from "@assets/icons/sort-vertical.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Button from "@lib/components/Button.svelte"
  import {scrollToEvent} from "@lib/html"
  import Content from "@app/components/Content.svelte"
  import ChannelMessage from "@app/components/ChannelMessage.svelte"
  import NoteCard from "@app/components/NoteCard.svelte"
  import RoomCompose from "@app/components/RoomCompose.svelte"
  import RoomComposeEdit from "@app/components/RoomComposeEdit.svelte"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import ModeratedContent from "@app/components/community/ModeratedContent.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import GoalSummary from "@app/components/GoalSummary.svelte"
  import GoalActions from "@app/components/GoalActions.svelte"
  import PublicationStatus from "@app/components/PublicationStatus.svelte"
  import {makeComment} from "@app/core/commands"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityAuthorityReadiness,
    activeExactCommunityDefinition,
    activeCommunityProfileListEvents,
    activeExactCommunityRelays,
    activeCommunityReportState,
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
    filterAuthorizedLegacyCommunityTargetingEvents,
    getCommunityWriteTargetSectionName,
    getCommunityTargetWriterPubkeys,
  } from "@app/core/community-permissions"
  import {
    getCommunityCensorReason,
    getCommunityReportEventAddress,
    isCommunityPersonBanned,
  } from "@app/core/community-reports"
  import {
    canEditReplyEvent,
    editedTargetIds,
    filterVisibleAfterDeletesAndEdits,
  } from "@app/core/event-edits"
  import {publishEditedReply} from "@app/core/event-edit-publish"
  import {publicationOperations, startPublication} from "@app/core/publication-operations"
  import {projectAuthoredPublicationEvents} from "@app/core/authored-publication-operations"
  import {
    makeLegacyCommunityTargetingFilter,
    makeLegacyTargetedPublicationOriginalFilterPlan,
    makeLegacyTargetedPublicationOriginalRelayHintPlans,
  } from "@app/core/community-targeting-legacy"
  import {setChecked} from "@app/util/notifications"
  import {pushToast} from "@app/util/toast"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
  import {loadBoundedCommunityHistory} from "@app/core/requests"
  import {makeExactCommunityGoalPath, parseExactCommunityRouteParam} from "@app/util/routes"

  const REQUEST_HARD_TIMEOUT_MS = 10_000

  let loadingGoal = $state(false)
  let goalLoadStatus = $state<CommunityHydrationStatus>("idle")
  let loadingTargeting = $state(false)
  let targetLoadStatus = $state<CommunityHydrationStatus>("idle")
  let loadingHintedOriginals = $state(false)
  let hintedOriginalLoadStatus = $state<CommunityHydrationStatus>("idle")
  let loadingReplies = $state(false)
  let replyLoadStatus = $state<CommunityHydrationStatus>("idle")
  let historicalLoadRetryVersion = $state(0)
  let showReply = $state(false)
  let showAllReplies = $state(false)
  let eventToEdit: TrustedEvent | undefined = $state()
  let compose: RoomCompose | undefined = $state()
  let composeElement: HTMLElement | undefined = $state()
  let hashTargetRequest = 0
  let hashTarget = $state({id: "", request: 0})
  let revealedHashTargetKey = ""

  const routeCommunity = $derived(parseExactCommunityRouteParam($page.params.community))
  const communityOwnerPubkey = $derived(routeCommunity?.ownerPubkey || "")
  const communityId = $derived(routeCommunity?.communityId || "")
  const communityAddress = $derived(routeCommunity?.address || "")
  const communityDefinition = $derived(
    $activeExactCommunityDefinition?.pointer.address === communityAddress
      ? $activeExactCommunityDefinition
      : undefined,
  )
  const goalId = $derived($page.params.goal || "")
  const goalsPath = $derived(
    routeCommunity ? makeExactCommunityGoalPath(routeCommunity) : $page.url.pathname,
  )
  const goalPath = $derived(
    routeCommunity && goalId ? makeExactCommunityGoalPath(routeCommunity, goalId) : goalsPath,
  )
  const communityBootstrapReady = $derived(
    Boolean(
      communityAddress &&
      communityDefinition &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading,
    ),
  )
  const communityBootstrapLoading = $derived(
    Boolean(communityAddress && !communityBootstrapReady && !$activeCommunityBootstrapStatus.error),
  )
  const communityAuthorityReadiness = $derived(
    $activeCommunityAuthorityReadiness.communityPubkey === communityOwnerPubkey
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
    Boolean(communityAddress && !communityBootstrapReady && $activeCommunityBootstrapStatus.error),
  )
  const goalSectionName = $derived(
    getCommunityWriteTargetSectionName(
      communityAuthorityReady ? communityDefinition : undefined,
      COMMUNITY_WRITE_TARGETS.goal,
    ),
  )
  const commentSectionName = $derived(
    getCommunityWriteTargetSectionName(
      communityAuthorityReady ? communityDefinition : undefined,
      COMMUNITY_WRITE_TARGETS.comment,
    ),
  )
  const commentAccessMessage = $derived(`Request ${commentSectionName} access to comment.`)
  const goalAuthorPubkeys = $derived(
    communityAuthorityReady && communityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.goal,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const commentAuthorPubkeys = $derived(
    communityAuthorityReady && communityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.comment,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const reactionAuthorPubkeys = $derived(
    communityAuthorityReady && communityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.reaction,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const reportAuthorPubkeys = $derived(
    communityAuthorityReady && communityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.report,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const targetingFilters = $derived<Filter[]>(
    communityAuthorityReady && routeCommunity
      ? [
          makeCommunityTargetingFilter(communityId, [ZAP_GOAL]),
          ...(communityOwnerPubkey === communityId
            ? [makeLegacyCommunityTargetingFilter(communityId, [ZAP_GOAL])]
            : []),
        ]
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
    communityAuthorityReady && communityDefinition && routeCommunity
      ? filterAuthorizedCommunityTargetingEvents({
          community: routeCommunity,
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          events: $targetingEvents,
          reportState: $activeCommunityReportState,
          kinds: [ZAP_GOAL],
        })
      : [],
  )
  const authorizedLegacyTargetingEvents = $derived.by(() =>
    communityAuthorityReady && communityDefinition && routeCommunity
      ? filterAuthorizedLegacyCommunityTargetingEvents({
          community: routeCommunity,
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          events: $targetingEvents,
          reportState: $activeCommunityReportState,
          kinds: [ZAP_GOAL],
        })
      : [],
  )
  const targetedGoalFilterPlan = $derived.by(() => {
    const current = makeTargetedPublicationOriginalFilterPlan(authorizedTargetingEvents)
    const legacy = makeLegacyTargetedPublicationOriginalFilterPlan(authorizedLegacyTargetingEvents)

    return {
      relayFilters: [...current.relayFilters, ...legacy.relayFilters],
      localFilters: [...current.localFilters, ...legacy.localFilters],
    }
  })
  const targetedGoalRelayHintPlans = $derived([
    ...makeTargetedPublicationOriginalRelayHintPlans(authorizedTargetingEvents),
    ...makeLegacyTargetedPublicationOriginalRelayHintPlans(authorizedLegacyTargetingEvents),
  ])
  const directGoalFilterPlan = $derived(
    communityAuthorityReady && communityId && goalId
      ? makeCommunityContentFilterPlan(
          [{kinds: [ZAP_GOAL], ids: [goalId], "#h": [communityId]}],
          goalAuthorPubkeys,
        )
      : {relayFilters: [], localFilters: []},
  )
  const goalFilterPlan = $derived({
    relayFilters: [
      ...directGoalFilterPlan.relayFilters,
      ...targetedGoalFilterPlan.relayFilters,
    ] as Filter[],
    localFilters: [
      ...directGoalFilterPlan.localFilters,
      ...targetedGoalFilterPlan.localFilters,
    ] as Filter[],
  })
  const goalFilters = $derived(goalFilterPlan.localFilters)
  const goalRelayFilters = $derived(goalFilterPlan.relayFilters)
  const goalEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: goalFilters})))
  const goalProjection = $derived.by(() =>
    projectAuthoredPublicationEvents({
      events: $goalEvents,
      operations: $publicationOperations.values(),
      ownerPubkey: $pubkey || "",
      matches: event =>
        event.kind === ZAP_GOAL && event.id === goalId && matchFilters(goalFilters, event),
    }),
  )
  const goal = $derived(goalProjection.events[0])
  const goalOperationId = $derived(goal ? goalProjection.operationIds.get(goal.id) : undefined)
  const approvedGoal = $derived(communityAuthorityReady ? goal : undefined)
  const approvedGoalCensorReason = $derived.by(() =>
    approvedGoal
      ? getCommunityCensorReason({
          reportState: $activeCommunityReportState,
          eventId: approvedGoal.id,
          eventAddress: getCommunityReportEventAddress(approvedGoal),
          pubkey: approvedGoal.pubkey,
          sectionName: goalSectionName,
        })
      : undefined,
  )
  const replyFilterPlan = $derived(
    communityAuthorityReady && approvedGoal && !approvedGoalCensorReason
      ? makeCommunityContentFilterPlan(
          [
            {
              kinds: [COMMENT],
              "#E": [approvedGoal.id],
              "#K": [String(ZAP_GOAL)],
              "#h": [communityId],
            },
          ],
          commentAuthorPubkeys,
        )
      : {relayFilters: [], localFilters: []},
  )
  const replyFilters = $derived(replyFilterPlan.localFilters)
  const replyRelayFilters = $derived(replyFilterPlan.relayFilters)
  const replyEventsStore = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: replyFilters})),
  )
  const replyProjection = $derived.by(() =>
    projectAuthoredPublicationEvents({
      events: $replyEventsStore,
      operations: $publicationOperations.values(),
      ownerPubkey: $pubkey || "",
      matches: event =>
        matchFilters(replyFilters, event) &&
        event.kind === COMMENT &&
        getTagValue("E", event.tags) === approvedGoal?.id &&
        getTagValue("K", event.tags) === String(ZAP_GOAL) &&
        getTagValue("h", event.tags) === communityId,
    }),
  )
  const replies = $derived(
    sortBy(
      replyEvent => -replyEvent.created_at,
      filterVisibleAfterDeletesAndEdits(replyProjection.events, $editedTargetIds).filter(
        event => !isCommunityPersonBanned($activeCommunityReportState, event.pubkey),
      ),
    ),
  )
  const visibleReplies = $derived(showAllReplies ? replies : replies.slice(0, 4))
  const canReply = $derived(
    Boolean(
      approvedGoal &&
      !goalOperationId &&
      communityAuthorityReady &&
      !approvedGoalCensorReason &&
      $pubkey &&
      communityDefinition &&
      canWriteCommunityTarget({
        definition: communityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.comment,
        reportState: $activeCommunityReportState,
      }),
    ),
  )
  const canReact = $derived(
    Boolean(
      approvedGoal &&
      !goalOperationId &&
      communityAuthorityReady &&
      !approvedGoalCensorReason &&
      $pubkey &&
      communityDefinition &&
      canWriteCommunityTarget({
        definition: communityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.reaction,
        reportState: $activeCommunityReportState,
      }),
    ),
  )

  const sendReply = async ({content, tags}: EventContent) => {
    const trimmed = content.trim()
    if (!approvedGoal || !trimmed) return false
    if (!canReply) {
      pushToast({theme: "error", message: commentAccessMessage})
      return false
    }
    if ($activeExactCommunityRelays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return false
    }

    if (eventToEdit) {
      try {
        await publishEditedReply({
          event: eventToEdit,
          content: trimmed,
          tags,
          relays: $activeExactCommunityRelays,
          url: communityId,
        })
      } catch (error) {
        pushToast({
          theme: "error",
          message: error instanceof Error ? error.message : "Failed to publish edit.",
        })
        return false
      }
      eventToEdit = undefined
      showReply = false
      return true
    }

    const relays = $activeExactCommunityRelays

    try {
      startPublication({
        event: makeComment({
          event: approvedGoal,
          content: trimmed,
          tags: [["h", communityId], ...tags],
        }),
        relays,
        label: "Goal comment",
        href: goalPath,
        preview: "retain-on-failure",
      })
    } catch (error) {
      pushToast({
        theme: "error",
        message: error instanceof Error ? error.message : "Failed to publish comment.",
      })
      return false
    }

    showReply = false
    return true
  }

  const openReply = async () => {
    eventToEdit = undefined
    showReply = true
    await tick()
    composeElement?.scrollIntoView({behavior: "smooth", block: "end"})
    compose?.focus()
  }

  const openEditPrompt = async (event: TrustedEvent) => {
    eventToEdit = event
    showReply = true
    await tick()
    composeElement?.scrollIntoView({behavior: "smooth", block: "end"})
    compose?.focus()
  }

  const closeReply = () => {
    eventToEdit = undefined
    showReply = false
  }

  const canEditReply = (event: TrustedEvent) => canEditReplyEvent(event, $pubkey, canReply)

  const syncHashTarget = () => {
    const match = window.location.hash.match(/^#event-([0-9a-f]{64})$/i)
    hashTarget = {id: match?.[1]?.toLowerCase() || "", request: ++hashTargetRequest}
  }

  $effect(() => {
    if (typeof window === "undefined") return

    syncHashTarget()
    window.addEventListener("hashchange", syncHashTarget)

    return () => window.removeEventListener("hashchange", syncHashTarget)
  })

  $effect(() => {
    const {id, request} = hashTarget
    const targetKey = `${goalPath}:${request}:${id}`
    const targetIsLoaded = approvedGoal?.id === id || replies.some(reply => reply.id === id)
    if (!id || !targetIsLoaded || revealedHashTargetKey === targetKey) return

    revealedHashTargetKey = targetKey
    showAllReplies = true
    void tick().then(() => {
      if (hashTarget.request === request) void scrollToEvent(id)
    })
  })

  $effect(() => {
    void historicalLoadRetryVersion
    const relays = $activeExactCommunityRelays

    if (!communityBootstrapReady) {
      loadingGoal = false
      goalLoadStatus = "idle"
      return
    }
    if (goalRelayFilters.length === 0 || goalFilters.length === 0) {
      loadingGoal = false
      goalLoadStatus = "complete"
      return
    }
    if (relays.length === 0) {
      loadingGoal = false
      goalLoadStatus = "incomplete"
      return
    }

    const controller = new AbortController()

    loadingGoal = true
    goalLoadStatus = "loading"
    void loadBoundedCommunityHistory({
      relays,
      relayFilters: goalRelayFilters,
      localFilters: goalFilters,
      timeoutMs: REQUEST_HARD_TIMEOUT_MS,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      owner: `community-goal:${communityAddress}:${goalId}`,
      signal: controller.signal,
    })
      .then(result => {
        if (controller.signal.aborted) return
        goalLoadStatus = result.complete ? "complete" : "incomplete"
      })
      .catch(error => {
        if (controller.signal.aborted) return
        console.warn("[community-goal] Failed to load goal history", error)
        goalLoadStatus = "failed"
      })
      .finally(() => {
        if (!controller.signal.aborted) loadingGoal = false
      })

    return () => controller.abort()
  })

  $effect(() => {
    void historicalLoadRetryVersion
    const relays = $activeExactCommunityRelays
    const relayFilters = targetingFilterPlan.relayFilters
    const localFilters = targetingFilterPlan.localFilters

    if (!communityBootstrapReady) {
      loadingTargeting = false
      targetLoadStatus = "idle"
      return
    }
    if (relayFilters.length === 0 || localFilters.length === 0) {
      loadingTargeting = false
      targetLoadStatus = "complete"
      return
    }
    if (relays.length === 0) {
      loadingTargeting = false
      targetLoadStatus = "incomplete"
      return
    }

    const controller = new AbortController()

    loadingTargeting = true
    targetLoadStatus = "loading"
    void loadBoundedCommunityHistory({
      relays,
      relayFilters,
      localFilters,
      timeoutMs: REQUEST_HARD_TIMEOUT_MS,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      owner: `community-goal-targets:${communityAddress}:${goalId}`,
      signal: controller.signal,
    })
      .then(result => {
        if (controller.signal.aborted) return
        targetLoadStatus = result.complete ? "complete" : "incomplete"
      })
      .catch(error => {
        if (controller.signal.aborted) return
        console.warn("[community-goal] Failed to load targeting history", error)
        targetLoadStatus = "failed"
      })
      .finally(() => {
        if (!controller.signal.aborted) loadingTargeting = false
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
          owner: `community-goal-originals:${communityAddress}:${goalId}`,
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
        console.warn("[community-goal] Failed to load hinted goal originals", error)
        hintedOriginalLoadStatus = "failed"
      })
      .finally(() => {
        if (!controller.signal.aborted) loadingHintedOriginals = false
      })

    return () => controller.abort()
  })

  $effect(() => {
    void historicalLoadRetryVersion
    const relays = $activeExactCommunityRelays

    if (!communityBootstrapReady) {
      loadingReplies = false
      replyLoadStatus = "idle"
      return
    }
    if (replyRelayFilters.length === 0 || replyFilters.length === 0) {
      loadingReplies = false
      replyLoadStatus = "complete"
      return
    }
    if (relays.length === 0) {
      loadingReplies = false
      replyLoadStatus = "incomplete"
      return
    }

    const controller = new AbortController()

    loadingReplies = true
    replyLoadStatus = "loading"
    void loadBoundedCommunityHistory({
      relays,
      relayFilters: replyRelayFilters,
      localFilters: replyFilters,
      timeoutMs: REQUEST_HARD_TIMEOUT_MS,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      owner: `community-goal-replies:${communityAddress}:${goalId}`,
      signal: controller.signal,
    })
      .then(result => {
        if (controller.signal.aborted) return
        replyLoadStatus = result.complete ? "complete" : "incomplete"
      })
      .catch(error => {
        if (controller.signal.aborted) return
        console.warn("[community-goal] Failed to load reply history", error)
        replyLoadStatus = "failed"
      })
      .finally(() => {
        if (!controller.signal.aborted) loadingReplies = false
      })

    return () => controller.abort()
  })

  $effect(() => {
    if (goal) {
      loadingGoal = false
    }
    if (replies.length > 0) {
      loadingReplies = false
    }
  })

  const retryHistoricalLoad = () => {
    if (communityBootstrapFailed || communityAuthorityUnavailable) {
      window.location.reload()
      return
    }

    historicalLoadRetryVersion += 1
  }

  onDestroy(() => {
    setChecked(goalPath)
  })
</script>

<PageBar>
  {#snippet icon()}
    <div>
      <a href={goalsPath || "#"} class="btn btn-neutral btn-sm">
        <Icon icon={AltArrowLeft} />
      </a>
    </div>
  {/snippet}
  {#snippet title()}
    <strong>{approvedGoalCensorReason ? "Moderated goal" : approvedGoal?.content || "Goal"}</strong>
  {/snippet}
  {#snippet action()}
    <CommunityMenuButton community={routeCommunity?.naddr} />
  {/snippet}
</PageBar>

<PageContent class="flex flex-col gap-3 p-2 pt-4">
  {#if approvedGoal}
    <article class="card2 bg-alt z-feature w-full shadow-md" data-event={approvedGoal.id}>
      {#if approvedGoalCensorReason}
        <ModeratedContent reason={approvedGoalCensorReason} />
      {:else}
        <NoteCard event={approvedGoal} relays={$activeExactCommunityRelays}>
          <div class="col-3 ml-12">
            <Content
              event={{
                content: getTagValue("summary", approvedGoal.tags) || "",
                tags: approvedGoal.tags,
              }}
              url={communityId}
              communitySectionName={goalSectionName}
              showEntire />
            <GoalSummary
              event={approvedGoal}
              url={communityId}
              relays={$activeExactCommunityRelays}
              publishRelays={$activeExactCommunityRelays}
              scopeH={communityId}
              disableContributions={Boolean(goalOperationId)} />
            {#if goalOperationId}
              <PublicationStatus operationId={goalOperationId} />
            {/if}
            {#if !goalOperationId}
              <div class="flex w-full justify-end">
                <GoalActions
                  showRoom={false}
                  event={approvedGoal}
                  url={communityId}
                  community={routeCommunity}
                  relays={$activeExactCommunityRelays}
                  publishRelays={$activeExactCommunityRelays}
                  scopeH={communityId}
                  communitySectionName={goalSectionName}
                  allowedAuthors={commentAuthorPubkeys}
                  reactionAllowedAuthors={reactionAuthorPubkeys}
                  reportAllowedAuthors={reportAuthorPubkeys}
                  readOnly={!canReact} />
              </div>
            {/if}
          </div>
        </NoteCard>
      {/if}
    </article>

    {#if !approvedGoalCensorReason && !showAllReplies && replies.length > visibleReplies.length}
      <div class="flex justify-center">
        <Button class="btn btn-link" onclick={() => (showAllReplies = true)}>
          <Icon icon={SortVertical} />
          Show all {replies.length} replies
        </Button>
      </div>
    {/if}

    {#if !approvedGoalCensorReason}
      <div class="col-2">
        {#each visibleReplies as replyEvent (replyEvent.id)}
          {@const censorReason = getCommunityCensorReason({
            reportState: $activeCommunityReportState,
            eventId: replyEvent.id,
            eventAddress: getCommunityReportEventAddress(replyEvent),
            pubkey: replyEvent.pubkey,
            sectionName: commentSectionName,
          })}
          {#if censorReason}
            <div class="card2 bg-alt z-feature w-full" data-event={replyEvent.id}>
              <ModeratedContent reason={censorReason} />
            </div>
          {:else}
            <div class="card2 bg-alt z-feature w-full">
              <ChannelMessage
                url={communityId}
                event={replyEvent}
                operationId={replyProjection.operationIds.get(replyEvent.id)}
                showPubkey
                readOnly={!canReact}
                interactionRelays={$activeExactCommunityRelays}
                actionRelays={$activeExactCommunityRelays}
                profileRelays={$activeExactCommunityRelays}
                allowedAuthors={commentAuthorPubkeys}
                reactionAllowedAuthors={reactionAuthorPubkeys}
                reportAllowedAuthors={reportAuthorPubkeys}
                scopeH={communityId}
                communitySectionName={commentSectionName}
                canEdit={canEditReply}
                onEdit={openEditPrompt} />
            </div>
          {/if}
        {:else}
          {#if loadingReplies}
            <p class="flex h-10 items-center justify-center py-20 text-center">
              <Spinner loading>Looking for comments...</Spinner>
            </p>
          {:else if communityAuthorityLoading}
            <p class="flex h-10 items-center justify-center py-20 text-center">
              <Spinner loading>Loading comments...</Spinner>
            </p>
          {:else}
            <p class="py-8 text-center opacity-70">No comments yet.</p>
          {/if}
        {/each}
      </div>
    {/if}

    {#if !approvedGoalCensorReason && showReply}
      <div bind:this={composeElement} class="card2 bg-alt col-3 p-4 shadow-md">
        <strong>Comment</strong>
        {#if eventToEdit}
          <RoomComposeEdit clear={() => (eventToEdit = undefined)} />
        {/if}
        {#key eventToEdit}
          <RoomCompose
            url={$activeExactCommunityRelays[0] || communityId}
            h={communityId}
            blossomContext={communityDefinition
              ? {
                  type: "community",
                  communityAddress: communityDefinition.pointer.address,
                }
              : undefined}
            showMenu={false}
            onSubmit={sendReply}
            onEscape={closeReply}
            content={eventToEdit?.content}
            bind:this={compose} />
        {/key}
        <div class="flex justify-end">
          <button class="btn btn-link btn-sm" type="button" onclick={closeReply}>Cancel</button>
        </div>
      </div>
    {:else if !approvedGoalCensorReason}
      <div class="flex justify-end px-2 pb-2">
        {#if canReply}
          <button class="btn btn-primary" type="button" onclick={openReply}>
            <Icon icon={Reply} />
            Comment on this goal
          </button>
        {:else if communityBootstrapLoading || communityAuthorityLoading}
          <div class="flex items-center gap-2 text-sm opacity-70">
            <Spinner loading>Checking comment access...</Spinner>
          </div>
        {:else}
          <PublishGate
            target={COMMUNITY_WRITE_TARGETS.comment}
            action="comment on goals"
            class="btn btn-primary">
            <Icon icon={Reply} />
            Comment on this goal
          </PublishGate>
        {/if}
      </div>
    {/if}
  {:else if communityBootstrapLoading || communityAuthorityLoading || loadingGoal || loadingTargeting || loadingHintedOriginals || goalLoadStatus === "queued" || goalLoadStatus === "loading" || (communityBootstrapReady && targetLoadStatus === "idle") || targetLoadStatus === "queued" || targetLoadStatus === "loading" || hintedOriginalLoadStatus === "loading" || (!goal && goalFilters.length > 0 && goalLoadStatus === "idle")}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading funding goal...</Spinner>
    </p>
  {:else if communityBootstrapFailed || communityAuthorityUnavailable}
    <div class="flex flex-col items-center gap-3 py-8 text-center opacity-70">
      <p>Goal unavailable.</p>
      <button class="btn btn-neutral btn-sm" type="button" onclick={retryHistoricalLoad}
        >Retry</button>
    </div>
  {:else}
    <p class="py-8 text-center opacity-70">Goal not found or not approved for this community.</p>
  {/if}
</PageContent>
