<script lang="ts">
  import {page} from "$app/stores"
  import type {Snippet} from "svelte"
  import RepoSession from "./RepoSession.svelte"

  type Props = {
    data: Record<string, unknown>
    children: Snippet
  }

  const {data, children}: Props = $props()
  const sessionKey = $derived($page.params.id)
</script>

{#key sessionKey}
  <RepoSession {data} {children} />
{/key}
