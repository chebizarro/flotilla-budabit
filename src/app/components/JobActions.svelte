<script lang="ts">
  import {Address, type TrustedEvent} from "@welshman/util"
  import {pubkey} from "@welshman/app"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import ThunkStatusOrDeleted from "@app/components/ThunkStatusOrDeleted.svelte"
  import EventActivity from "@app/components/EventActivity.svelte"
  import EventActions from "@app/components/EventActions.svelte"
  import {publishDelete, publishReaction} from "@app/commands"
  import {makeJobPath} from "@app/routes"
  import Button from "@src/lib/components/Button.svelte"
  import Link from "@src/lib/components/Link.svelte"
  import {jobLink} from "@app/state"

  interface Props {
    url: any
    external: boolean
    event: any
    showActivity?: boolean
  }

  const {url, external=false, event, showActivity = false}: Props = $props()

  const path = makeJobPath(url, event.id)

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
    {#if external}
      <Button class="btn btn-primary btn-sm">
        <Link external class="w-full cursor-pointer" href={jobLink(Address.fromEvent(event).toNaddr())}>
          <span class="">View in SatShoot</span>
        </Link>
      </Button>
    {:else}
      <ReactionSummary {url} {event} {onReactionClick} reactionClass="tooltip-left" />
      <ThunkStatusOrDeleted {event} />
      {#if showActivity}
        <EventActivity {url} {path} {event} />
      {/if}
      <EventActions {url} {event} noun="Job" />
    {/if}
  </div>
</div>
