<script lang="ts">
  import { decodeRelay, deriveEventsForUrl, INDEXER_RELAYS } from "@src/app/state"
  import { GIT_REPO } from "@src/lib/util"
  import { createFeedController, repository, userMutes } from "@welshman/app"
  import { getPubkeyTagValues, getListTags, COMMENT } from "@welshman/util"
  import { onMount } from "svelte";
  import {page} from "$app/stores"
  import { derived } from "svelte/store"
  import { setChecked } from "@src/app/notifications"
  import PageBar from "@src/lib/components/PageBar.svelte"
  import Icon from "@src/lib/components/Icon.svelte"
  import MenuSpaceButton from "@src/app/components/MenuSpaceButton.svelte"
  import Button from "@src/lib/components/Button.svelte"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import { deriveEvents, throttled } from "@welshman/store"
  import { sortBy, min, nthEq} from "@welshman/lib"
  import { feedFromFilters, makeIntersectionFeed, makeRelayFeed, makeUnionFeed, makeWOTFeed } from "@welshman/feeds"
  import { createScroller, type Scroller } from "@src/lib/html"
  import JobItem from "@src/app/components/JobItem.svelte"
  import { fly } from "@src/lib/transition"
  import Link from "@src/lib/components/Link.svelte"

  const url = decodeRelay($page.params.relay)

  // Later an additional #a tag list will be added to this filter
  // defining the particular list of repos the User has followed
  const gitFilter = {kinds: [GIT_REPO]}
  const feed = feedFromFilters([gitFilter])

  const gitRepos = deriveEvents(repository, { filters: [gitFilter] })

  const comments = deriveEventsForUrl(url, [commentFilter])
  const mutedPubkeys = getPubkeyTagValues(getListTags($userMutes))

  const events = throttled(
    800,
    derived([gitRepos, comments], ([$gitRepos, $comments]) => {
      const scores = new Map<string, number>()

      for (const comment of $comments) {
        const id = comment.tags.find(nthEq(0, "E"))?.[1]

        if (id) {
          scores.set(id, min([scores.get(id), -comment.created_at]))
        }
      }

      return sortBy(
        e => min([scores.get(e.id), -e.created_at]),
        $gitRepos.filter(e => !mutedPubkeys.includes(e.pubkey)),
      )
    }),
  )

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
        <Button class="btn btn-primary btn-sm">
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
