<script lang="ts">
  import type {Snippet} from "svelte"
  import {page} from "$app/stores"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Page from "@lib/components/Page.svelte"
  import SecondaryNav from "@lib/components/SecondaryNav.svelte"
  import Link from "@lib/components/Link.svelte"
  import CommunityMenu from "@app/components/CommunityMenu.svelte"
  import {activeExactCommunityPointer} from "@app/core/community-state"

  type Props = {
    children?: Snippet
  }

  const {children}: Props = $props()
  const activeCommunity = $derived($activeExactCommunityPointer)
</script>

{#if activeCommunity}
  <SecondaryNav>
    <CommunityMenu community={activeCommunity} />
  </SecondaryNav>
{/if}

<Page class={activeCommunity ? "" : "cw-full"}>
  {#if $page.url.pathname !== "/settings"}
    <div class="content-padding-x hidden pb-2 pt-4 md:block lg:hidden">
      <Link href="/settings" class="btn btn-ghost btn-sm w-fit">
        <Icon icon={AltArrowLeft} /> Back
      </Link>
    </div>
  {/if}
  {@render children?.()}
</Page>
