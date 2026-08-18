<script lang="ts">
  import {page} from "$app/stores"
  import CommunityWidgetSlotLaunchers from "@app/components/community/CommunityWidgetSlotLaunchers.svelte"
  import {
    activeCommunityAuthorityReadiness,
    activeExactCommunityDefinition,
    activeExactCommunityPointer,
    activeExactCommunityRelays,
  } from "@app/core/community-state"

  const exactCommunity = $derived($activeExactCommunityPointer)
  const relayHints = $derived($activeExactCommunityRelays)
  const permissionReadiness = $derived(
    $activeCommunityAuthorityReadiness.communityPubkey === exactCommunity?.controllerPubkey
      ? $activeCommunityAuthorityReadiness.state
      : "loading",
  )
  const communityCoreReady = $derived(
    Boolean(
      exactCommunity &&
      $activeExactCommunityDefinition?.pointer.address === exactCommunity.address &&
      permissionReadiness === "ready",
    ),
  )
</script>

{#if exactCommunity && communityCoreReady}
  <CommunityWidgetSlotLaunchers
    communityPubkey={exactCommunity.controllerPubkey}
    communityAddress={exactCommunity.address}
    {relayHints}
    slotType="global-menu"
    variant="top-menu"
    context={{route: $page.url.pathname}} />
{/if}
