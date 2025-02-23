<script lang="ts">
  import {onMount} from "svelte"
  import {page} from "$app/stores"
  import {sortBy, sleep, nthEq} from "@welshman/lib"
  import {Address, GIT_ISSUE, type TrustedEvent} from "@welshman/util"
  import {repository, subscribe} from "@welshman/app"
  import {deriveEvents, type ReadableWithGetter} from "@welshman/store"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Button from "@lib/components/Button.svelte"
  import MenuSpaceButton from "@app/components/MenuSpaceButton.svelte"
  import {deriveEvent, decodeRelay} from "@app/state"
  import {setChecked} from "@app/notifications"
  import type { Subscription } from "@welshman/net"
  import GitItem from "@src/app/components/GitItem.svelte"
  import GitIssueItem from "@src/app/components/GitItem.svelte"
  import Link from "@src/lib/components/Link.svelte"

  const {relay, id} = $page.params
  const url = decodeRelay(relay)
  const event = deriveEvent(id)
  let address = ''
  let issues: ReadableWithGetter<TrustedEvent[]>
  let sub: Subscription
  let repoRelays:string[] = $state([])

  const back = () => history.back()

  $effect(() => {
    if ($event) {
      console.log("Repo loaded")
      address = Address.fromEvent($event).toString()

      const issueFilter = [{kinds: [GIT_ISSUE], "#a": [address]}]
      issues = deriveEvents(repository, {filters: issueFilter})
      const [tagId, ...relays] = $event.tags.find(nthEq(0, "relays")) || []
      repoRelays = relays
      sub = subscribe({relays: relays, filters: issueFilter})
    }
  })

  onMount(() => {
    return () => {
      if (sub) {
        sub.close()
        setChecked($page.url.pathname)
      }
    }
  })
</script>

<div class="relative flex flex-col-reverse gap-3 px-2">
  <div class="absolute left-[51px] top-32 h-[calc(100%-248px)] w-[2px] bg-neutral"></div>
  {#if $event}
    <div class="flex justify-end px-2 pb-2">
      <Button class="btn btn-primary btn-sm">
        <Link external class="w-full cursor-pointer" href={web}>
          <span class="">GitWorkshop</span>
        </Link>
      </Button>
    </div>
    {#if $issues}
      {#each sortBy(e => -e.created_at, $issues) as issue (issue.id)}
        <GitIssueItem event={issue} relays={repoRelays}/>
      {/each}
    {/if}
    <GitItem {url} event={$event} showIssues={false}/>
  {:else}
    {#await sleep(5000)}
      <Spinner loading>Loading issues...</Spinner>
    {:then}
      <p>Failed to load issues.</p>
    {/await}
  {/if}
  <PageBar class="mx-0">
    {#snippet icon()}
      <div>
        <Button class="btn btn-neutral btn-sm" onclick={back}>
          <Icon icon="alt-arrow-left" /> Go back
        </Button>
      </div>
    {/snippet}
    {#snippet title()}
      <h1 class="text-xl text-center">Repo Issues</h1>
    {/snippet}
    {#snippet action()}
      <div>
        <MenuSpaceButton {url} />
      </div>
    {/snippet}
  </PageBar>
</div>


