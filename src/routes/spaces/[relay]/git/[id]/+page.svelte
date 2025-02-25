<script lang="ts">
  import {onMount} from "svelte"
  import {page} from "$app/stores"
  import {sortBy, sleep, nthEq, now} from "@welshman/lib"
  import {
    Address,
    GIT_ISSUE,
    GIT_STATUS_CLOSED,
    GIT_STATUS_COMPLETE,
    GIT_STATUS_DRAFT,
    GIT_STATUS_OPEN,
    type TrustedEvent}
  from "@welshman/util"
  import {repository, subscribe} from "@welshman/app"
  import {deriveEvents} from "@welshman/store"
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
  import { getRootEventTagValue } from "@src/lib/util"
  import Divider from "@src/lib/components/Divider.svelte"

  const {relay, id} = $page.params
  const url = decodeRelay(relay)

  const event:Readable<TrustedEvent> = deriveEvent(id)
  const repoNpub = $derived(nip19.npubEncode($event.pubkey))
  const repoDtag = $derived($event.tags.find(nthEq(0, "d"))?.[1])

  const gitworkshopLink = $derived(
    `https://gitworkshop.dev/${repoNpub}/${repoDtag}`
  )
  let issueSub: Subscription
  let repoRelays:string[] = $state([])

  const back = () => history.back()

  const issues = $derived.by(() => {
    const address = Address.fromEvent($event).toString()
    const issueFilter = [{kinds: [GIT_ISSUE], "#a": [address]}]

    return deriveEvents(repository, {filters: issueFilter})
  })

  const statuses = $derived.by(()=>{
    const statusFilter = [{
      kinds: [
        GIT_STATUS_OPEN,
        GIT_STATUS_COMPLETE,
        GIT_STATUS_CLOSED,
        GIT_STATUS_DRAFT
      ],
      "#e": $issues.map(issue=>issue.id)
    }]
    return deriveEvents(repository, {filters: statusFilter})
  })

  const orderedElements = $derived.by(() => {
    const latestStatuses = []
    for (const issue of $issues) {
      const statusesOfIssue = $statuses.filter(
        e=>{
          return getRootEventTagValue(e.tags)===issue.id
        }
      )
      sortBy(e => -e.created_at, statusesOfIssue)

      let latestStatus = statusesOfIssue[0]
      latestStatuses.push(
        {issue: issue, latestStatus: latestStatus}
      )
    }

    sortBy(
      e => {
        const createdAt = e.latestStatus?.created_at ?? e.issue.created_at;
        return -createdAt;
      },
      latestStatuses
    )
    return latestStatuses
  })

  $effect(() => {
    if ($event) {
      const address = Address.fromEvent($event).toString()
      const issueFilter = [
        {
          kinds: [GIT_ISSUE],
          "#a": [address],
          since: now(),
        }
      ]
      const [tagId, ...relays] = $event.tags.find(nthEq(0, "relays")) || []
      repoRelays = relays

      issueSub = subscribe({relays: relays, filters: issueFilter})
    }
  })

  onMount(() => {
    return () => {
      if (issueSub) {
        issueSub.close()
        setChecked($page.url.pathname)
      }
    }
  })
</script>

<div class="relative flex flex-col gap-3 px-2">
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
  {#if $event}
    <GitItem {url} event={$event} showIssues={false}/>
    <Divider />
    {#if orderedElements}
      {#each orderedElements as {issue, latestStatus} (issue.id)}
        <GitIssueItem
          {issue}
          {latestStatus}
          relays={repoRelays}
          repoLink={gitworkshopLink}
        />
      {/each}
    {/if}
  {:else}
    {#await sleep(5000)}
      <Spinner loading>Loading issues...</Spinner>
      {:then}
      <p>Failed to load issues.</p>
    {/await}
  {/if}
</div>


