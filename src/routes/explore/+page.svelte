<script lang="ts">
  import {pubkey} from "@welshman/app"
  import AddCircle from "@assets/icons/add-circle.svg?dataurl"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import LogIn from "@app/components/LogIn.svelte"
  import CommunityLinkCard from "@app/components/community/CommunityLinkCard.svelte"
  import type {CommunitySearchResult} from "@app/core/community-discovery-search"
  import {searchCommunities} from "@app/core/community-discovery-search"
  import {
    DEFAULT_COMMUNITY_POINTER,
    activeExactCommunityPointer,
    activePreferredCommunities,
  } from "@app/core/community-state"

  let query = $state("")
  let results = $state<CommunitySearchResult[]>([])
  let searched = $state(false)
  let loading = $state(false)
  let incomplete = $state(false)
  let error = $state("")
  let searchController: AbortController | undefined

  const findCommunities = async () => {
    const value = query.trim()
    searchController?.abort()
    const controller = new AbortController()
    searchController = controller
    searched = Boolean(value)
    error = ""
    incomplete = false
    if (!value) {
      results = []
      loading = false
      return
    }

    loading = true
    try {
      const batch = await searchCommunities(value, {
        signal: controller.signal,
        preferredAddresses: $activePreferredCommunities.map(item => item.communityAddress),
      })
      if (controller.signal.aborted) return
      results = batch.results
      incomplete = batch.incomplete
    } catch {
      if (!controller.signal.aborted) error = "Community search is temporarily unavailable."
    } finally {
      if (!controller.signal.aborted) loading = false
    }
  }
</script>

<PageBar>
  {#snippet icon()}<div class="center"><Icon icon={HomeSmile} /></div>{/snippet}
  {#snippet title()}<strong>Explore communities</strong>{/snippet}
</PageBar>

<PageContent class="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 sm:p-6">
  <section class="card2 overflow-hidden p-0">
    <div class="bg-primary px-5 py-6 text-primary-content sm:px-7">
      <p class="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">Find your people</p>
      <h1 class="mt-2 text-2xl font-bold sm:text-3xl">Discover communities</h1>
      <p class="mt-2 max-w-2xl opacity-80">
        Search by community name, community link, creator profile, or NIP-05 address.
      </p>
    </div>
    <form
      class="flex flex-col gap-3 p-5 sm:flex-row sm:p-7"
      onsubmit={event => {
        event.preventDefault()
        void findCommunities()
      }}>
      <label class="min-w-0 flex-1">
        <span class="mb-1 block text-sm font-medium">Search communities</span>
        <input
          class="input input-bordered w-full text-sm"
          bind:value={query}
          placeholder="Name, community link, npub, or name@example.com"
          autocomplete="off" />
      </label>
      <Button class="btn btn-primary self-end" type="submit" disabled={loading}>
        {#if loading}<span class="loading loading-spinner loading-sm"></span>{/if}
        Search
      </Button>
    </form>
    {#if error}<p class="px-5 pb-5 text-sm text-error sm:px-7">{error}</p>{/if}
  </section>

  {#if searched}
    <section class="flex flex-col gap-3" aria-live="polite">
      <div class="flex items-end justify-between gap-3">
        <h2 class="font-semibold">Search results</h2>
        {#if incomplete}<p class="text-xs opacity-60">Showing the strongest matches</p>{/if}
      </div>
      {#if !loading && results.length === 0 && !error}
        <div class="card2 p-5 text-sm opacity-70">No matching communities found.</div>
      {/if}
      {#each results as result (result.definition.pointer.address)}
        <div class="relative">
          {#if result.preferred}
            <span class="z-10 badge badge-neutral badge-sm absolute right-3 top-3">Yours</span>
          {/if}
          <CommunityLinkCard
            value={result.definition.pointer}
            initialDefinition={result.definition} />
        </div>
      {/each}
    </section>
  {:else if DEFAULT_COMMUNITY_POINTER}
    <section class="flex flex-col gap-2">
      <p class="text-sm font-semibold">Recommended starting community</p>
      <CommunityLinkCard value={DEFAULT_COMMUNITY_POINTER} />
    </section>
  {/if}

  {#if $activeExactCommunityPointer}
    <section class="flex flex-col gap-2">
      <p class="text-sm font-semibold">Last visited</p>
      <CommunityLinkCard value={$activeExactCommunityPointer} />
    </section>
  {/if}

  {#if $activePreferredCommunities.length > 0}
    <section class="flex flex-col gap-3">
      <h2 class="font-semibold">Your communities</h2>
      {#each $activePreferredCommunities as community (community.communityAddress)}
        <div class="relative">
          <div class="z-10 absolute right-3 top-3 flex gap-1">
            {#if community.isAdmin}<span class="badge badge-neutral badge-sm">Admin</span>{/if}
            {#if community.isModerator}<span class="badge badge-neutral badge-sm">Moderator</span
              >{/if}
            {#if community.isMember}<span class="badge badge-neutral badge-sm">Member</span>{/if}
            {#if community.isStarred}<span class="badge badge-neutral badge-sm">Starred</span>{/if}
          </div>
          <CommunityLinkCard value={community.pointer} />
        </div>
      {/each}
    </section>
  {/if}

  <section class="card2 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h2 class="font-semibold">Create a community</h2>
      <p class="text-sm opacity-70">Start a new community with its own name and spaces.</p>
    </div>
    {#if $pubkey}
      <a class="btn btn-neutral gap-2" href="/explore/create-community">
        <Icon icon={AddCircle} size={5} /> Create
      </a>
    {:else}
      <LogIn />
    {/if}
  </section>
</PageContent>
