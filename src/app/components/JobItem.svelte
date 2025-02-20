<script lang="ts">
  import {nthEq} from "@welshman/lib"
  import {type TrustedEvent} from "@welshman/util"
  import {formatTimestamp} from "@welshman/app"
  import Content from "@app/components/Content.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import Link from "@src/lib/components/Link.svelte"

  import { makeJobPath } from "@app/routes"
  import JobActions from "./JobActions.svelte"
  import NoteCard from "./NoteCard.svelte"

  const {
    url,
    external = false,
    event,
  }: {
    url: string
    external: boolean
    event: TrustedEvent
  } = $props()

  const title = event.tags.find(nthEq(0, "title"))?.[1]
</script>

{#snippet jobContent()}
  <NoteCard {event} class="card2 bg-alt">
    {#if title}
      <div class="flex w-full items-center justify-between gap-2">
        <p class="text-xl">{title}</p>
      </div>
    {:else}
      <p class="mb-3 h-0 text-xs opacity-75">
        {formatTimestamp(event.created_at)}
      </p>
    {/if}
    <Content {event} expandMode="inline" quoteProps={{relays: [url]}} />
    <div class="flex w-full flex-col items-end justify-between gap-2 sm:flex-row">
      <span class="whitespace-nowrap py-1 text-sm opacity-75">
        Posted by <ProfileLink pubkey={event.pubkey} />
      </span>
      <JobActions showActivity {url} {event} {external} />
    </div>
  </NoteCard>
{/snippet}

{#if external}
  {@render jobContent()}
{:else}
  <Link class="col-2 card2 bg-alt w-full cursor-pointer" href={makeJobPath(url, event.id)}>
    {@render jobContent()}
  </Link>
{/if}

