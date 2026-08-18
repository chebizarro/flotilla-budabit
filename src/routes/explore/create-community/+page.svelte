<script lang="ts">
  import {browser} from "$app/environment"
  import {replaceState} from "$app/navigation"
  import {page} from "$app/stores"
  import {randomId} from "@welshman/lib"
  import Page from "@lib/components/Page.svelte"
  import CommunityCreate from "@app/components/CommunityCreate.svelte"

  let operationId = $state("")

  $effect(() => {
    if (!browser || operationId) return

    operationId = $page.url.searchParams.get("operation") || randomId()
    if ($page.url.searchParams.has("operation")) return

    const url = new URL($page.url)
    url.searchParams.set("operation", operationId)
    replaceState(url, $page.state)
  })
</script>

<Page class="cw-full bg-base-200">
  {#if operationId}
    <CommunityCreate {operationId} />
  {/if}
</Page>
