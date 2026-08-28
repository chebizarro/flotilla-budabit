<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {pushToast} from "@app/util/toast"
  import DeleteWithProgressConfirm from "@app/components/DeleteWithProgressConfirm.svelte"
  import {deleteIssueWithLabels} from "@app/core/git-commands"
  import type {DeleteInventoryOutcome} from "@app/core/git-deletion-inventory"

  type Props = {
    event: TrustedEvent
    relays?: string[]
    repoAddress?: string
  }

  const {event, relays = [], repoAddress = ""}: Props = $props()
  let acceptedInventory: DeleteInventoryOutcome | undefined

  const approveInventory = (outcome: DeleteInventoryOutcome) => {
    const partialRelays = new Set(
      outcome.requests
        .filter(request => request.transport.outcome !== "eose")
        .map(request => request.relay),
    )
    const foreign = outcome.excludedByReason["foreign-author"] || 0
    const unsupported = Object.entries(outcome.excludedByReason).reduce(
      (sum, [reason, count]) => sum + (reason === "foreign-author" ? 0 : count || 0),
      0,
    )
    const related = outcome.targets.filter(target => target.policy === "best-effort").length
    const groups = new Map<string, number>()
    for (const target of outcome.targets.filter(target => target.policy === "best-effort")) {
      const key = `${target.relation}/kind ${target.targetKind}`
      groups.set(key, (groups.get(key) || 0) + 1)
    }
    const exclusions = Object.entries(outcome.excludedByReason)
      .filter(([, count]) => count)
      .map(([reason, count]) => `${reason}: ${count}`)
      .join(", ")
    const partialRequests = outcome.requests
      .filter(request => request.transport.outcome !== "eose")
      .map(request => `round ${request.round}/chunk ${request.chunk} at ${request.relay}`)
      .join(", ")
    const approved = window.confirm(
      `Deletion preview: 1 required issue. Best-effort (${related}): ${Array.from(groups, ([group, count]) => `${group}: ${count}`).join(", ") || "none"}. Exclusions: ${exclusions || `foreign: ${foreign}, unsupported: ${unsupported}`}. Inventory is ${outcome.complete ? "complete at EOSE" : `partial: ${partialRequests || `${partialRelays.size} relays`}`}. Send these deletion requests?`,
    )
    if (approved) acceptedInventory = outcome
    return approved
  }

  const startDelete = ({
    signal,
    onProgress,
  }: {
    signal: AbortSignal
    onProgress: (progress: any) => void
  }) =>
    deleteIssueWithLabels({
      issue: event,
      relays,
      repoAddress: repoAddress || undefined,
      signal,
      onProgress,
      onInventory: approveInventory,
    })

  const onSuccess = (result: unknown) => {
    const {labelsDeleted = 0, labelsFailed = 0} = (result || {}) as {
      labelsDeleted?: number
      labelsFailed?: number
    }
    const totalDeleted = 1 + labelsDeleted

    pushToast({
      theme: labelsFailed > 0 ? "warning" : undefined,
      timeout: labelsFailed > 0 ? 0 : undefined,
      message:
        labelsFailed > 0
          ? `Issue root acknowledged; ${labelsFailed} authored related event${labelsFailed === 1 ? "" : "s"} remain unconfirmed. Inventory was ${acceptedInventory?.complete ? "complete" : "partial"}.`
          : `Issue root acknowledged; deletion requests acknowledged for ${totalDeleted} event${totalDeleted === 1 ? "" : "s"}. Inventory was ${acceptedInventory?.complete ? "complete" : "partial"}.`,
      ...(labelsFailed > 0
        ? {
            action: {
              message: "Retry cleanup",
              onclick: async () => {
                try {
                  const retried = await startDelete({
                    signal: new AbortController().signal,
                    onProgress: () => undefined,
                  })
                  pushToast({
                    theme: retried.labelsFailed > 0 ? "warning" : "success",
                    message:
                      retried.labelsFailed > 0
                        ? `${retried.labelsFailed} authored event${retried.labelsFailed === 1 ? "" : "s"} still unconfirmed.`
                        : "Optional issue cleanup acknowledged.",
                  })
                } catch (error) {
                  pushToast({
                    theme: "error",
                    message: error instanceof Error ? error.message : "Optional cleanup failed",
                  })
                }
              },
            },
          }
        : {}),
    })
  }
</script>

<DeleteWithProgressConfirm
  {startDelete}
  {onSuccess}
  title="Delete Issue"
  subtitle="Are you sure you want to delete this issue?"
  message="Deletion requests will be sent for this issue and supported labels, description edits, statuses, direct-root comments, and reactions you authored. Events from other authors, nested legacy replies, and unsupported metadata will remain. Some relays may retain deleted events."
  errorMessage="Failed to delete issue"
  cancelMessage="Issue deletion cancelled"
  confirmLabel="Delete issue" />
