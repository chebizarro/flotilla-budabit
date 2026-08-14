<script lang="ts">
  import cx from "classnames"
  import type {Snippet} from "svelte"
  import {groupBy, map, sum, uniq, uniqBy, batch, displayList} from "@welshman/lib"
  import {
    REPORT,
    REACTION,
    getReplyFilters,
    getEmojiTags,
    fromMsats,
    getTag,
    matchFilters,
    normalizeRelayUrl,
  } from "@welshman/util"
  import type {TrustedEvent, EventContent, Filter, Zap} from "@welshman/util"
  import {
    deriveArray,
    deriveEventsById,
    deriveEventsByIdByUrl,
    deriveItemsByKey,
  } from "@welshman/store"
  import {load} from "@welshman/net"
  import {pubkey, repository, tracker, getValidZap, displayProfileByPubkey} from "@welshman/app"
  import {isMobile, preventDefault, stopPropagation} from "@lib/html"
  import Danger from "@assets/icons/danger-triangle.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Reaction from "@app/components/Reaction.svelte"
  import ReportDetails from "@app/components/ReportDetails.svelte"
  import {
    makeCommunityScopedFilterPlan,
    type CommunityContentFilterPlan,
  } from "@app/core/community-feeds"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
  import {
    loadBoundedCommunityHistory,
    makeSameAuthorDeleteFilters,
    type BoundedCommunityHistoryResult,
  } from "@app/core/requests"
  import {pushModal} from "@app/util/modal"
  import {getZapReceiptFilters, getZapRelays} from "@app/util/zaps"
  import {publicationOperations} from "@app/core/publication-operations"
  import {
    getReactionEventReference,
    getReactionIdentity,
    getReactionOperationSemanticKey,
    projectReactionOperations,
  } from "@app/core/reaction-operations"

  interface Props {
    event: TrustedEvent
    deleteReaction: (event: TrustedEvent) => void
    createReaction: (event: EventContent) => void
    url?: string
    relays?: string[]
    operationRelays?: string[]
    scopeH?: string
    zapScopeH?: string
    strictZapRelays?: boolean
    loadZapReceipts?: boolean
    reactionClass?: string
    noTooltip?: boolean
    readOnly?: boolean
    allowedAuthors?: string[]
    reactionAllowedAuthors?: string[]
    reportAllowedAuthors?: string[]
    children?: Snippet
  }

  const {
    event,
    deleteReaction,
    createReaction,
    url = "",
    relays = [],
    operationRelays = relays,
    scopeH = "",
    zapScopeH = "",
    strictZapRelays = false,
    loadZapReceipts = true,
    reactionClass = "",
    noTooltip = false,
    readOnly = false,
    allowedAuthors = undefined,
    reactionAllowedAuthors = undefined,
    reportAllowedAuthors = undefined,
    children,
  }: Props = $props()

  const normalizeRelay = (relay: string) => {
    try {
      return normalizeRelayUrl(relay)
    } catch {
      return ""
    }
  }

  const loadRelays = $derived.by(() => {
    const candidates = relays.length > 0 ? relays : url ? [url] : []
    return uniq(candidates.map(normalizeRelay).filter(Boolean))
  })

  const relaySet = $derived.by(() => new Set(relays.map(normalizeRelay).filter(Boolean)))

  const effectiveZapScopeH = $derived(zapScopeH || scopeH)
  const effectiveReactionAllowedAuthors = $derived(reactionAllowedAuthors ?? allowedAuthors)
  const effectiveReportAllowedAuthors = $derived(reportAllowedAuthors ?? allowedAuthors)

  const matchesRelayScope = (event: TrustedEvent) => {
    if (relaySet.size === 0) return true

    for (const relay of tracker.getRelays(event.id)) {
      if (relaySet.has(normalizeRelay(relay))) {
        return true
      }
    }

    return false
  }

  const getRelayScopedEvents = (
    allEvents: TrustedEvent[],
    eventsByRelay: Map<string, Map<string, TrustedEvent>>,
  ) => {
    if (relaySet.size === 0) return allEvents

    const scopedEvents = new Map<string, TrustedEvent>()

    for (const [relay, events] of eventsByRelay) {
      if (!relaySet.has(normalizeRelay(relay))) continue

      for (const event of events.values()) {
        scopedEvents.set(event.id, event)
      }
    }

    return Array.from(scopedEvents.values())
  }

  const engagementFilters = getReplyFilters([event], {
    kinds: [REPORT, REACTION],
  }) as Filter[]
  const reactionAdmissionFilterPlan = $derived.by(() =>
    makeCommunityScopedFilterPlan(
      getReplyFilters([event], {kinds: [REACTION]}) as Filter[],
      scopeH,
      effectiveReactionAllowedAuthors,
    ),
  )
  const reportAdmissionFilterPlan = $derived.by(() =>
    makeCommunityScopedFilterPlan(
      getReplyFilters([event], {kinds: [REPORT]}) as Filter[],
      scopeH,
      effectiveReportAllowedAuthors,
    ),
  )
  const engagements = deriveArray(deriveEventsById({repository, filters: engagementFilters}))
  const engagementsByRelay = deriveEventsByIdByUrl({
    repository,
    tracker,
    filters: engagementFilters,
  })

  const zaps = deriveArray(
    deriveItemsByKey<Zap>({
      repository,
      getKey: zap => zap.response.id,
      filters: getZapReceiptFilters({event}),
      eventToItem: (response: TrustedEvent) => getValidZap(response, event),
    }),
  )

  const scopedReports = $derived.by(() =>
    getRelayScopedEvents($engagements, $engagementsByRelay).filter(
      event => event.kind === REPORT && matchFilters(reportAdmissionFilterPlan.localFilters, event),
    ),
  )

  const canonicalReactions = $derived.by(() =>
    getRelayScopedEvents($engagements, $engagementsByRelay).filter(
      event =>
        event.kind === REACTION && matchFilters(reactionAdmissionFilterPlan.localFilters, event),
    ),
  )
  const reactionProjection = $derived.by(() =>
    projectReactionOperations({
      reactions: canonicalReactions,
      operations: $publicationOperations.values(),
      targetEvent: event,
      ownerPubkey: $pubkey || "",
      relays: operationRelays,
      scopeH,
      allowedAuthors: effectiveReactionAllowedAuthors,
    }),
  )
  const scopedReactions = $derived(reactionProjection.reactions)

  const scopedZaps = $derived.by(() =>
    Array.from($zaps.values()).filter(zap =>
      effectiveZapScopeH
        ? getTag("h", zap.request.tags)?.[1] === effectiveZapScopeH
        : matchesRelayScope(zap.response),
    ),
  )

  const onReactionClick = (events: TrustedEvent[]) => {
    const reaction = events.find(e => e.pubkey === $pubkey)

    if (reaction) {
      deleteReaction(reaction)
    } else {
      const [event] = events

      createReaction({
        content: event.content,
        tags: getEmojiTags(event.content.replace(/:/g, ""), event.tags),
      })
    }
  }

  const onReportClick = () =>
    pushModal(ReportDetails, {
      url: url || loadRelays[0] || "",
      event,
      scopeH,
      allowedAuthors: effectiveReportAllowedAuthors,
    })

  const reportReasons = $derived(uniq(map(e => getTag("e", e.tags)?.[2], scopedReports)))

  const getReactionKey = (e: TrustedEvent) => getReactionIdentity(e)

  const groupedReactions = $derived(
    groupBy(
      getReactionKey,
      uniqBy(e => `${e.pubkey}${getReactionKey(e)}`, scopedReactions),
    ),
  )

  const groupedZaps = $derived(groupBy(e => getReactionKey(e.request), scopedZaps))
  const reactionLoadFilterPlan = $derived.by(() =>
    makeCommunityScopedFilterPlan(
      getReplyFilters([event], {kinds: [REACTION]}) as Filter[],
      scopeH,
      effectiveReactionAllowedAuthors,
    ),
  )
  const reportLoadFilterPlan = $derived.by(() =>
    makeCommunityScopedFilterPlan(
      getReplyFilters([event], {kinds: [REPORT]}) as Filter[],
      scopeH,
      effectiveReportAllowedAuthors,
    ),
  )

  const zapLoadRelays = $derived.by(() =>
    getZapRelays({event, relayHints: relays, scopeH: effectiveZapScopeH, strict: strictZapRelays}),
  )
  const zapLoadFilters = $derived.by(() => getZapReceiptFilters({event}))

  const loadCommunityEngagementHistory = async (
    currentRelays: string[],
    filterPlan: CommunityContentFilterPlan,
    signal: AbortSignal,
    owner: string,
  ): Promise<BoundedCommunityHistoryResult> => {
    const result = await loadBoundedCommunityHistory({
      relays: currentRelays,
      relayFilters: filterPlan.relayFilters,
      localFilters: filterPlan.localFilters,
      signal,
      priority: RELAY_REQUEST_PRIORITY.background,
      owner,
    })
    const deleteFilters = makeSameAuthorDeleteFilters(result.events)
    if (deleteFilters.length === 0 || signal.aborted) return result

    const deleteResult = await loadBoundedCommunityHistory({
      relays: currentRelays,
      relayFilters: deleteFilters,
      localFilters: deleteFilters,
      signal,
      priority: RELAY_REQUEST_PRIORITY.background,
      owner: `${owner}:deletes`,
    })

    return {
      events: result.events,
      complete: result.complete && deleteResult.complete,
      timedOut: result.timedOut || deleteResult.timedOut,
      saturated: result.saturated || deleteResult.saturated,
    }
  }

  let reactionLoadIncomplete = $state(false)
  let cachedReactionDeleteHistoryIncomplete = $state(false)
  let reportLoadIncomplete = $state(false)
  let cachedReportDeleteHistoryIncomplete = $state(false)
  const reactionHistoryIncomplete = $derived(
    reactionLoadIncomplete || cachedReactionDeleteHistoryIncomplete,
  )
  const reportHistoryIncomplete = $derived(
    reportLoadIncomplete || cachedReportDeleteHistoryIncomplete,
  )

  $effect(() => {
    const currentRelays = loadRelays
    const filterPlan = reactionLoadFilterPlan

    if (filterPlan.relayFilters.length === 0) {
      reactionLoadIncomplete = false
      return
    }
    if (currentRelays.length === 0) {
      reactionLoadIncomplete = Boolean(scopeH)
      return
    }

    const controller = new AbortController()
    reactionLoadIncomplete = false

    if (scopeH) {
      void loadCommunityEngagementHistory(
        currentRelays,
        filterPlan,
        controller.signal,
        `reaction-summary:${event.id}`,
      )
        .then(result => {
          if (controller.signal.aborted) return
          reactionLoadIncomplete = !result.complete
        })
        .catch(() => {
          if (!controller.signal.aborted) reactionLoadIncomplete = true
        })

      return () => controller.abort()
    }

    void load({
      relays: currentRelays,
      signal: controller.signal,
      filters: filterPlan.relayFilters,
      onEvent: batch(300, (events: TrustedEvent[]) => {
        const admittedEvents = events.filter(event => matchFilters(filterPlan.localFilters, event))
        const deleteFilters = makeSameAuthorDeleteFilters(admittedEvents)
        if (deleteFilters.length === 0) return

        void load({
          relays: currentRelays,
          signal: controller.signal,
          filters: deleteFilters,
        })
      }),
    })

    return () => controller.abort()
  })

  $effect(() => {
    const currentRelays = loadRelays
    const cachedReactions = canonicalReactions
    const deleteFilters = makeSameAuthorDeleteFilters(cachedReactions)

    if (deleteFilters.length === 0) {
      cachedReactionDeleteHistoryIncomplete = false
      return
    }
    if (currentRelays.length === 0) {
      cachedReactionDeleteHistoryIncomplete = Boolean(scopeH)
      return
    }

    const controller = new AbortController()
    cachedReactionDeleteHistoryIncomplete = false

    if (scopeH) {
      void loadBoundedCommunityHistory({
        relays: currentRelays,
        relayFilters: deleteFilters,
        localFilters: deleteFilters,
        signal: controller.signal,
        priority: RELAY_REQUEST_PRIORITY.background,
        owner: `reaction-summary:${event.id}:cached-deletes`,
      })
        .then(result => {
          if (!controller.signal.aborted) {
            cachedReactionDeleteHistoryIncomplete = !result.complete
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) cachedReactionDeleteHistoryIncomplete = true
        })

      return () => controller.abort()
    }

    void load({
      relays: currentRelays,
      signal: controller.signal,
      filters: deleteFilters,
    })

    return () => controller.abort()
  })

  $effect(() => {
    const currentRelays = loadRelays
    const filterPlan = reportLoadFilterPlan

    if (filterPlan.relayFilters.length === 0) {
      reportLoadIncomplete = false
      return
    }
    if (currentRelays.length === 0) {
      reportLoadIncomplete = Boolean(scopeH)
      return
    }

    const controller = new AbortController()
    reportLoadIncomplete = false

    if (scopeH) {
      void loadCommunityEngagementHistory(
        currentRelays,
        filterPlan,
        controller.signal,
        `report-summary:${event.id}`,
      )
        .then(result => {
          if (!controller.signal.aborted) reportLoadIncomplete = !result.complete
        })
        .catch(() => {
          if (!controller.signal.aborted) reportLoadIncomplete = true
        })

      return () => controller.abort()
    }

    void load({
      relays: currentRelays,
      signal: controller.signal,
      filters: filterPlan.relayFilters,
      onEvent: batch(300, (events: TrustedEvent[]) => {
        const admittedEvents = events.filter(event => matchFilters(filterPlan.localFilters, event))
        const deleteFilters = makeSameAuthorDeleteFilters(admittedEvents)
        if (deleteFilters.length === 0) return

        void load({relays: currentRelays, signal: controller.signal, filters: deleteFilters})
      }),
    })

    return () => controller.abort()
  })

  $effect(() => {
    const currentRelays = loadRelays
    const cachedReports = scopedReports
    const deleteFilters = makeSameAuthorDeleteFilters(cachedReports)

    if (deleteFilters.length === 0) {
      cachedReportDeleteHistoryIncomplete = false
      return
    }
    if (currentRelays.length === 0) {
      cachedReportDeleteHistoryIncomplete = Boolean(scopeH)
      return
    }

    const controller = new AbortController()
    cachedReportDeleteHistoryIncomplete = false

    if (scopeH) {
      void loadBoundedCommunityHistory({
        relays: currentRelays,
        relayFilters: deleteFilters,
        localFilters: deleteFilters,
        signal: controller.signal,
        priority: RELAY_REQUEST_PRIORITY.background,
        owner: `report-summary:${event.id}:cached-deletes`,
      })
        .then(result => {
          if (!controller.signal.aborted) cachedReportDeleteHistoryIncomplete = !result.complete
        })
        .catch(() => {
          if (!controller.signal.aborted) cachedReportDeleteHistoryIncomplete = true
        })

      return () => controller.abort()
    }

    void load({relays: currentRelays, signal: controller.signal, filters: deleteFilters})

    return () => controller.abort()
  })

  $effect(() => {
    const currentRelays = zapLoadRelays
    const filters = zapLoadFilters

    if (!loadZapReceipts || currentRelays.length === 0 || filters.length === 0) return

    const controller = new AbortController()

    void load({
      relays: currentRelays,
      signal: controller.signal,
      filters,
    })

    return () => controller.abort()
  })
