<script lang="ts">
  import {page} from "$app/stores"
  import CommunityWidgetSlotLaunchers from "@app/components/community/CommunityWidgetSlotLaunchers.svelte"
  import {activeCommunityDescriptor} from "@app/core/community-state"

  const descriptor = $derived($activeCommunityDescriptor)
  const communityCoreReady = $derived(
    Boolean(descriptor?.definition && descriptor.authorityReadiness.state === "ready"),
  )
</script>

{#if descriptor && communityCoreReady}
  <CommunityWidgetSlotLaunchers
    community={descriptor.community}
    slotType="global-menu"
    variant="top-menu"
    context={{route: $page.url.pathname}} />
{/if}
