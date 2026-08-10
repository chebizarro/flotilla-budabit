<script lang="ts">
  import {onDestroy} from "svelte"
  import Refresh from "@assets/icons/refresh-circle.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import PublicationRecoveryList from "@app/components/PublicationRecoveryList.svelte"
  import PublicationRecoveryToast from "@app/components/PublicationRecoveryToast.svelte"
  import {publicationOperations} from "@app/core/publication-operations"
  import {pushModal} from "@app/util/modal"
  import {popToast, pushToast, toast} from "@app/util/toast"

  const emittedAttempts = new Map<string, number>()
  const toastIds = new Map<string, string>()
  const recoverableOperations = $derived.by(() =>
    Array.from($publicationOperations.values()).filter(operation =>
      ["publishing", "unconfirmed"].includes(operation.phase),
    ),
  )

  const openRecovery = () => pushModal(PublicationRecoveryList)

  $effect(() => {
    const operations = $publicationOperations
    const visibleToastIds = new Set($toast.map(item => item.id))

    for (const operationId of emittedAttempts.keys()) {
      if (!operations.has(operationId)) {
        const toastId = toastIds.get(operationId)
        if (toastId) popToast(toastId)
        emittedAttempts.delete(operationId)
        toastIds.delete(operationId)
      }
    }

    for (const operation of operations.values()) {
      if (operation.phase !== "unconfirmed") continue
      if ((emittedAttempts.get(operation.operationId) || 0) >= operation.attempt) continue

      emittedAttempts.set(operation.operationId, operation.attempt)
      const existingToastId = toastIds.get(operation.operationId)
      if (existingToastId && visibleToastIds.has(existingToastId)) continue

      toastIds.set(
        operation.operationId,
        pushToast({
          timeout: 0,
          children: {
            component: PublicationRecoveryToast,
            props: {operationId: operation.operationId},
          },
        }),
      )
    }
  })

  onDestroy(() => {
    for (const toastId of toastIds.values()) popToast(toastId)
    toastIds.clear()
    emittedAttempts.clear()
  })
</script>

{#if recoverableOperations.length > 0}
  <Button
    class="bottom-sai left-sai btn btn-warning btn-sm fixed z-toast m-4 shadow-lg"
    onclick={openRecovery}
    aria-label={`Open publication recovery with ${recoverableOperations.length} item${recoverableOperations.length === 1 ? "" : "s"}`}>
    <Icon icon={Refresh} size={4} />
    Publication recovery
    <span class="badge badge-sm">{recoverableOperations.length}</span>
  </Button>
{/if}
