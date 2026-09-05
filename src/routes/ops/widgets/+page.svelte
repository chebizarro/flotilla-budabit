<style>
  :global(.widget-grid) {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
    gap: 1rem;
    align-items: stretch;
  }

  :global(.widget-grid .widget-card),
  :global(.widget-grid .fallback) {
    height: 100%;
    color: hsl(var(--bc));
    background: hsl(var(--b1));
    border-color: hsl(var(--b3));
  }
</style>

<script lang="ts">
  import Widget from "@assets/icons/widget.svg?dataurl"
  import {
    OPS_WIDGET_ALLOWED_PUBKEYS,
    OPS_WIDGET_RELAYS,
    createOpsWidgetWall,
  } from "@app/core/ops-widget-wall"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import {WidgetRenderer, type NostrWidgetEvent} from "wheelhouse"
  import "wheelhouse/style.css"

  const wall = createOpsWidgetWall()
  let events = $state<readonly NostrWidgetEvent[]>([])
  let readyRelays = $state<string[]>([])
  let failedRelays = $state<string[]>([])
  let lastError = $state("")

  const allowlistConfigured = OPS_WIDGET_ALLOWED_PUBKEYS.length > 0
  const connectionLabel = $derived(
    `${readyRelays.length}/${OPS_WIDGET_RELAYS.length} relays caught up`,
  )

  $effect(() => {
    const unsubscribeStore = wall.store.subscribe(snapshot => {
      events = snapshot
    })
    const stopRequest = wall.start({
      onEose: relay => {
        readyRelays = Array.from(new Set([...readyRelays, relay]))
        failedRelays = failedRelays.filter(item => item !== relay)
      },
      onClosed: (reason, relay) => {
        failedRelays = Array.from(new Set([...failedRelays, relay]))
        readyRelays = readyRelays.filter(item => item !== relay)
        lastError = reason || `Subscription closed by ${relay}`
      },
      onError: error => {
        lastError = error instanceof Error ? error.message : String(error)
      },
    })

    return () => {
      stopRequest()
      unsubscribeStore()
      wall.clear()
    }
  })
</script>

<svelte:head>
  <title>Ops Widgets · BudaBit</title>
</svelte:head>

<PageBar>
  {#snippet icon()}<div class="center"><Icon icon={Widget} /></div>{/snippet}
  {#snippet title()}<strong>Ops Widgets</strong>{/snippet}
  {#snippet action()}<span class="text-xs opacity-70">{connectionLabel}</span>{/snippet}
</PageBar>

<PageContent class="content min-w-0 p-4 pb-20">
  <section class="mb-4 rounded-box border border-base-300 bg-base-200 p-4 shadow-sm">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold">Fleet widget wall</h1>
        <p class="mt-1 max-w-3xl text-sm opacity-70">
          Live, addressable kind-30318 snapshots rendered with Wheelhouse. Newer events replace the
          same publisher and slot; unsupported payloads remain visible as safe fallback cards.
        </p>
      </div>
      <div class="text-right text-xs opacity-70">
        {#each OPS_WIDGET_RELAYS as relay}<div>{relay}</div>{/each}
      </div>
    </div>
  </section>

  {#if !allowlistConfigured}
    <div class="alert alert-warning mb-4" role="status">
      No trusted widget publishers are configured. Set
      <code>VITE_WHEELHOUSE_ALLOWED_PUBKEYS</code> to a comma-separated list of 64-character hex pubkeys.
    </div>
  {/if}

  {#if lastError}
    <div class="alert alert-error mb-4" role="status">
      <span>{lastError}</span>
    </div>
  {/if}

  {#if events.length > 0}
    <div class="widget-grid">
      {#each events as event (event.id)}
        <WidgetRenderer {event} />
      {/each}
    </div>
  {:else}
    <div class="rounded-box border border-dashed border-base-300 bg-base-100 p-8 text-center">
      <strong>No trusted widget snapshots</strong>
      <p class="mt-2 text-sm opacity-70">
        {allowlistConfigured
          ? readyRelays.length > 0
            ? "The fleet relays have no current kind-30318 events from allowed publishers."
            : "Connecting to the fleet relays…"
          : "Publisher trust is fail-closed until an allowlist is configured."}
      </p>
      {#if failedRelays.length > 0}
        <p class="mt-2 text-xs opacity-60">Unavailable: {failedRelays.join(", ")}</p>
      {/if}
    </div>
  {/if}
</PageContent>
