<script lang="ts">
  import {onDestroy} from "svelte"
  import Button from "@lib/components/Button.svelte"
  import {PERFORMANCE_DIAGNOSTICS_ENABLED} from "@app/core/feature-flags"
  import {
    activePerformanceDiagnosticsRun,
    clearPerformanceDiagnostics,
    getPerformanceDiagnosticsSnapshot,
    performanceDiagnosticsRevision,
    preparePerformanceDiagnosticsArtifact,
    startPerformanceDiagnosticsCapture,
    stopPerformanceDiagnosticsCapture,
    type PerformanceDiagnosticRun,
  } from "@app/core/performance-diagnostics"

  type Props = {
    route: string
    preset: PerformanceDiagnosticRun["preset"]
    context?: unknown
  }

  const {route, preset, context}: Props = $props()
  let open = $state(false)
  let preparing = $state(false)
  let error = $state("")
  const activeHere = $derived($activePerformanceDiagnosticsRun?.route === route)
  const snapshot = $derived.by(() => {
    void $performanceDiagnosticsRevision
    return getPerformanceDiagnosticsSnapshot()
  })
  const routeRuns = $derived(snapshot.runs.filter(run => run.route === route))
  const latest = $derived(routeRuns.at(-1))

  const start = () => {
    error = ""
    startPerformanceDiagnosticsCapture({route, preset, context})
  }

  const stop = () => stopPerformanceDiagnosticsCapture()

  const download = async () => {
    preparing = true
    error = ""
    try {
      const artifact = await preparePerformanceDiagnosticsArtifact(snapshot, {runId: latest?.id})
      const url = URL.createObjectURL(
        new Blob([artifact.bytes as BlobPart], {type: artifact.contentType}),
      )
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = artifact.filename
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      preparing = false
    }
  }

  onDestroy(() => {
    if (activeHere) stopPerformanceDiagnosticsCapture("cancelled")
  })
</script>

{#if PERFORMANCE_DIAGNOSTICS_ENABLED}
  <div class="relative" data-perf="diagnostics-control">
    <Button class="btn btn-ghost btn-xs font-mono" onclick={() => (open = !open)}>Perf</Button>
    {#if open}
      <section
        class="card2 fixed right-3 top-16 z-[100] w-[min(24rem,calc(100vw-1.5rem))] gap-3 border border-base-300 bg-base-100 p-4 shadow-xl"
        aria-label="Performance diagnostics">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="font-semibold">Performance diagnostics</h2>
            <p class="break-all font-mono text-xs opacity-60">{route}</p>
          </div>
          <button class="btn btn-ghost btn-xs" type="button" onclick={() => (open = false)}
            >Close</button>
        </div>

        <dl class="grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt class="opacity-60">Runs</dt>
            <dd>{routeRuns.length}</dd>
          </div>
          <div>
            <dt class="opacity-60">Milestones</dt>
            <dd>{latest?.milestones.length || 0}</dd>
          </div>
          <div>
            <dt class="opacity-60">Duration</dt>
            <dd>
              {latest?.durationMs === undefined ? "-" : `${Math.round(latest.durationMs)} ms`}
            </dd>
          </div>
        </dl>

        <div class="flex flex-wrap gap-2">
          {#if activeHere}
            <Button class="btn btn-warning btn-sm" onclick={stop}>Stop capture</Button>
          {:else}
            <Button class="btn btn-primary btn-sm" onclick={start}>Start capture</Button>
          {/if}
          <Button class="btn btn-neutral btn-sm" disabled={!latest || preparing} onclick={download}>
            {preparing ? "Preparing..." : "Download"}
          </Button>
          <Button
            class="btn btn-ghost btn-sm"
            disabled={snapshot.runs.length === 0}
            onclick={clearPerformanceDiagnostics}>
            Clear
          </Button>
        </div>
        {#if error}<p class="text-xs text-error">{error}</p>{/if}
      </section>
    {/if}
  </div>
{/if}
