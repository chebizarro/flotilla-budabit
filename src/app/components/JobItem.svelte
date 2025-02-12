<script lang="ts">
  import {nthEq} from "@welshman/lib"
  import {Address, type TrustedEvent} from "@welshman/util"
  import {formatTimestamp} from "@welshman/app"
  import Link from "@lib/components/Link.svelte"
  import Content from "@app/components/Content.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import ThreadActions from "@app/components/ThreadActions.svelte"
  import { jobLink } from "@app/state"

  const {
    url,
    event,
  }: {
    url: string
    event: TrustedEvent
  } = $props()

  const title = event.tags.find(nthEq(0, "title"))?.[1]
</script>

<Link external class="col-2 card2 bg-alt w-full cursor-pointer" href={jobLink(Address.fromEvent(event).toNaddr())}>
  {#if title}
    <div class="flex w-full items-center justify-between gap-2">
      <p class="text-xl">{title}</p>
      <p class="text-sm opacity-75">
        {formatTimestamp(event.created_at)}
      </p>
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
    <ThreadActions showActivity {url} {event} />
  </div>
</Link>
