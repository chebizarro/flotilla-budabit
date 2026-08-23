<script lang="ts">
  import {MediaQuery} from "svelte/reactivity"

  interface Props {
    children?: import("svelte").Snippet
    visibleClass?: string
    minWidth?: number
  }

  const {children, visibleClass = "lg:flex", minWidth = 1024}: Props = $props()
  const visible = new MediaQuery(`min-width: ${minWidth}px`, false)
</script>

<div
  class="ml-sai mt-sai mb-sai hidden max-h-screen w-60 flex-shrink-0 flex-col gap-1 bg-base-300 {visibleClass}">
  {#if visible.current}
    {@render children?.()}
  {/if}
</div>