</script>

{#if scopedReactions.length > 0 || scopedZaps.length || scopedReports.length > 0 || reactionHistoryIncomplete || reportHistoryIncomplete}
  <div class="flex min-w-0 flex-wrap gap-2">
    {#if reactionHistoryIncomplete || reportHistoryIncomplete}
      <span
        class="btn btn-neutral btn-xs cursor-default rounded-full font-normal opacity-70"
        title="Community engagement history is incomplete">
        Engagement incomplete
      </span>
    {/if}
    {#if (url || loadRelays.length > 0) && scopedReports.length > 0}
      <button
        type="button"
        data-tip={`This content has been reported as "${displayList(reportReasons)}".`}
        class="btn btn-error btn-xs tooltip-right flex items-center gap-1 rounded-full font-normal"
        class:tooltip={!noTooltip && !isMobile}
        onclick={stopPropagation(preventDefault(onReportClick))}>
        <Icon icon={Danger} />
        <span>{scopedReports.length}</span>
      </button>
    {/if}
    {#each groupedZaps.entries() as [key, zaps]}
      {@const amount = fromMsats(sum(zaps.map(zap => zap.invoiceAmount)))}
      {@const pubkeys = uniq(zaps.map(zap => zap.request.pubkey))}
      {@const isOwn = $pubkey && pubkeys.includes($pubkey)}
      {@const info = displayList(pubkeys.map(pubkey => displayProfileByPubkey(pubkey)))}
      {@const tooltip = `${info} zapped`}
      <button
        type="button"
        data-tip={tooltip}
        class={cx(
          reactionClass,
          "flex-inline btn btn-outline btn-neutral btn-xs flex items-center gap-1 rounded-full text-xs font-normal",
          {
            tooltip: !noTooltip && !isMobile,
            "border-neutral-content/20": !isOwn,
            "btn-primary": isOwn,
          },
        )}>
        <Reaction event={zaps[0].request} />
        <span>{amount}</span>
      </button>
    {/each}
    {#each groupedReactions.entries() as [key, events]}
      {@const pubkeys = events.map(e => e.pubkey)}
      {@const isOwn = $pubkey && pubkeys.includes($pubkey)}
      {@const semanticKey = getReactionOperationSemanticKey(
        getReactionEventReference(event),
        events[0],
      )}
      {@const pending = reactionProjection.pendingSemanticKeys.has(semanticKey)}
      {@const info = displayList(pubkeys.map(pubkey => displayProfileByPubkey(pubkey)))}
      {@const tooltip = pending
        ? "Publishing reaction..."
        : readOnly
          ? `${info} reacted`
          : isOwn
            ? `${info} reacted. Click to remove your reaction.`
            : `${info} reacted. Click to add this reaction.`}
      {@const onClick = () => onReactionClick(events)}
      <button
        type="button"
        data-tip={tooltip}
        aria-label={tooltip}
        class={cx(
          reactionClass,
          "flex-inline btn btn-outline btn-neutral btn-xs gap-1 rounded-full font-normal",
          {
            tooltip: !noTooltip && !isMobile,
            "border-neutral-content/20": !isOwn,
            "btn-primary": isOwn,
            "cursor-default": readOnly || pending,
          },
        )}
        disabled={pending}
        onclick={readOnly || pending ? undefined : stopPropagation(preventDefault(onClick))}>
        <Reaction event={events[0]} />
        {#if events.length > 1}
          <span>{events.length}</span>
        {/if}
      </button>
    {/each}
    {@render children?.()}
  </div>
{/if}
