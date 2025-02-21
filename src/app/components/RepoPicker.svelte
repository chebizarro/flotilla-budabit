<script lang="ts">
  import {ctx} from "@welshman/lib"
  import {onMount} from "svelte"
  import { GIT_REPO_BOOKMARK_DTAG } from "@src/lib/util"
  import {page} from "$app/stores"
  import {derived, writable, type Writable} from "svelte/store"
  import {Address, createEvent, NAMED_BOOKMARKS, type Filter, type TrustedEvent} from "@welshman/util"
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
  import { decodeRelay, shouldReloadRepos } from "../state"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import { fly } from "svelte/transition"
  import GitItem from "./GitItem.svelte"
  import Divider from "@src/lib/components/Divider.svelte"
    import { makeGitPath } from "../routes"
    import { goto } from "$app/navigation"


  const url = decodeRelay($page.params.relay)
  const {selectedRepos}: {
    selectedRepos: Writable<Map<string, {event: TrustedEvent, relayHint: string}>>
  } = $props()

  let unmounted = false
  let element: HTMLElement
  let scroller: Scroller
  let limit = 30
  let loading = $state(true)

  const filters: Filter[] = [{kinds: [GIT_REPO]}]
  const events = deriveEvents(repository, {filters})

  const repos = derived([events, selectedRepos], ([$events, $selectedRepos]) => {
    const elements = []

    for (const [address, value] of $selectedRepos) {
      elements.push({
        repo: value.event,
        relay: value.relayHint,
        address: address,
        selected: true
      })
    }

    for (const event of $events.toReversed()) {
      const address = Address.fromEvent(event).toString()
      // Need to keep selected and unselected repos as distinct sets
      if (!$selectedRepos.has(address)) {
        const relayHints = tracker.getRelays(event.id)
        const firstHint = relayHints.values().next().value || "";

        elements.push({
          repo: event,
          relay: firstHint,
          address: address,
          selected: false
        })
      }
    }

    return elements
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
    const atagList:string[][] = [];

    for (const [key, value] of $selectedRepos) {
      atagList.push(['a', key, value.relayHint])
    }

    const eventToPublish = createEvent(
      NAMED_BOOKMARKS,
      { 
        tags: [ 
          ["d", GIT_REPO_BOOKMARK_DTAG],
          ...atagList
        ] 
      }
    )
    console.log("eventToPublish", eventToPublish)

    publishThunk({
      event: eventToPublish,
      relays: [url, ...ctx.app.router.FromUser().getUrls()],
    })

    $shouldReloadRepos = true;

    goto(makeGitPath(url))
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

  const onRepoChecked = (
    relay: string,
    address: string,
    event:TrustedEvent,
    checked: boolean
  ) => {
    if (checked) {
      $selectedRepos.set(address, {event: event, relayHint: relay})
    } else {
      $selectedRepos.delete(address)
    }
    $selectedRepos = $selectedRepos
  }
</script>

{#snippet repoSelectCheckBox(relay: string, address:string, repo:TrustedEvent, selected: boolean)}
  <input
    slot="input"
    type="checkbox"
    class="toggle toggle-primary"
    checked={selected}
    onchange={event => onRepoChecked(
      relay,
      address,
      repo,
      (event.target as HTMLInputElement).checked
    )}
  />
{/snippet}

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
    <Divider>
      <p>Selected</p>
    </Divider>
    {#each $repos.filter((r)=>r.selected) as {repo, relay, address} (repo.id)}
      <GitItem {url} event={repo} showActivity={false} showActions={false}/>
      <div class="flex w-full justify-end">
        <FieldInline>
          {#snippet input()}
            {@render repoSelectCheckBox(relay, address,repo, true)}
          {/snippet}
        </FieldInline>
      </div>
    {/each}
    <Divider>
      <p>Other</p>
    </Divider>
    {#each $repos.filter((r)=>!r.selected) as {repo, relay, address} (repo.id)}
      <GitItem {url} event={repo} showActivity={false} showActions={false}/>
      <div class="flex w-full justify-end">
        <FieldInline>
          {#snippet input()}
            {@render repoSelectCheckBox(relay, address,repo, false)}
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
