<script lang="ts">
  import {page} from "$app/stores"
  import { subscribe } from "@welshman/net"
  import { onMount } from "svelte"
  import { setChecked } from "../notifications"
  import { 
    getListTags,
    getPubkeyTagValues,
    GIT_STATUS_CLOSED,
    GIT_STATUS_COMPLETE, 
    GIT_STATUS_DRAFT, 
    GIT_STATUS_OPEN, 
    type TrustedEvent

  } from "@welshman/util"
  import { load, repository, userMutes } from "@welshman/app"
  import { deriveEvents } from "@welshman/store"
  import { nthEq, sortBy } from "@welshman/lib"
  import { GitIssueStatus } from "@src/lib/util"
  import NoteCard from "./NoteCard.svelte"
  import Content from "./Content.svelte"
  import { nip19 } from "nostr-tools"
  import Link from "@src/lib/components/Link.svelte"
  import Button from "@src/lib/components/Button.svelte"

  
  const {event, relays, repoLink}: {
    event:TrustedEvent,
    relays:string[],
    repoLink: string
  } = $props()
  const statusFilter = [{
    kinds: [
      GIT_STATUS_OPEN,
      GIT_STATUS_COMPLETE,
      GIT_STATUS_CLOSED,
      GIT_STATUS_DRAFT
    ],
    "#e": [event.id]
  }]

  const subject = event.tags.find(nthEq(0, "subject"))?.[1] || ""
  const issueLink = `${repoLink}/issues/${nip19.noteEncode(event.id)}`

  const mutedPubkeys = getPubkeyTagValues(getListTags($userMutes))

  const statusStore = deriveEvents(
    repository,
    { filters: statusFilter }
  )

  let statusColor = $state("badge-success")
  let latestStatus = $state(GitIssueStatus.OPEN)

  $effect(()=>{
    if ($statusStore.length > 0) {
      sortBy(
        e => -e.created_at,
        $statusStore.filter(e => !mutedPubkeys.includes(e.pubkey))
      )
      console.log("Issue statuses found and sorted for issue:", $statusStore)
      switch ($statusStore[0].kind) {
        case GIT_STATUS_OPEN:
          statusColor = "badge-success"
          latestStatus = GitIssueStatus.OPEN
          break;
        case GIT_STATUS_CLOSED:
          statusColor = "badge-error"
          latestStatus = GitIssueStatus.CLOSED
          break;
        case GIT_STATUS_COMPLETE:
          statusColor = "badge-info"
          latestStatus = GitIssueStatus.RESOLVED
          break;
        case GIT_STATUS_DRAFT:
          statusColor = "badge-warning"
          latestStatus = GitIssueStatus.DRAFT
          break;
      }
    }
  })

  onMount(() => {
    load({
      relays: relays,
      filters: statusFilter,
    })

    const sub = subscribe({
      relays: relays,
      filters: statusFilter
    })
    return () => {
      if (sub) {
        sub.close()
        setChecked($page.url.pathname)
      }
    }
  })

  // TODO: OPEN -> Draft -> Resolved -> Closed issues order
  // TODO: Support markdown titles
</script>

<NoteCard class="card2 bg-alt" {event}>
  <div class="flex w-full items-center justify-between gap-2">
    <p class="text-xl">{subject}</p>
  </div>
  <Content {event}/>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex flex-grow flex-wrap items-center justify-end gap-2">
      <Button class="btn btn-primary btn-sm">
        <Link external class="w-full cursor-pointer" href={issueLink}>
          <span class="">View</span>
        </Link>
      </Button>
      <div class="badge badge-lg {statusColor}">
        {latestStatus}
      </div> 
    </div>
  </div>
</NoteCard>



