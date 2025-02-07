<script lang="ts">
  import {onMount} from "svelte"
  import {derived, writable} from "svelte/store"
  import {Address, type Filter, type TrustedEvent} from "@welshman/util"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import FieldInline from "@src/lib/components/FieldInline.svelte"
  import {createFeedController, repository} from "@welshman/app"
  import {
    feedFromFilter,
    feedsFromFilter,
    makeGlobalFeed,
    makeIntersectionFeed,
    makeKindFeed,
    makeRelayFeed,
    makeWOTFeed,
  } from "@welshman/feeds"
  import {fromPairs, sleep} from "@welshman/lib"
  import {createScroller, type Scroller} from "@src/lib/html"
  import {deriveEvents} from "@welshman/store"
  import Divider from "@src/lib/components/Divider.svelte"

  // GIT_REPOSITORY is mistakenly defined in welshman as 30403 which
  // is a Draft Classified listing (nip99) kind in reality.
  const GIT_REPOSITORY_KIND = 30617

  let unmounted = false
  let element: HTMLElement
  let scroller: Scroller
  let limit = 30
  let loading = true

  const filters: Filter[] = [{kinds: [GIT_REPOSITORY_KIND]}]
  const events = deriveEvents(repository, {filters})

  const repositories = derived(events, $events => {
    const $elements = []

    for (const event of $events.toReversed()) {
      const {kind, pubkey} = event

      const repoData = fromPairs(event.tags)

      $elements.push({
        address: kind.toString() + ":" + pubkey + ":" + repoData.d,
        name: repoData.name,
        owner: pubkey,
      })
    }

    return $elements.reverse()
  })

  // const feed = feedsFromFilter({kinds: [GIT_REPOSITORY]})
  const ctrl = createFeedController({
    useWindowing: true,
    feed: makeIntersectionFeed(
      makeRelayFeed("wss://relay.damus.io/"),
      feedFromFilter({kinds: [GIT_REPOSITORY_KIND]}),
    ),
    onExhausted: () => {
      loading = false
      console.log("did not find any more repos")
    },
    onEvent(event) {
      console.log("new repo event", event)
    },
  })

  const uploading = writable(false)

  const back = () => history.back()

  const submit = () => {
    if ($uploading) return

    history.back()
  }

  const selectedRepos: Set<string> = new Set()

  onMount(() => {
    // Element is frequently not defined. I don't know why
    sleep(1000).then(() => {
      if (!unmounted) {
        scroller = createScroller({
          element,
          delay: 300,
          threshold: 10_000,
          onScroll: () => {
            limit += 30

            if ($events.length - limit < 100) {
              ctrl.load(60)
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

  const onRepoChecked = (address: string, event) => {
    if (event.target.checked) {
      selectedRepos.add(address)
    } else {
      selectedRepos.delete(address)
    }
  }
</script>

<form class="column gap-4" on:submit|preventDefault={submit}>
  <ModalHeader>
    <div slot="title">Follow Git Repos</div>
    <div slot="info">Select repositories to receive updates in this room</div>
  </ModalHeader>
  <div
    class="scroll-container -mt-2 flex flex-grow flex-col-reverse overflow-auto py-2"
    bind:this={element}>
    {#each $repositories as { address, name, owner } (address)}
      <Divider>
        <FieldInline>
          <p slot="label">{name} by {owner}</p>
          <input
            slot="input"
            type="checkbox"
            class="toggle toggle-primary"
            on:change={event => onRepoChecked(address, event)} />
        </FieldInline>
      </Divider>
    {/each}
  </div>
  <ModalFooter>
    <Button class="btn btn-link" on:click={back}>
      <Icon icon="alt-arrow-left" />
      Go back
    </Button>
    <Button type="submit" class="btn btn-primary">Finish</Button>
  </ModalFooter>
</form>
