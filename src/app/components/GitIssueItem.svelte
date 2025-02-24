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
    type Filter, 
    type TrustedEvent

  } from "@welshman/util"
  import { repository, userMutes } from "@welshman/app"
  import { deriveEvents } from "@welshman/store"
  import { now, nthEq, sortBy } from "@welshman/lib"
  import { GitIssueStatus } from "@src/lib/util"
  import NoteCard from "./NoteCard.svelte"
  import Content from "./Content.svelte"
  import { nip19 } from "nostr-tools"
  import Link from "@src/lib/components/Link.svelte"
  import Button from "@src/lib/components/Button.svelte"
  
  const {issue, relays, repoLink, latestStatus = undefined}: {
    issue:TrustedEvent,
    latestStatus: TrustedEvent | undefined
    relays:string[],
    repoLink: string,
  } = $props()

  const subject = issue.tags.find(nthEq(0, "subject"))?.[1] || ""
  const issueLink = `${repoLink}/issues/${nip19.noteEncode(issue.id)}`

  const mutedPubkeys = getPubkeyTagValues(getListTags($userMutes))

  let statusColor = $state("badge-success")
  let displayedStatus = $state(GitIssueStatus.OPEN)

  $effect(()=>{
    if (latestStatus) {
      switch (latestStatus.kind) {
        case GIT_STATUS_OPEN:
          statusColor = "badge-success"
          displayedStatus = GitIssueStatus.OPEN
          break;
        case GIT_STATUS_CLOSED:
          statusColor = "badge-error"
          displayedStatus = GitIssueStatus.CLOSED
          break;
        case GIT_STATUS_COMPLETE:
          statusColor = "badge-info"
          displayedStatus = GitIssueStatus.RESOLVED
          break;
        case GIT_STATUS_DRAFT:
          statusColor = "badge-warning"
          displayedStatus = GitIssueStatus.DRAFT
          break;
      }
    }
  })

  onMount(() => {
    // This sub will actually make latestStatus update from the parent page
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
    })

    return () => {
      if (sub) {
        sub.close()
        setChecked($page.url.pathname)
      }
    }
  })
</script>

<NoteCard class="card2 bg-alt" event={issue}>
  <div class="flex w-full items-center justify-between gap-2">
    <p class="text-xl">{subject}</p>
  </div>
  <Content event={issue}/>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex flex-grow flex-wrap items-center justify-end gap-2">
      <Button class="btn btn-primary btn-sm">
        <Link external class="w-full cursor-pointer" href={issueLink}>
          <span class="">View</span>
        </Link>
      </Button>
      <div class="badge badge-lg {statusColor}">
        {displayedStatus}
      </div> 
    </div>
  </div>
</NoteCard>



