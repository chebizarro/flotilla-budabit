<script lang="ts">
  import { 
    getListTags,
    getPubkeyTagValues,
    GIT_STATUS_CLOSED,
    GIT_STATUS_COMPLETE, 
    GIT_STATUS_DRAFT, 
    GIT_STATUS_OPEN, 
    type TrustedEvent

  } from "@welshman/util"
  import { formatTimestampRelative, userMutes } from "@welshman/app"
  import { nthEq } from "@welshman/lib"
  import { GitIssueStatus } from "@src/lib/util"
  import NoteCard from "./NoteCard.svelte"
  import Content from "./Content.svelte"
  import { nip19 } from "nostr-tools"
  import Link from "@src/lib/components/Link.svelte"
  import Button from "@src/lib/components/Button.svelte"
  
  let {issue, repoLink, latestStatus = undefined}: {
    issue:TrustedEvent,
    latestStatus: TrustedEvent | undefined
    repoLink: string,
  } = $props()

  const subject = issue.tags.find(nthEq(0, "subject"))?.[1] || ""
  const issueLink = $derived(
    repoLink ? `${repoLink}/issues/${nip19.noteEncode(issue.id)}` : ''
  )
  const lastActive = $derived(
    latestStatus?.created_at ?? issue.created_at
  )

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
</script>

<NoteCard class="card2 bg-alt" event={issue}>
  <div class="flex w-full items-center justify-between gap-2">
    <p class="text-xl">{subject}</p>
  </div>
  <Content event={issue}/>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex flex-grow flex-wrap items-center justify-end gap-2">
      <div class="btn btn-neutral btn-xs relative hidden rounded-full sm:flex">
        <Link external class="w-full cursor-pointer" href={issueLink}>
          <span>Modified {formatTimestampRelative(lastActive)}</span>
        </Link>
      </div>
      <div class="badge badge-lg {statusColor}">
        {displayedStatus}
      </div> 
      <Button class="btn btn-primary btn-sm" disabled = {!repoLink}>
        <Link external class="w-full cursor-pointer" href={issueLink}>
          <span class="">View</span>
        </Link>
      </Button>
    </div>
  </div>
</NoteCard>



