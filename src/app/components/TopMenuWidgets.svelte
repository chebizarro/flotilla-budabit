<script lang="ts">
  import {page} from "$app/stores"
  import {pubkey} from "@welshman/app"
  import CommunityWidgetSlotLaunchers from "@app/components/community/CommunityWidgetSlotLaunchers.svelte"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityAuthorityReadiness,
    activeCommunityDefinition,
    activeCommunityRelays,
    activeCommunitySession,
    getCommunityBootstrapKey,
  } from "@app/core/community-state"
  import {isCommunityHomeCoreReady} from "@app/extensions/community-home-readiness"
  import {parseCommunityRouteParam} from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const relayHints = $derived(
    $activeCommunityRelays.length > 0 ? $activeCommunityRelays : parsedCommunity?.relays || [],
  )
  const expectedBootstrapKey = $derived(
    parsedCommunity && $activeCommunitySession?.communityPubkey === parsedCommunity.pubkey
      ? getCommunityBootstrapKey($activeCommunitySession, $pubkey || "")
      : "",
  )
  const permissionReadiness = $derived(
    $activeCommunityAuthorityReadiness.communityPubkey === parsedCommunity?.pubkey
      ? $activeCommunityAuthorityReadiness.state
      : "loading",
  )
  const communityCoreReady = $derived(
    isCommunityHomeCoreReady({
      communityPubkey: parsedCommunity?.pubkey || "",
      definitionPubkey: $activeCommunityDefinition?.pubkey || "",
      expectedBootstrapKey,
      permissionReadiness,
      bootstrapStatus: $activeCommunityBootstrapStatus,
    }),
  )
</script>

{#if parsedCommunity && communityCoreReady}
  <CommunityWidgetSlotLaunchers
    communityPubkey={parsedCommunity.pubkey}
    {relayHints}
    slotType="global-menu"
    variant="top-menu"
    context={{route: $page.url.pathname}} />
{/if}
