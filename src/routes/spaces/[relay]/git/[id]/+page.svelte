<script lang="ts">
  import {onMount} from "svelte"
  import {page} from "$app/stores"
  import {sortBy, sleep, nthEq} from "@welshman/lib"
  import {Address, GIT_ISSUE, type TrustedEvent} from "@welshman/util"
  import {load, repository, subscribe} from "@welshman/app"
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
  import GitIssueItem from "@src/app/components/GitIssueItem.svelte"
  import type { Readable } from "svelte/store"
  import { nip19 } from "nostr-tools"

  const {relay, id} = $page.params
  const url = decodeRelay(relay)

  const event:Readable<TrustedEvent> = deriveEvent(id)
  const repoNpub = $derived(nip19.npubEncode($event.pubkey))
  const repoDtag = $derived($event.tags.find(nthEq(0, "d"))?.[1])

  const gitworkshopLink = $derived(
    `https://gitworkshop.dev/${repoNpub}/${repoDtag}`
  )
  let sub: Subscription
  let repoRelays:string[] = $state([])

  const back = () => history.back()

  const issues = $derived.by(() => {
    const address = Address.fromEvent($event).toString()
    const issueFilter = [{kinds: [GIT_ISSUE], "#a": [address]}]

    return deriveEvents(repository, {filters: issueFilter})
  })

  $effect(() => {
    if ($event) {
      console.log("Repo loaded")
      const address = Address.fromEvent($event).toString()
      const issueFilter = [{kinds: [GIT_ISSUE], "#a": [address]}]
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
  {#if $event}
    {#if $issues}
      {#each sortBy(e => -e.created_at, $issues) as issue (issue.id)}
        <GitIssueItem event={issue} relays={repoRelays} repoLink={gitworkshopLink}/>
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


