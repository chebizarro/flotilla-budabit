<script lang="ts">
  import {RepoHeader, RepoTab} from "@nostr-git/ui"
  import {page} from "$app/stores"
  import {deriveNaddrEvent} from "@app/state"
  import PageContent from "@src/lib/components/PageContent.svelte"
  import {FileCode, GitBranch, CircleAlert, GitPullRequest, Book} from "@lucide/svelte"
  import {type RepoAnnouncementEvent} from "@nostr-git/shared-types"
  const {id, relay} = $page.params
  const relayArray = Array.isArray(relay) ? relay : [relay]
  const eventStore = deriveNaddrEvent(id, relayArray)
  let {children} = $props()
</script>

<PageContent class="flex flex-grow flex-col gap-2 overflow-auto p-8">
  {#if $eventStore === undefined}
    <div class="p-4 text-center">Loading repository...</div>
  {:else if !$eventStore}
    <div class="p-4 text-center text-red-500">Repository not found.</div>
  {:else}
    <RepoHeader event={$eventStore as RepoAnnouncementEvent}>
      {#snippet children()}
        <RepoTab tabValue="overview" label="Overview" href="overview">
          {#snippet icon()}
            <FileCode class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab tabValue="code" label="Code" href={`./${id}/code`}>
          {#snippet icon()}
            <GitBranch class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab tabValue="issues" label="Issues" href="issues">
          {#snippet icon()}
            <CircleAlert class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab tabValue="patches" label="Patches" href="patches">
          {#snippet icon()}
            <GitPullRequest class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab tabValue="wiki" label="Wiki" href="wiki">
          {#snippet icon()}
            <Book class="h-4 w-4" />
          {/snippet}
        </RepoTab>
      {/snippet}
    </RepoHeader>
    {@render children()}
  {/if}
</PageContent>
