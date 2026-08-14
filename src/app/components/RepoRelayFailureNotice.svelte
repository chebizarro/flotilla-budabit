<script lang="ts">
  import {getContext} from "svelte"
  import {derived} from "svelte/store"
  import {Button as GitButton} from "@nostr-git/ui"
  import InlinePopover from "@lib/components/InlinePopover.svelte"
  import {REPO_ROOT_HISTORY_KEY, type RepoRootHistoryContext} from "@app/core/git-state"

  type Props = {
    onRetry?: () => void | Promise<void>
  }

  const {onRetry}: Props = $props()

  const repoRootHistory = getContext<RepoRootHistoryContext>(REPO_ROOT_HISTORY_KEY)
  const failedRelayRequests = repoRootHistory.failedRelayRequests
  const failuresByRelay = derived(failedRelayRequests, requests => {
    const groups = new Map<string, {relay: string; requests: typeof requests}>()
    for (const request of requests) {
      const group = groups.get(request.relay) || {relay: request.relay, requests: []}
      group.requests.push(request)
      groups.set(request.relay, group)
    }
    return Array.from(groups.values())
  })
  let open = $state(false)
  let retrying = $state(false)

  const outcomeLabel = (request: {outcome: string; startedAt?: number}) => {
    if (request.outcome === "timeout" && request.startedAt === undefined) return "Not started"
    const outcome = request.outcome
    if (outcome === "timeout") return "Timed out"
    if (outcome === "disconnect") return "Disconnected"
    if (outcome === "closed") return "Closed"
    return "Failed"
  }

  const retry = async () => {
    if (retrying) return
    retrying = true
    try {
      await repoRootHistory.retryFailedRelays()
      await onRetry?.()
    } finally {
      retrying = false
    }
  }
</script>

{#if $failedRelayRequests.length > 0}
  <div class="relative inline-flex">
    <GitButton
      variant="ghost"
      size="sm"
      class="h-7 min-h-0 px-2 text-xs"
      aria-expanded={open}
      onclick={() => (open = !open)}>Show</GitButton>
    {#if open}
      <InlinePopover onClose={() => (open = false)} align="right" widthClass="w-80">
        <div class="space-y-3">
          <div>
            <p class="text-sm font-medium text-foreground">Incomplete relay requests</p>
            <p class="mt-0.5 text-xs text-muted-foreground">
              Loaded activity remains visible while these requests are retried.
            </p>
          </div>
          <div class="space-y-2">
            {#each $failuresByRelay as group (group.relay)}
              <div class="rounded-md border border-border bg-muted/20 p-2 text-xs">
                <p class="break-all font-medium text-foreground">{group.relay}</p>
                <div class="mt-1.5 space-y-1 text-muted-foreground">
                  {#each group.requests as request (request.key)}
                    <div class="flex items-start justify-between gap-2">
                      <span>
                        {request.lane}{request.eventCount ? ` (${request.eventCount} loaded)` : ""}
                      </span>
                      <span class="shrink-0">{outcomeLabel(request)}</span>
                    </div>
                    {#if request.reason && request.outcome !== "timeout"}
                      <p class="break-words">{request.reason}</p>
                    {/if}
                  {/each}
                </div>
              </div>
            {/each}
          </div>
          <GitButton variant="outline" size="sm" class="w-full" disabled={retrying} onclick={retry}>
            {retrying ? "Retrying..." : "Retry failed"}
          </GitButton>
        </div>
      </InlinePopover>
    {/if}
  </div>
{/if}
