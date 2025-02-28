<script lang="ts">
  import {onMount, tick} from "svelte"
  import {page} from "$app/stores"
  import {sortBy, nthEq, now, ctx} from "@welshman/lib"
  import {
    Address,
    GIT_ISSUE,
    GIT_STATUS_CLOSED,
    GIT_STATUS_COMPLETE,
    GIT_STATUS_DRAFT,
    GIT_STATUS_OPEN,
    type Filter,
    type TrustedEvent}
  from "@welshman/util"
  import {load, repository, subscribe} from "@welshman/app"
  import {deriveEvents} from "@welshman/store"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Button from "@lib/components/Button.svelte"
  import MenuSpaceButton from "@app/components/MenuSpaceButton.svelte"
  import {decodeRelay} from "@app/state"
  import {setChecked} from "@app/notifications"
  import type { Subscription } from "@welshman/net"
  import GitItem from "@src/app/components/GitItem.svelte"
  import GitIssueItem from "@src/app/components/GitIssueItem.svelte"
  import { nip19 } from "nostr-tools"
  import { getRootEventTagValue } from "@src/lib/util"
  import Divider from "@src/lib/components/Divider.svelte"
  import type { AddressPointer } from "nostr-tools/nip19"
  import { fly } from "svelte/transition"

  const {relay, id} = $page.params
  const url = decodeRelay(relay)

  let repoEvent: TrustedEvent | undefined = $state(undefined)

  let gitworkshopLink = $state("") 

  let statusSub: Subscription
  let newIssuesSub: Subscription
  const statusOfNewIssuesSubs: Subscription[] = []

  let repoRelays:string[] = $state([])

  const back = () => history.back()

  const issues = $derived.by(() => {
    if (repoEvent) {
      const address = Address.fromEvent(repoEvent).toString()
      const issueFilter = [{kinds: [GIT_ISSUE], "#a": [address]}]

      return deriveEvents(repository, {filters: issueFilter})
    }
  })

  const statuses = $derived.by(()=>{
    if ($issues) {
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
    }
  })

  const orderedElements = $derived.by(() => {
    if ($issues && $statuses) {
      const latestStatuses = []
      for (const issue of $issues) {
        // Need deep copy, no mutations allowed
        let latestStatus: {sid: string, ts: number} | undefined
        const filteredStatuses = $statuses.filter(
          s=>getRootEventTagValue(s.tags)===issue.id
        )
        if (filteredStatuses.length > 0) {
          latestStatus = {sid: "", ts: 0}
          for (const status of filteredStatuses) {
            if (status.created_at > latestStatus.ts) {
              latestStatus = {sid: status.id, ts: status.created_at}
            }
          }
        }
        latestStatuses.push(
          {issue: {id: issue.id, ts: issue.created_at}, latestStatus: latestStatus}
        )
      }

      return sortBy(
        e => {
          const createdAt = e.latestStatus?.ts ?? e.issue.ts;
          return -createdAt;
        },
        latestStatuses
      )
    }
  })

  let loading = $state(false)
  let failedToLoad = $state(false)

  const initialize = async () => {
    setTimeout(
      ()=>{
        if (loading) failedToLoad = true
      },
      8000
    )
    loading = true
    await tick()
    const naddr = nip19.decode(id).data as AddressPointer
    const backupRelays = [
      ...ctx.app.router.FromPubkey(naddr.pubkey).getUrls()
    ]
    const events = await load({
      relays: naddr.relays ?? backupRelays,
      filters: [{
        authors: [naddr.pubkey],
        kinds: [naddr.kind], 
        '#d': [naddr.identifier]
      }]
    })
    if (events.length > 0){
      repoEvent = events[0]
      const repoNpub = nip19.npubEncode(repoEvent.pubkey)
      const repoDtag = repoEvent.tags.find(nthEq(0, "d"))?.[1]
      gitworkshopLink = `https://gitworkshop.dev/${repoNpub}/${repoDtag}`
      const address = Address.fromEvent(repoEvent).toString()

      const [tagId, ...relays] = repoEvent.tags.find(
        nthEq(0, "relays")
      ) ?? naddr.relays ?? backupRelays

      repoRelays = relays

      const issuesFilter:Filter = {
          kinds: [GIT_ISSUE],
          "#a": [address],
      }

      const issues = await load({
        relays: repoRelays,
        filters: [issuesFilter],
      })

      loading = false
      await tick()

      const statusesOfAllIssuesFilter:Filter = {
        kinds: [
          GIT_STATUS_OPEN,
          GIT_STATUS_COMPLETE,
          GIT_STATUS_CLOSED,
          GIT_STATUS_DRAFT
        ],
        "#e": issues.map(issue=>issue.id),
      }

      const statuses = await load({
        relays: relays,
        filters: [statusesOfAllIssuesFilter],
      })

      statusesOfAllIssuesFilter.since = now()

      statusSub = subscribe({
        relays: repoRelays,
        filters: [statusesOfAllIssuesFilter],
        // onEvent: (status) => console.log("New status received", status)
      })

      issuesFilter.since = now()

      newIssuesSub = subscribe({
        relays: relays,
        filters: [issuesFilter],
        onEvent: (issue:TrustedEvent) => {
          const statusFilter:Filter[] = [{
            kinds: [
              GIT_STATUS_OPEN,
              GIT_STATUS_COMPLETE,
              GIT_STATUS_CLOSED,
              GIT_STATUS_DRAFT
            ],
            "#e": [issue.id],
            since: now(),
          }]
          const sub = subscribe({
            relays: relays,
            filters: statusFilter,
            onEvent: (status: TrustedEvent) => {
              // console.log("Received new status",status)
            }
          })
          statusOfNewIssuesSubs.push(sub) 
        },
      })
    }
  }

  onMount(() => {
    initialize()

    return () => {
      if (statusSub) {
        statusSub.close()
      }
      if (newIssuesSub) {
        newIssuesSub.close()
      }
      if (statusOfNewIssuesSubs.length > 0) {
        statusOfNewIssuesSubs.forEach((s) => {
          s.close()
        })
      }
      setChecked($page.url.pathname)
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
  {#if !loading && repoEvent}
    <GitItem {url} event={repoEvent} showIssues={false}/>
    <Divider />
    {#if orderedElements}
      {#each orderedElements as {issue:issueItem, latestStatus} (issueItem.id)}
        {@const foundIssue = $issues!.find(i=>i.id === issueItem.id) as TrustedEvent}
        {@const status = $statuses?.find(s=>s.id === latestStatus?.sid)}
        <GitIssueItem
          issue={foundIssue}
          latestStatus={status}
          showThreadAction={true}
        />
      {/each}
      {#if orderedElements.length === 0}
        <p class="flex h-10 items-center justify-center py-20" out:fly>
          <span>No issues found.</span>
        </p>
      {/if}
    {/if}
  {:else}
    <p class="flex h-10 items-center justify-center py-20" out:fly>
      {#if failedToLoad}
        <span>Failed to load issues.</span>
      {:else}
        <Spinner loading>Loading issues...</Spinner>
      {/if}
    </p>
  {/if}
</div>


