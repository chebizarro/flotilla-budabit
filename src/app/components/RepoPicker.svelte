<script lang="ts">
  import {ctx} from "@welshman/lib"
  import {onMount} from "svelte"
  import { GIT_REPO_BOOKMARK_DTAG } from "@src/lib/util"
  import {page} from "$app/stores"
  import {derived, writable} from "svelte/store"
  import {Address, createEvent, NAMED_BOOKMARKS, type Filter} from "@welshman/util"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import FieldInline from "@src/lib/components/FieldInline.svelte"
  import {
    createFeedController,
    publishThunk,
    repository,
    tracker
  } from "@welshman/app"
  import {
    feedFromFilter,
    makeIntersectionFeed,
    makeWOTFeed,
  } from "@welshman/feeds"
  import {sleep} from "@welshman/lib"
  import {createScroller, type Scroller} from "@src/lib/html"
  import {deriveEvents} from "@welshman/store"
  import { GIT_REPO } from "@src/lib/util"
  import { preventDefault } from "svelte/legacy"
  import { decodeRelay } from "../state"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import { fly } from "svelte/transition"
  import GitItem from "./GitItem.svelte"


  const url = decodeRelay($page.params.relay)
  // TODO: Use this map as the collection for one of two each blocks(the first)
  const {selectedRepos}: {selectedRepos: Map<string, Array<string>>} = $props()

  let unmounted = false
  let element: HTMLElement
  let scroller: Scroller
  let limit = 30
  let loading = $state(true)

  const filters: Filter[] = [{kinds: [GIT_REPO]}]
  const events = deriveEvents(repository, {filters})

  // TODO: Use this with another each block (the second) and only push elements
  // that are not in selectedRepos map
  const repositories = derived(events, $events => {
    const elements = []

    for (const event of $events) {
      const relayHints = tracker.getRelays(event.id)
      const firstHint = relayHints.values().next().value || "";

      elements.push({
        repo: event,
        relay: firstHint,
        address: Address.fromEvent(event).toString(),
      })
    }

    return elements.reverse()
  })

  const ctrl = createFeedController({
    useWindowing: true,
    feed: makeIntersectionFeed(
      makeWOTFeed({min: 0.1}),
      feedFromFilter({kinds: [GIT_REPO]}),
    ),
    onExhausted: () => {
      loading = false
    },
  })

  const uploading = writable(false)

  const back = () => history.back()

  const submit = () => {
    if ($uploading) return

    publishThunk({
      event: createEvent(
        NAMED_BOOKMARKS,
        { tags: [ 
          ["d", GIT_REPO_BOOKMARK_DTAG],
          ...Array.from(selectedRepos.values())
        ] }
      ),
      relays: [url, ...ctx.app.router.FromUser().getUrls()],
    })

    history.back()
  }

  onMount(() => {
    // Element is frequently not defined. I don't know why
    sleep(1000).then(() => {
      if (!unmounted) {
        scroller = createScroller({
          element,
          delay: 300,
          threshold: 10_000,
          onScroll: () => {
            limit += 10

            if ($events.length - limit < 20) {
              ctrl.load(20)
            }
          },
        })
      }
    })

    return () => {
      unmounted = true
      scroller?.stop()
    }
  })

  // TODO: if repo is checked, add it to selectedRepos AND delete from events store
  // If unchecked, the the opposite
  const onRepoChecked = (relay: string, address: string, event:Event) => {
    const target = event.target as HTMLInputElement
    if (target.checked) {
      selectedRepos.set(address, ['a', address, relay])
    } else {
      selectedRepos.delete(address)
    }
  }
</script>

<form class="column gap-4" onsubmit={preventDefault(submit)}>
  <ModalHeader>
    {#snippet title()}
      <div>Follow Git Repos</div>
    {/snippet}
    {#snippet info()}
      <div>Select repositories to track</div>
    {/snippet}
  </ModalHeader>
  <div
    class="scroll-container -mt-2 h-96 flex flex-grow flex-col overflow-auto py-2"
    bind:this={element}>
    {#each $repositories as {repo, relay, address} (repo.id)}
      <GitItem {url} event={repo} showActivity={false} showActions={false}/>
      <div class="flex w-full justify-end">
        <FieldInline>
          {#snippet input()}
            <input
              slot="input"
              type="checkbox"
              class="toggle toggle-primary"
              onchange={event => onRepoChecked(relay, address, event)} />
          {/snippet}
        </FieldInline>
      </div>
    {/each}
    {#if loading || $events.length === 0}
      <p class="flex h-10 items-center justify-center py-20" out:fly>
        <Spinner {loading}>
          {#if loading}
            Looking for repos...
          {:else if $events.length === 0}
            No Repos found.
          {/if}
        </Spinner>
      </p>
    {/if}
  </div>
  <ModalFooter>
    <Button class="btn btn-link" onclick={back}>
      <Icon icon="alt-arrow-left" />
      Go back
    </Button>
    <Button type="submit" class="btn btn-primary">Finish</Button>
  </ModalFooter>
</form>
