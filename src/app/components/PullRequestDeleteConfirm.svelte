<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {pushToast} from "@app/util/toast"
  import DeleteWithProgressConfirm from "@app/components/DeleteWithProgressConfirm.svelte"
  import {deletePullRequestWithRelated} from "@app/core/git-commands"
  import type {DeleteInventoryOutcome} from "@app/core/git-deletion-inventory"

  type Props = {
    event: TrustedEvent
    relays?: string[]
    repoAddress?: string
  }

  const {event, relays = [], repoAddress = ""}: Props = $props()
  let acceptedInventory: DeleteInventoryOutcome | undefined

  const noun = "pull request"
  const title = "Delete Pull Request"

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
      `Deletion preview: 1 required pull request. Best-effort (${related}): ${Array.from(groups, ([group, count]) => `${group}: ${count}`).join(", ") || "none"}. Exclusions: ${exclusions || `foreign: ${foreign}, unsupported: ${unsupported}`}. Inventory is ${outcome.complete ? "complete at EOSE" : `partial: ${partialRequests || `${partialRelays.size} relays`}`}. Send these deletion requests?`,
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
    deletePullRequestWithRelated({
      root: event,
      relays,
      repoAddress: repoAddress || undefined,
      signal,
      onProgress,
      onInventory: approveInventory,
    })

  const onSuccess = (result: unknown) => {
    const {deletedEvents = 0, relatedFailed = 0} = (result || {}) as {
      deletedEvents?: number
      relatedFailed?: number
    }

    pushToast({
      theme: relatedFailed > 0 ? "warning" : undefined,
      timeout: relatedFailed > 0 ? 0 : undefined,
      message:
        relatedFailed > 0
          ? `Pull request root acknowledged; ${relatedFailed} authored event${relatedFailed === 1 ? "" : "s"} remain unconfirmed. Inventory was ${acceptedInventory?.complete ? "complete" : "partial"}.`
          : `Pull request root acknowledged; deletion requests acknowledged for ${deletedEvents} event${deletedEvents === 1 ? "" : "s"}. Inventory was ${acceptedInventory?.complete ? "complete" : "partial"}.`,
      ...(relatedFailed > 0
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
                    theme: retried.relatedFailed > 0 ? "warning" : "success",
                    message:
                      retried.relatedFailed > 0
                        ? `${retried.relatedFailed} authored event${retried.relatedFailed === 1 ? "" : "s"} still unconfirmed.`
                        : "Optional pull request cleanup acknowledged.",
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
  {title}
  subtitle={`Are you sure you want to delete this ${noun}?`}
  message="Deletion requests will be sent for this pull request and supported updates, labels, description edits, statuses, direct-root comments, and reactions you authored. Events from other authors, nested legacy replies, and unsupported metadata will remain. Some relays may retain deleted events."
  errorMessage={`Failed to delete ${noun}`}
  cancelMessage="Pull request deletion cancelled"
  confirmLabel={title} />
