<script lang="ts">
  import {goto} from "$app/navigation"
  import {PERFORMANCE_DIAGNOSTICS_ENABLED} from "@app/core/feature-flags"
  import {
    activePerformanceDiagnosticsRun,
    hasPerformanceDiagnosticsRun,
    performanceDiagnosticsRevision,
  } from "@app/core/performance-diagnostics"

  type Props = {route: string}
  const {route}: Props = $props()
  const activeHere = $derived($activePerformanceDiagnosticsRun?.route === route)
  const capturedHere = $derived.by(() => {
    void $performanceDiagnosticsRevision
    return hasPerformanceDiagnosticsRun(route)
  })
</script>

{#if PERFORMANCE_DIAGNOSTICS_ENABLED && (activeHere || capturedHere)}
  <button
    type="button"
    class="btn btn-ghost btn-xs font-mono"
    data-perf="diagnostics-status"
    onclick={() => goto("/settings/performance")}>
    {activeHere ? "Perf: recording" : "Perf: captured"}
  </button>
{/if}
