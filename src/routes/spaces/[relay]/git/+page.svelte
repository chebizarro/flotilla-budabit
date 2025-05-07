<script lang="ts">
  import {decodeRelay, shouldReloadRepos} from "@src/app/state"
  import {tracker} from "@welshman/app"
  import {load} from "@welshman/net"
  import {pubkey, userMutes} from "@welshman/app"
  import {
    getPubkeyTagValues,
    getListTags,
    NAMED_BOOKMARKS,
    getAddressTags,
    type TrustedEvent,
    type Filter,
    Address,
  } from "@welshman/util"
  import {onMount, tick} from "svelte"
  import {page} from "$app/state"
  import {type Writable, writable} from "svelte/store"
  import {setChecked} from "@src/app/notifications"
  import PageBar from "@src/lib/components/PageBar.svelte"
  import Icon from "@src/lib/components/Icon.svelte"
  import MenuSpaceButton from "@src/app/components/MenuSpaceButton.svelte"
  import Button from "@src/lib/components/Button.svelte"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import {sortBy} from "@welshman/lib"
  import {fly} from "@src/lib/transition"
  import {pushModal} from "@src/app/modal"
  import RepoPicker from "@src/app/components/RepoPicker.svelte"
  import {GIT_REPO} from "@src/lib/util"
  import GitItem from "@src/app/components/GitItem.svelte"
  import {Router} from "@welshman/router"

  const url = decodeRelay(page.params.relay)

  const bookmarkFilter = {kinds: [NAMED_BOOKMARKS], authors: [pubkey.get()!]}

  const mutedPubkeys = getPubkeyTagValues(getListTags($userMutes))

  let repoFilter: Filter

  let loading = $state(true)

  const events: Writable<TrustedEvent[]> = writable([])

  let loadedBookmarkedRepos: Array<{address: string; event: TrustedEvent; relayHint: string}> = []

  const loadBookmarkedRepos = async () => {
    loadedBookmarkedRepos = []
    loading = true
    await tick()
    const bookmark = await load({
      relays: [url, ...Router.get().FromUser().getUrls()],
      filters: [bookmarkFilter],
    })

    if (bookmark.length > 0) {
      const aTagList = getAddressTags(bookmark[0].tags)
      const dTagValues: string[] = []
      const authors: string[] = []
      const relayHints: string[] = []
      const relaysOfAddresses: Map<string, string> = new Map()

      aTagList.forEach(([letter, value, relayHint]) => {
        dTagValues.push(value.split(":")[2])
        authors.push(value.split(":")[1])
        relaysOfAddresses.set(value, relayHint || "")
        if (relayHint) {
          relayHints.push(relayHint)
        }
      })

      repoFilter = {kinds: [GIT_REPO], authors: authors, "#d": dTagValues}

      const loadedRepos = await load({
        relays: relayHints,
        filters: [repoFilter],
      })
      loadedRepos.forEach(repo => {
        const address = Address.fromEvent(repo)
        const addressString = address.toString()
        const relayHintFromEvent = tracker.getRelays(repo.id)
        const relaysFromAddressPubkey = Router.get().getRelaysForPubkey(repo.pubkey)?.[0]

        const hint =
          relaysOfAddresses.get(addressString) ??
          Array.from(relayHintFromEvent)[0] ??
          relaysFromAddressPubkey

        loadedBookmarkedRepos.push({
          address: addressString,
          event: repo,
          relayHint: hint,
        })
      })
      events.update(() => {
        return sortBy(
          e => -e.created_at,
          loadedRepos.filter(e => !mutedPubkeys.includes(e.pubkey)),
        )
      })
    }
    loading = false
  }

  onMount(() => {
    loadBookmarkedRepos()

    return () => {
      setChecked(page.url.pathname)
    }
  })

  $effect(() => {
    if ($shouldReloadRepos) {
      loadBookmarkedRepos()
      $shouldReloadRepos = false
    }
  })

  const onAddRepo = () => {
    pushModal(RepoPicker, {selectedRepos: loadedBookmarkedRepos})
  }
</script>

<div class="relative flex h-screen flex-col">
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
    {#if loading || $events.length === 0}
      <p class="flex h-10 items-center justify-center py-20" out:fly>
        <Spinner {loading}>
          {#if loading}
            Looking for Your Git Repos...
          {:else if $events.length === 0}
            No Repos found.
          {/if}
        </Spinner>
      </p>
    {:else}
      {#each $events as event (event.id)}
        <div in:fly class="">
          <GitItem {url} {event} />
        </div>
      {/each}
    {/if}
  </div>
</div>
