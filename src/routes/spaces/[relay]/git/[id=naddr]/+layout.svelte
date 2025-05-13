<script lang="ts">
  import {RepoHeader, RepoTab} from "@nostr-git/ui"
  import {page} from "$app/stores"
  import {deriveNaddrEvent} from "@app/state"
  import PageContent from "@src/lib/components/PageContent.svelte"
  import {FileCode, GitBranch, CircleAlert, GitPullRequest, Book} from "@lucide/svelte"
  import {type RepoAnnouncementEvent} from "@nostr-git/shared-types"
  import {setContext} from "svelte"

  const {id, relay} = $page.params
  const encodeddRelay = encodeURIComponent(relay)
  const relayArray = Array.isArray(relay) ? relay : [relay]
  const eventStore = deriveNaddrEvent(id, relayArray)
  let {children} = $props()
  let activeTab: string | undefined = $page.url.pathname.split("/").pop()
  setContext("repo-event", eventStore)
</script>

<PageContent class="flex flex-grow flex-col gap-2 overflow-auto p-8">
  {#if $eventStore === undefined}
    <div class="p-4 text-center">Loading repository...</div>
  {:else if !$eventStore}
    <div class="p-4 text-center text-red-500">Repository not found.</div>
  {:else}
    <RepoHeader event={$eventStore as RepoAnnouncementEvent} {activeTab}>
      {#snippet children(activeTab)}
        <RepoTab
          tabValue="overview"
          label="Overview"
          href={`/spaces/${encodeddRelay}/git/${id}`}
          {activeTab}>
          {#snippet icon()}
            <FileCode class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="code"
          label="Code"
          href={`/spaces/${encodeddRelay}/git/${id}/code`}
          {activeTab}>
          {#snippet icon()}
            <GitBranch class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="issues"
          label="Issues"
          href={`/spaces/${encodeddRelay}/git/${id}/issues`}
          {activeTab}>
          {#snippet icon()}
            <CircleAlert class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="patches"
          label="Patches"
          href={`/spaces/${encodeddRelay}/git/${id}/patches`}
          {activeTab}>
          {#snippet icon()}
            <GitPullRequest class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="wiki"
          label="Wiki"
          href={`/spaces/${encodeddRelay}/git/${id}/wiki`}
          {activeTab}>
          {#snippet icon()}
            <Book class="h-4 w-4" />
          {/snippet}
        </RepoTab>
      {/snippet}
    </RepoHeader>
    {@render children()}
  {/if}
</PageContent>
