<script lang="ts">
  import { load } from "@welshman/app"
  import {Address, GIT_ISSUE, type Filter, type TrustedEvent} from "@welshman/util"
  import {pubkey} from "@welshman/app"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import ThunkStatusOrDeleted from "@app/components/ThunkStatusOrDeleted.svelte"
  import EventActions from "@app/components/EventActions.svelte"
  import {publishDelete, publishReaction} from "@app/commands"
  import {makeGitPath} from "@app/routes"
  import Button from "@src/lib/components/Button.svelte"
  import Link from "@src/lib/components/Link.svelte"
  import { nthEq } from "@welshman/lib"
  import { onMount } from "svelte"

  interface Props {
    url: any
    event: TrustedEvent
    showIssues?: boolean
    showActivity?: boolean
  }

  const {url, event, showIssues=true, showActivity}: Props = $props()
  let issues: TrustedEvent[] = []
  const issueFilter:Filter = {kinds: [GIT_ISSUE]}
  let issueCount = $state(0)

  const onReactionClick = (content: string, events: TrustedEvent[]) => {
    const reaction = events.find(e => e.pubkey === $pubkey)
    if (reaction) {
      publishDelete({relays: [url], event: reaction})
    } else {
      publishReaction({event, content, relays: [url]})
    }
  }

  const loadIssues = async () => {
    const address = Address.fromEvent(event)
    issueFilter['#a'] = [address.toString()]
    const [tagId, ...relays] = event.tags.find(nthEq(0, "relays")) || []
    console.log("Issue Filter", issueFilter)
    issues = await load({
      relays: relays,
      filters: [ issueFilter ]
    })
    console.log("Issues loaded:", issues)
    issueCount = issues.length
  } 

  onMount(() => {
    if (showIssues) {
      loadIssues()
    }
  })

  const web = event.tags.find(nthEq(0, "web"))?.[1]
</script>

<div class="flex flex-wrap items-center justify-between gap-2">
  <div class="flex flex-grow flex-wrap justify-end gap-2">
    {#if web}
      <Button class="btn btn-primary btn-sm">
        <Link external class="w-full cursor-pointer" href={web}>
          <span class="">Browse</span>
        </Link>
      </Button>
    {/if}
    {#if showIssues}
      <Button class="btn btn-secondary btn-sm">
        <Link class="w-full cursor-pointer" href={makeGitPath(url,event.id)}>
          <span class="">{"Issues(" + issueCount + ")"}</span>
        </Link>
      </Button>
    {/if}
    {#if showActivity}
      <ReactionSummary {url} {event} {onReactionClick} reactionClass="tooltip-left" />
      <ThunkStatusOrDeleted {event} />
      <EventActions {url} {event} noun="Repo" />
    {/if}
  </div>
</div>
