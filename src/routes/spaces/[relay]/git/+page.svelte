<script lang="ts">
  import { decodeRelay } from "@src/app/state"
  import { load } from "@welshman/app"
  import { GIT_REPO, GIT_REPO_BOOKMARK_DTAG } from "@src/lib/util"
  import { createFeedController, pubkey, repository, userMutes } from "@welshman/app"
  import { getPubkeyTagValues, getListTags, NAMED_BOOKMARKS, Address, getAddressTags } from "@welshman/util"
  import { onMount } from "svelte";
  import {page} from "$app/stores"
  import { derived } from "svelte/store"
  import { setChecked } from "@src/app/notifications"
  import PageBar from "@src/lib/components/PageBar.svelte"
  import Icon from "@src/lib/components/Icon.svelte"
  import MenuSpaceButton from "@src/app/components/MenuSpaceButton.svelte"
  import Button from "@src/lib/components/Button.svelte"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import { deriveEvent, deriveEvents, throttled } from "@welshman/store"
  import { ctx, sortBy } from "@welshman/lib"
  import { feedFromFilters, makeIntersectionFeed, makeRelayFeed, makeUnionFeed, makeWOTFeed } from "@welshman/feeds"
  import { createScroller, type Scroller } from "@src/lib/html"
  import JobItem from "@src/app/components/JobItem.svelte"
  import { fly } from "@src/lib/transition"
  import { pushModal } from "@src/app/modal"
  import RepoPicker from "@src/app/components/RepoPicker.svelte"

  const url = decodeRelay($page.params.relay)

  const bookmarkFilter = {kinds: [NAMED_BOOKMARKS], authors: [pubkey.get()!] }
  const gitFilter = {kinds: [GIT_REPO]}
  const feed = feedFromFilters([gitFilter])

  const gitRepos = deriveEvents(repository, { filters: [gitFilter] })
  const bookmarkedRepos = deriveEvent(
    repository,
    `${NAMED_BOOKMARKS}:${pubkey.get()!}:${GIT_REPO_BOOKMARK_DTAG}`
  )

  const mutedPubkeys = getPubkeyTagValues(getListTags($userMutes))

  const events = throttled(
    800,
    derived([gitRepos], ([$gitRepos]) => {
      return sortBy(
        e => -e.created_at,
        $gitRepos.filter(e => !mutedPubkeys.includes(e.pubkey)),
      )
    }),
  )

  const loadBookmarkedRepos = async () => {
    const bookmark = await load({
      relays: [url, ...ctx.app.router.FromUser().getUrls()],
      filters: [ bookmarkFilter ],
    })

    if (bookmark.length > 0) {
      const aTags = getAddressTags(bookmark[0].tags)

      await load({
        filters: [ {} ]
      })
    }
  }

  const ctrl = createFeedController({
    useWindowing: true,
    feed: makeIntersectionFeed(
      makeUnionFeed(
        makeWOTFeed({min: 0.1}), 
        makeRelayFeed(url)
      ),
      feed
    ),
    onExhausted: () => {
      loading = false
    },
  })

  let limit = 20
  let loading = $state(true)
  let element: Element | undefined = $state()
  let scroller: Scroller

  onMount(() => {
    loadBookmarkedRepos()
    scroller = createScroller({
      element: element!,
      delay: 300,
      threshold: 3000,
      onScroll: () => {
        limit += 20

        if ($events.length - limit < 10) {
          ctrl.load(50)
        }
      },
    })

    return () => {
      scroller?.stop()
      setChecked($page.url.pathname)
    }
  });

  const onPickRepo = () => {
    pushModal(RepoPicker)
  }

</script>

<div class="relative flex h-screen flex-col" bind:this={element}>
  <PageBar>
    {#snippet icon()}
      <div class="center">
        <Icon icon="gitRepos" />
      </div>
    {/snippet}
    {#snippet title()}
      <strong>Jobs</strong>
    {/snippet}
    {#snippet action()}
      <div class="row-2">
        <Button class="btn btn-primary btn-sm" onclick={onPickRepo}>
          <Icon icon="gitRepos" />
          <span class="">Follow Repos!</span>
        </Button>
        <MenuSpaceButton {url} />
      </div>
    {/snippet}
  </PageBar>
  <div class="flex flex-grow flex-col gap-2 overflow-auto p-2">
    {#each $events as event (event.id)}
      <div in:fly>
        <JobItem {url} {event} external={false} />
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
