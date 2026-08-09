<script lang="ts">
  import {goto} from "$app/navigation"
  import {pubkey} from "@welshman/app"
  import Button from "@lib/components/Button.svelte"
  import {publicationOperations, retryPublication} from "@app/core/publication-operations"
  import {popToast, type Toast} from "@app/util/toast"

  type Props = {
    toast: Toast
    operationId: string
  }

  const {toast, operationId}: Props = $props()
  const operation = $derived($publicationOperations.get(operationId))
  const accountMismatch = $derived(Boolean(operation && $pubkey !== operation.ownerPubkey))
  let retrying = $state(false)
  let retryError = $state("")

  const retry = async () => {
    if (!operation || retrying || accountMismatch) return

    retrying = true
    retryError = ""
    try {
      await retryPublication(operationId)
    } catch (error) {
      retryError = error instanceof Error ? error.message : "Failed to retry publication"
    } finally {
      retrying = false
    }
  }

  const view = () => {
    if (operation?.href) void goto(operation.href)
  }

  $effect(() => {
    if (operation) return
    popToast(toast.id)
  })

  $effect(() => {
    if (operation?.phase !== "confirmed") return

    const timeout = setTimeout(() => popToast(toast.id), 2_000)
    return () => clearTimeout(timeout)
  })
</script>

{#if operation}
  <span class="flex min-w-0 flex-col gap-1.5" aria-live="polite">
    <strong class="text-sm [overflow-wrap:anywhere]">{operation.label}</strong>

    {#if operation.phase === "confirmed"}
      <span class="text-xs opacity-75">Published</span>
    {:else if operation.phase === "publishing" || retrying}
      <span class="text-xs opacity-75">Publishing...</span>
    {:else}
      <span class="text-xs opacity-75">Publication was not confirmed by any relay.</span>
      {#if accountMismatch}
        <span class="text-xs text-warning">
          Restore the account that created this publication to retry.
        </span>
      {:else if retryError}
        <span class="text-xs text-error">{retryError}</span>
      {/if}
      <span class="flex flex-wrap items-center gap-2">
        <Button
          class="btn btn-primary btn-xs"
          onclick={retry}
          disabled={retrying || accountMismatch}>
          Retry
        </Button>
        {#if operation.href}
          <Button class="btn btn-ghost btn-xs" onclick={view}>View</Button>
        {/if}
      </span>
    {/if}
  </span>
{/if}
