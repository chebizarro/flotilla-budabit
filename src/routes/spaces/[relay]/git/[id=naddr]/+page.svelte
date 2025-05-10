<script lang="ts">
  import {onMount, tick} from "svelte"
  import {page} from "$app/stores"
  import {sortBy, nthEq, now} from "@welshman/lib"
  import {
    Address,
    GIT_ISSUE,
    GIT_STATUS_CLOSED,
    GIT_STATUS_COMPLETE,
    GIT_STATUS_DRAFT,
    GIT_STATUS_OPEN,
    type Filter,
    type TrustedEvent,
  } from "@welshman/util"
  import {repository} from "@welshman/app"
  import {deriveEvents} from "@welshman/store"
  import {decodeRelay} from "@app/state"
  import {setChecked} from "@app/notifications"
  import {load} from "@welshman/net"
  import {nip19} from "nostr-tools"
  import {getRootEventTagValue} from "@src/lib/util"
  import Divider from "@src/lib/components/Divider.svelte"
  import type {AddressPointer} from "nostr-tools/nip19"
  import {Router} from "@welshman/router"
  import {Card} from "@nostr-git/ui"
    import { GitBranch, GitCommit, Users } from "@lucide/svelte"
    import key from "@lucide/svelte/icons/key"
    
  const {relay, id} = $page.params
  const url = decodeRelay(relay)

  let repoEvent: TrustedEvent | undefined = $state(undefined)

  let gitworkshopLink = $state("")

  let statusSub: Subscription
  let newIssuesSub: Subscription
  const statusOfNewIssuesSubs: Subscription[] = []

  let repoRelays: string[] = $state([])

  const back = () => history.back()

  const issues = $derived.by(() => {
    if (repoEvent) {
      const address = Address.fromEvent(repoEvent).toString()
      const issueFilter = [{kinds: [GIT_ISSUE], "#a": [address]}]

      return deriveEvents(repository, {filters: issueFilter})
    }
  })

  const statuses = $derived.by(() => {
    if ($issues) {
      const statusFilter = [
        {
          kinds: [GIT_STATUS_OPEN, GIT_STATUS_COMPLETE, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT],
          "#e": $issues.map(issue => issue.id),
        },
      ]
      return deriveEvents(repository, {filters: statusFilter})
    }
  })

  const orderedElements = $derived.by(() => {
    if ($issues && $statuses) {
      const latestStatuses = []
      for (const issue of $issues) {
        // Need deep copy, no mutations allowed
        let latestStatus: {sid: string; ts: number} | undefined
        const filteredStatuses = $statuses.filter(s => getRootEventTagValue(s.tags) === issue.id)
        if (filteredStatuses.length > 0) {
          latestStatus = {sid: "", ts: 0}
          for (const status of filteredStatuses) {
            if (status.created_at > latestStatus.ts) {
              latestStatus = {sid: status.id, ts: status.created_at}
            }
          }
        }
        latestStatuses.push({
          issue: {id: issue.id, ts: issue.created_at},
          latestStatus: latestStatus,
        })
      }

      return sortBy(e => {
        const createdAt = e.latestStatus?.ts ?? e.issue.ts
        return -createdAt
      }, latestStatuses)
    }
  })

  let loading = $state(false)
  let failedToLoad = $state(false)

  const initialize = async () => {
    setTimeout(() => {
      if (loading) failedToLoad = true
    }, 8000)
    loading = true
    await tick()
    const naddr = nip19.decode(id).data as AddressPointer
    const backupRelays = [...Router.get().FromPubkey(naddr.pubkey).getUrls()]
    const events = await load({
      relays: naddr.relays ?? backupRelays,
      filters: [
        {
          authors: [naddr.pubkey],
          kinds: [naddr.kind],
          "#d": [naddr.identifier],
        },
      ],
    })
    if (events.length > 0) {
      repoEvent = events[0]
      const repoNpub = nip19.npubEncode(repoEvent.pubkey)
      const repoDtag = repoEvent.tags.find(nthEq(0, "d"))?.[1]
      gitworkshopLink = `https://gitworkshop.dev/${repoNpub}/${repoDtag}`
      const address = Address.fromEvent(repoEvent).toString()

      const [tagId, ...relays] =
        repoEvent.tags.find(nthEq(0, "relays")) ?? naddr.relays ?? backupRelays

      repoRelays = relays

      const issuesFilter: Filter = {
        kinds: [GIT_ISSUE],
        "#a": [address],
      }

      const issues = await load({
        relays: repoRelays,
        filters: [issuesFilter],
      })

      loading = false
      await tick()

      const statusesOfAllIssuesFilter: Filter = {
        kinds: [GIT_STATUS_OPEN, GIT_STATUS_COMPLETE, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT],
        "#e": issues.map(issue => issue.id),
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
        onEvent: (issue: TrustedEvent) => {
          const statusFilter: Filter[] = [
            {
              kinds: [GIT_STATUS_OPEN, GIT_STATUS_COMPLETE, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT],
              "#e": [issue.id],
              since: now(),
            },
          ]
          const sub = subscribe({
            relays: relays,
            filters: statusFilter,
            onEvent: (status: TrustedEvent) => {
              // console.log("Received new status",status)
            },
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
        statusOfNewIssuesSubs.forEach(s => {
          s.close()
        })
      }
      setChecked($page.url.pathname)
    }
  })

  const stats = [
    { label: 'Active Branches', value: '5', icon: GitBranch },
    { label: 'Total Commits', value: '241', icon: GitCommit },
    { label: 'Contributors', value: '15', icon: Users },
  ];

</script>

<div class="relative flex flex-col gap-3 px-2">
  <div class="grid grid-cols-3 gap-4">
    {#each stats as stat}
      <Card class="p-4">
        <div class="flex items-center gap-2">
          <stat.icon class="h-5 w-5 text-muted-foreground" />
          <div>
            <p class="text-sm text-muted-foreground">{stat.label}</p>
            <p class="text-2xl font-semibold">{stat.value}</p>
          </div>
        </div>
      </Card>
    {/each}
  </div>

</div>
