<script lang="ts">
  import {max, formatTimestampRelative} from "@welshman/lib"
  import {COMMENT, getAddress, isReplaceable} from "@welshman/util"
  import {deriveArray, deriveEventsById} from "@welshman/store"
  import type {Filter, TrustedEvent} from "@welshman/util"
  import {repository} from "@welshman/app"
  import {page} from "$app/stores"
  import {makeCommunityScopedFilterPlan} from "@app/core/community-feeds"
  import {registerEventActivity} from "@app/core/event-activity-io"
  import {notifications} from "@app/util/notifications"
  import Reply from "@assets/icons/reply-2.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"

  const {
    url,
    path,
    event,
    relays = [],
    scopeH = "",
    allowedAuthors = undefined,
    coreCommunityLiveCovered = false,
  }: {
    url: string
    path: string
    event: TrustedEvent
    relays?: string[]
    scopeH?: string
    allowedAuthors?: string[]
    coreCommunityLiveCovered?: boolean
  } = $props()

  const loadRelays = $derived.by(() =>
    (relays.length > 0 ? relays : url ? [url] : []).filter(Boolean),
  )
  const filterPlan = $derived.by(() => {
    const baseFilter = {
      kinds: [COMMENT],
      "#K": [String(event.kind)],
    } satisfies Filter
    const structuralFilters: Filter[] = [{...baseFilter, "#E": [event.id]}]

    if (isReplaceable(event)) {
      const address = getAddress(event)

      structuralFilters.push({...baseFilter, "#A": [address]}, {...baseFilter, "#a": [address]})
    }

    return makeCommunityScopedFilterPlan(structuralFilters, scopeH, allowedAuthors)
  })
  const filters = $derived(filterPlan.localFilters)
  const relayFilters = $derived(filterPlan.relayFilters)
  const replies = $derived(deriveArray(deriveEventsById({repository, filters})))
  const lastActive = $derived(max([...$replies, event].map(e => e.created_at)))
  const routeScope = $derived(`${$page.route.id || "unknown"}:${$page.url.pathname}`)
  let historyStatus = $state<"idle" | "loading" | "complete" | "incomplete">("idle")

  $effect(() => {
    if (loadRelays.length === 0 || filters.length === 0) {
      historyStatus = filters.length === 0 ? "complete" : "incomplete"
      return
    }

    historyStatus = scopeH ? "loading" : "complete"

    return registerEventActivity({
      routeScope,
      relays: loadRelays,
      scopeH,
      filters,
      ...(scopeH
        ? {
            relayFilters,
            onHistoryResult: (result: {complete: boolean}) => {
              historyStatus = result.complete ? "complete" : "incomplete"
            },
          }
        : {}),
      coreCommunityLiveCovered,
    })
  })
</script>

<div
  class="flex-inline btn btn-neutral btn-xs gap-1 rounded-full"
  title={historyStatus === "incomplete" ? "Reply history is incomplete" : undefined}>
  <Icon icon={Reply} />
  <span>
    {#if historyStatus === "incomplete" && $replies.length === 0}
      Replies incomplete
    {:else}
      {$replies.length}
      {$replies.length === 1 ? "reply" : "replies"}{historyStatus === "incomplete" ? "+" : ""}
    {/if}
  </span>
</div>
<div class="btn btn-neutral btn-xs relative hidden rounded-full sm:flex">
  {#if $notifications.has(path)}
    <div class="h-2 w-2 rounded-full bg-primary"></div>
  {/if}
  Active {formatTimestampRelative(lastActive)}
</div>
