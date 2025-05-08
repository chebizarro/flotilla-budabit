<script lang="ts">
  import {onMount} from "svelte"
  import {page} from "$app/stores"
  import {getPubkeyTagValues, getListTags, Address, NAMED_BOOKMARKS, type TrustedEvent} from "@welshman/util"
  import {GIT_REPO} from "@src/lib/util"
  import {userMutes} from "@welshman/app"
  import {fly} from "@lib/transition"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import MenuSpaceButton from "@app/components/MenuSpaceButton.svelte"
  import GitItem from "@app/components/GitItem.svelte"
  import RepoPicker from "@app/components/RepoPicker.svelte"
  import {decodeRelay} from "@app/state"
  import {setChecked} from "@app/notifications"
  import {pushModal} from "@app/modal"
  import {load} from "@welshman/net"
  import {pubkey} from "@welshman/app"
  import {getAddressTags} from "@welshman/util"
  import {Router} from "@welshman/router"

  const url = decodeRelay($page.params.relay)
  const mutedPubkeys = getPubkeyTagValues(getListTags($userMutes))
  const repos: TrustedEvent[] = $state([])
  let loading = $state(true)
  let loadedBookmarkedRepos: Array<{address: string, event: TrustedEvent, relayHint: string}> = []

  async function loadBookmarkedRepos() {
    repos.length = 0
    loading = true
    const bookmarkFilter = {kinds: [NAMED_BOOKMARKS], authors: [pubkey.get()!]}
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
        if (relayHint) relayHints.push(relayHint)
      })
      const repoFilter = {kinds: [GIT_REPO], authors, "#d": dTagValues}
      const loadedRepos = await load({
        relays: relayHints,
        filters: [repoFilter],
      })
      loadedBookmarkedRepos = loadedRepos.map(repo => {
        const address = Address.fromEvent(repo)
        const addressString = address.toString()
        const relayHintFromEvent = Router.get().getRelaysForPubkey(repo.pubkey)?.[0]
        const hint = relaysOfAddresses.get(addressString) ?? relayHintFromEvent
        return {address: addressString, event: repo, relayHint: hint}
      })
      loadedRepos.filter(e => !mutedPubkeys.includes(e.pubkey)).forEach(e => repos.push(e))
    }
    loading = false
  }

  onMount(() => {
    loadBookmarkedRepos()
    return () => setChecked($page.url.pathname)
  })

  const onAddRepo = () => {
    pushModal(RepoPicker, {
      selectedRepos: loadedBookmarkedRepos,
      onClose: loadBookmarkedRepos,
    })
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
          <span>Add Repo</span>
        </Button>
        <MenuSpaceButton {url} />
      </div>
    {/snippet}
  </PageBar>
  <div class="flex flex-grow flex-col gap-2 overflow-auto p-2">
    {#if loading || repos.length === 0}
      <p class="flex h-10 items-center justify-center py-20" out:fly>
        <Spinner {loading}>
          {#if loading}
            Looking for Your Git Repos...
          {:else if repos.length === 0}
            No Repos found.
          {/if}
        </Spinner>
      </p>
    {:else}
      {#each repos as event (event.id)}
        <div in:fly class="">
          <GitItem {url} {event} />
        </div>
      {/each}
    {/if}
  </div>
</div>
