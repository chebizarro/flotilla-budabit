<script lang="ts">
  import CommunityMenu from "@app/components/CommunityMenu.svelte"
  import {activeExactCommunityPointer} from "@app/core/community-state"
  import {recordPerformanceDiagnosticsInteractionPaint} from "@app/core/performance-diagnostics"
  import {pushDrawer} from "@app/util/modal"
  import MenuDots from "@assets/icons/menu-dots.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"

  const communityPointer = $derived($activeExactCommunityPointer)
  let inputStartedAt = 0

  const openCommunityMenu = () => {
    if (!communityPointer) return

    const handlerStartedAt = performance.now()
    const modalId = pushDrawer(CommunityMenu, {community: communityPointer}, {replaceState: true})
    const stateChangedAt = performance.now()
    if (modalId) {
      recordPerformanceDiagnosticsInteractionPaint({
        owner: "git-community-menu",
        inputStartedAt: inputStartedAt || handlerStartedAt,
        handlerStartedAt,
        stateChangedAt,
      })
    }
    inputStartedAt = 0
  }
</script>

{#if communityPointer}
  <Button
    aria-label="Open community menu"
    onpointerdown={() => (inputStartedAt = performance.now())}
    onclick={openCommunityMenu}
    class="btn btn-neutral btn-sm lg:hidden">
    <Icon icon={MenuDots} />
  </Button>
{/if}
