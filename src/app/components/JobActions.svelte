<script lang="ts">
  import {Address, type TrustedEvent} from "@welshman/util"
  import {pubkey, tracker} from "@welshman/app"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import ThunkStatusOrDeleted from "@app/components/ThunkStatusOrDeleted.svelte"
  import EventActivity from "@app/components/EventActivity.svelte"
  import EventActions from "@app/components/EventActions.svelte"
  import {publishDelete, publishReaction} from "@app/commands"
  import {makeJobPath} from "@app/routes"
  import Button from "@src/lib/components/Button.svelte"
  import Link from "@src/lib/components/Link.svelte"
  import {jobLink} from "@app/state"
  import { pushModal } from "../modal"
  import ThreadCreate from "./ThreadCreate.svelte"
  import { ctx } from "@welshman/lib"

  interface Props {
    url: any
    event: any
    showExternal: boolean
    showActivity?: boolean
    showThreadAction?: boolean
  }

  const {
    url,
    event,
    showExternal=false,
    showActivity = false,
    showThreadAction = false
  }: Props = $props()

  const path = makeJobPath(url, event.id)

  const relayHint = $derived.by(() => {
    const eventRelays = Array.from(tracker.getRelays(event.id))
    const address = Address.fromEvent(event)
    const pubkeyRelays = ctx.app.router.FromPubkey(address.pubkey).getUrls()

    if (eventRelays.length > 0) return eventRelays[0]
    if (pubkeyRelays.length > 0) return pubkeyRelays[0]
    return ''
  })

  const startThread = () => pushModal(
    ThreadCreate, 
    {url: url, jobOrGitIssue: event, relayHint: relayHint}
  )

  const onReactionClick = (content: string, events: TrustedEvent[]) => {
    const reaction = events.find(e => e.pubkey === $pubkey)

    if (reaction) {
      publishDelete({relays: [url], event: reaction})
    } else {
      publishReaction({event, content, relays: [url]})
    }
  }
</script>

<div class="flex flex-wrap items-center justify-between gap-2">
  <div class="flex flex-grow flex-wrap justify-end gap-2">
    <Button class="btn btn-success btn-sm">
      <Link class="w-full cursor-pointer" href={path}>
        <span class="">Comment</span>
      </Link>
    </Button>
    {#if showThreadAction}
      <Button class="btn btn-primary btn-sm" onclick={startThread}>
        <span class="">+Thread</span>
      </Button>
    {/if}
    {#if showExternal}
      <Button class="btn btn-info btn-sm">
        <Link external class="w-full cursor-pointer" href={jobLink(Address.fromEvent(event).toNaddr())}>
          <span class="">SatShoot</span>
        </Link>
      </Button>
    {/if}
    <ReactionSummary {url} {event} {onReactionClick} reactionClass="tooltip-left" />
    <ThunkStatusOrDeleted {event} />
    {#if showActivity}
      <EventActivity {url} {path} {event} />
    {/if}
      <EventActions {url} {event} noun="Job" />
  </div>
</div>
