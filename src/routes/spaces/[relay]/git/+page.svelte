<script lang="ts">
  import { decodeRelay, shouldReloadRepos } from "@src/app/state"
  import { load } from "@welshman/app"
  import { pubkey, userMutes } from "@welshman/app"
  import { getPubkeyTagValues, getListTags, NAMED_BOOKMARKS, getAddressTags, type TrustedEvent, type Filter, Address } from "@welshman/util"
  import { onMount, tick } from "svelte";
  import {page} from "$app/stores"
  import {derived, type Writable, writable} from "svelte/store"
  import { setChecked } from "@src/app/notifications"
  import PageBar from "@src/lib/components/PageBar.svelte"
  import Icon from "@src/lib/components/Icon.svelte"
  import MenuSpaceButton from "@src/app/components/MenuSpaceButton.svelte"
  import Button from "@src/lib/components/Button.svelte"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import { ctx, sortBy } from "@welshman/lib"
  import { fly } from "@src/lib/transition"
  import { pushModal } from "@src/app/modal"
  import RepoPicker from "@src/app/components/RepoPicker.svelte"
  import { GIT_REPO } from "@src/lib/util"
  import GitItem from "@src/app/components/GitItem.svelte"

  const url = decodeRelay($page.params.relay)

  const bookmarkFilter = {kinds: [NAMED_BOOKMARKS], authors: [pubkey.get()!] }

  const shouldTrigger = derived(shouldReloadRepos, ($s) => $s);

  const mutedPubkeys = getPubkeyTagValues(getListTags($userMutes))

  let repoFilter:Filter

  let loading = $state(true)

  const events: Writable<TrustedEvent[]> = writable([]);

  const loadedBookmarkedRepos: Writable<Map<string, {event: TrustedEvent, relayHint: string}>> = writable(new Map())

  const loadBookmarkedRepos = async () => {
    loading = true
    await tick()
    const bookmark = await load({
      relays: [url, ...ctx.app.router.FromUser().getUrls()],
      filters: [ bookmarkFilter ],
    })

    if (bookmark.length > 0) {
      const aTagList = getAddressTags(bookmark[0].tags)
      const dTagValues: Array<string> = []
      const relayHints: Array<string> = []
      const relaysOfAddresses: Map<string, string> = new Map()

      aTagList.forEach(([letter, value, relayHint]) => {
        dTagValues.push(value.split(":")[2])
        relaysOfAddresses.set(value, relayHint || "")
        if (relayHint){
          relayHints.push(relayHint)
        }
      })

      repoFilter = {kinds: [GIT_REPO], "#d": dTagValues}

      const loadedRepos = await load({
        relays: relayHints,
        filters: [ repoFilter ]
      })
      loadedRepos.forEach((repo) => {
        const addressString = Address.fromEvent(repo).toString()
        const hint = relaysOfAddresses.get(addressString) || ""
        $loadedBookmarkedRepos.set(addressString, {event: repo, relayHint: hint})
      })
      events.update(() => {
        return sortBy(
          e => -e.created_at,
          loadedRepos.filter(e => !mutedPubkeys.includes(e.pubkey)),
        )
      })

      
    }
    loading = false;
    console.log("loaded, events:", $events)
  }

  let element: Element | undefined = $state()

  onMount(() => {
    loadBookmarkedRepos()

    return () => {
      setChecked($page.url.pathname)
    }
  })

  $effect(() => {
    if ($shouldTrigger) {
      loadBookmarkedRepos()
      $shouldReloadRepos = false;
    }
  })

  const onAddRepo = () => {
    pushModal(
      RepoPicker,
      {selectedRepos: loadedBookmarkedRepos},
      {replaceState: true}
    )
  }

</script>

<div class="relative flex h-screen flex-col" bind:this={element}>
  <PageBar>
    {#snippet icon()}
      <div class="center">
        <Icon icon="git" />
      </div>
    {/snippet}
    {#snippet title()}
      <strong>Followed Repos</strong>
    {/snippet}
    {#snippet action()}
      <div class="row-2">
        <Button class="btn btn-primary btn-sm" disabled={loading} onclick={onAddRepo}>
          <Icon icon="git" />
          <span class="">Add Repo</span>
        </Button>
        <MenuSpaceButton {url} />
      </div>
    {/snippet}
  </PageBar>
  <div class="flex flex-grow flex-col gap-2 overflow-auto p-2">
    {#each $events as event (event.id)}
      <div in:fly>
      <GitItem {url} {event}/>
      </div>
    {/each}
    {#if loading || $events.length === 0}
      <p class="flex h-10 items-center justify-center py-20" out:fly>
        <Spinner {loading}>
          {#if loading}
            Looking for Git Repos...
          {:else if $events.length === 0}
            No Repos found.
          {/if}
        </Spinner>
      </p>
    {/if}
  </div>
</div>
