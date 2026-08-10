<script lang="ts">
  import {pubkey} from "@welshman/app"
  import Star from "@assets/icons/star.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import LogIn from "@app/components/LogIn.svelte"
  import {makeDelete} from "@app/core/commands"
  import {
    activeCommunityStarByCommunity,
    getCommunityStarRelays,
    hydrateCommunityStars,
  } from "@app/core/community-state"
  import {normalizeRelays} from "@app/core/community"
  import {makeCommunityDefinitionAddress} from "@app/core/community-forms"
  import {
    discardPublication,
    publicationOperations,
    retryPublication,
    startPublication,
  } from "@app/core/publication-operations"
  import {
    getCommunityStarOperationSemanticKey,
    projectCommunityStarOperation,
  } from "@app/core/community-star-operations"
  import {pushToast} from "@app/util/toast"
  import {pushModal} from "@app/util/modal"
  import {makeCommunityStarReaction} from "@app/util/community-stars"

  type Props = {
    communityPubkey: string
    relayHints?: string[]
    publishRelayHints?: string[]
    class?: string
  }

  const {
    communityPubkey,
    relayHints = [],
    publishRelayHints = undefined,
    class: className = "btn btn-square btn-sm",
  }: Props = $props()

  const relays = $derived(getCommunityStarRelays(relayHints))
  const publishRelays = $derived(
    publishRelayHints === undefined ? relays : normalizeRelays(publishRelayHints),
  )
  const starProjection = $derived(
    projectCommunityStarOperation({
      star: $activeCommunityStarByCommunity.get(communityPubkey),
      operations: $publicationOperations.values(),
      ownerPubkey: $pubkey || "",
      communityPubkey,
    }),
  )
  const star = $derived(starProjection.star)
  const toggling = $derived(starProjection.pending)

  const toggleStar = () => {
    if (!$pubkey) {
      pushModal(LogIn)
      return
    }
    if (!communityPubkey || publishRelays.length === 0) {
      pushToast({theme: "error", message: "No relays available for updating this star."})
      return
    }

    try {
      const desiredStarred = !star
      if (
        starProjection.retryOperationId &&
        starProjection.retryDesiredStarred === desiredStarred
      ) {
        void retryPublication(starProjection.retryOperationId).catch(error => {
          pushToast({
            theme: "error",
            message: `Failed to retry star: ${error instanceof Error ? error.message : String(error)}`,
          })
        })
        return
      }
      const supersededStarEventId = starProjection.retryDesiredStarred
        ? starProjection.retryEventId
        : undefined
      if (starProjection.retryOperationId) {
        discardPublication(starProjection.retryOperationId)
      }

      if (star) {
        startPublication({
          event: makeDelete({
            event: star.reaction,
            tags: supersededStarEventId ? [["e", supersededStarEventId]] : [],
          }),
          relays: publishRelays,
          label: "Unstar community",
          semanticKey: getCommunityStarOperationSemanticKey(communityPubkey),
          preview: "rollback-on-failure",
        })
      } else {
        const event = makeCommunityStarReaction({
          communityPubkey,
          relayHints: publishRelayHints ?? relayHints,
        })
        startPublication({
          event,
          relays: publishRelays,
          label: "Star community",
          semanticKey: getCommunityStarOperationSemanticKey(communityPubkey),
          preview: "rollback-on-failure",
        })
      }
    } catch (error) {
      pushToast({
        theme: "error",
        message: `Failed to update star: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  $effect(() => {
    const address = makeCommunityDefinitionAddress(communityPubkey)
    if (!$pubkey || !address) return

    hydrateCommunityStars({relayHints, communityAddress: address}).catch(() => {})
  })
</script>

<button
  type="button"
  class="{className} {star ? 'btn-primary' : 'btn-outline'}"
  disabled={!communityPubkey || toggling}
  aria-label={star ? "Unstar community" : "Star community"}
  title={star ? "Unstar community" : "Star community"}
  onclick={toggleStar}>
  <Icon icon={Star} />
</button>
