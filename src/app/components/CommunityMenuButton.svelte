<script lang="ts">
  import CommunityMenu from "@app/components/CommunityMenu.svelte"
  import {activeExactCommunityPointer} from "@app/core/community-state"
  import {parseExactCommunityRouteParam} from "@app/util/routes"
  import {pushDrawer} from "@app/util/modal"
  import MenuDots from "@assets/icons/menu-dots.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"

  type Props = {
    community?: string
  }

  const {community}: Props = $props()
  const communityPointer = $derived(
    parseExactCommunityRouteParam(community) || $activeExactCommunityPointer,
  )

  const openCommunityMenu = () => {
    if (communityPointer)
      pushDrawer(CommunityMenu, {community: communityPointer}, {replaceState: true})
  }
</script>

{#if communityPointer}
  <Button
    aria-label="Open community menu"
    onclick={openCommunityMenu}
    class="btn btn-neutral btn-sm lg:hidden">
    <Icon icon={MenuDots} />
  </Button>
{/if}
