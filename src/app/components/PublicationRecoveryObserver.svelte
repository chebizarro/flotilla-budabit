<script lang="ts">
  import PublicationRecoveryToast from "@app/components/PublicationRecoveryToast.svelte"
  import {publicationOperations} from "@app/core/publication-operations"
  import {pushToast, toast} from "@app/util/toast"

  const emittedAttempts = new Map<string, number>()
  const toastIds = new Map<string, string>()

  $effect(() => {
    const operations = $publicationOperations
    const visibleToastIds = new Set($toast.map(item => item.id))

    for (const operationId of emittedAttempts.keys()) {
      if (!operations.has(operationId)) {
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
</script>
