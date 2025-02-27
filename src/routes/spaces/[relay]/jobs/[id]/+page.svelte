<script lang="ts">
  import {onMount} from "svelte"
  import {page} from "$app/stores"
  import {sortBy, sleep} from "@welshman/lib"
  import {COMMENT} from "@welshman/util"
  import {repository, subscribe} from "@welshman/app"
  import {deriveEvents} from "@welshman/store"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Button from "@lib/components/Button.svelte"
  import Content from "@app/components/Content.svelte"
  import NoteCard from "@app/components/NoteCard.svelte"
  import MenuSpaceButton from "@app/components/MenuSpaceButton.svelte"
  import JobActions from "@app/components/JobActions.svelte"
  import EventReply from "@app/components/EventReply.svelte"
  import {deriveEvent, decodeRelay} from "@app/state"
  import {setChecked} from "@app/notifications"
  import JobItem from "@src/app/components/JobItem.svelte"
  import Divider from "@src/lib/components/Divider.svelte"

  const {relay, id} = $page.params
  const url = decodeRelay(relay)
  const event = deriveEvent(id)
  const filters = [{kinds: [COMMENT], "#E": [id]}]
  const replies = deriveEvents(repository, {filters})

  const back = () => history.back()

  const openReply = () => {
    showReply = true
  }

  const closeReply = () => {
    showReply = false
  }

  const expand = () => {
    showAll = true
  }

  let showAll = $state(false)
  let showReply = $state(false)

  onMount(() => {
    const sub = subscribe({relays: [url], filters})

    return () => {
      sub.close()
      setChecked($page.url.pathname)
    }
  })
</script>

<div class="relative flex flex-col-reverse gap-3 px-2">
  {#if $event}
    {#if !showReply}
      <div class="flex justify-end px-2 pb-2">
        <Button class="btn btn-primary" onclick={openReply}>
          <Icon icon="reply" />
          Comment on Job
        </Button>
      </div>
    {/if}
    {#each sortBy(e => -e.created_at, $replies).slice(0, showAll ? undefined : 4) as reply (reply.id)}
      <NoteCard event={reply} class="card2 bg-alt z-feature w-full">
        <div class="col-3 ml-12">
          <Content showEntire event={reply} />
          <JobActions event={reply} {url} showExternal={false} />
        </div>
      </NoteCard>
    {/each}
    {#if !showAll && $replies.length > 4}
      <div class="flex justify-center">
        <Button class="btn btn-link" onclick={expand}>
          <Icon icon="sort-vertical" />
          Show all {$replies.length} replies
        </Button>
      </div>
    {/if}
    <Divider />
    <JobItem {url} event={$event} showActivity={true} showExternal={true} showThreadAction={true}/>
  {:else}
    {#await sleep(5000)}
      <Spinner loading>Loading comments...</Spinner>
    {:then}
      <p>Failed to load comments.</p>
    {/await}
  {/if}
  <PageBar class="mx-0">
    {#snippet icon()}
      <div>
        <Button class="btn btn-neutral btn-sm" onclick={back}>
          <Icon icon="alt-arrow-left" />
        </Button>
      </div>
    {/snippet}
    {#snippet title()}
      <h1 class="text-xl sm:text-lg text-center">Job Discussion</h1>
    {/snippet}
    {#snippet action()}
      <div>
        <MenuSpaceButton {url} />
      </div>
    {/snippet}
  </PageBar>
</div>
{#if showReply}
  <EventReply {url} event={$event} onClose={closeReply} onSubmit={closeReply} />
{/if}

