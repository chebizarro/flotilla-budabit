<script lang="ts">
  import {type TrustedEvent} from "@welshman/util"
  import {pubkey} from "@welshman/app"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import ThunkStatusOrDeleted from "@app/components/ThunkStatusOrDeleted.svelte"
  import EventActivity from "@app/components/EventActivity.svelte"
  import EventActions from "@app/components/EventActions.svelte"
  import {publishDelete, publishReaction} from "@app/commands"
  import {makeGitPath} from "@app/routes"
  import Button from "@src/lib/components/Button.svelte"
  import Link from "@src/lib/components/Link.svelte"
  import { nthEq } from "@welshman/lib"

  interface Props {
    url: any
    event: any
    showActivity?: boolean
  }

  const {url, event, showActivity}: Props = $props()

  const path = makeGitPath(url, event.id)

  const onReactionClick = (content: string, events: TrustedEvent[]) => {
    const reaction = events.find(e => e.pubkey === $pubkey)
    if (reaction) {
      publishDelete({relays: [url], event: reaction})
    } else {
      publishReaction({event, content, relays: [url]})
    }
  }

  const web = event.tags.find(nthEq(0, "web"))?.[1]
</script>

<div class="flex flex-wrap items-center justify-between gap-2">
  <div class="flex flex-grow flex-wrap justify-end gap-2">
      <Button class="btn btn-primary btn-sm">
        <Link external class="w-full cursor-pointer" href={web}>
          <span class="">Browse</span>
        </Link>
      </Button>
    {#if showActivity}
      <ReactionSummary {url} {event} {onReactionClick} reactionClass="tooltip-left" />
      <ThunkStatusOrDeleted {event} />
      <EventActivity {url} {path} {event} />
      <EventActions {url} {event} noun="Job" />
    {/if}
  </div>
</div>
