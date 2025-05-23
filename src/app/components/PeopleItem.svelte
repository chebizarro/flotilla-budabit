<script lang="ts">
  import {onMount} from "svelte"
  import {formatTimestampRelative} from "@welshman/lib"
  import type {Filter} from "@welshman/util"
  import {deriveEvents} from "@welshman/store"
  import {load} from "@welshman/net"
  import {Router} from "@welshman/router"
  import {repository, loadRelaySelections} from "@welshman/app"
  import Icon from "@lib/components/Icon.svelte"
  import Link from "@lib/components/Link.svelte"
  import Profile from "@app/components/Profile.svelte"
  import ProfileInfo from "@app/components/ProfileInfo.svelte"
  import {makeChatPath} from "@app/routes"

  type Props = {
    pubkey: string
    url?: string
  }

  const {pubkey, url}: Props = $props()

  const filters: Filter[] = [{authors: [pubkey], limit: 1}]
  const events = deriveEvents(repository, {filters})

  onMount(async () => {
    // Make sure we have their relay selections before we load their posts
    await loadRelaySelections(pubkey)

    // Load at least one note, regardless of time frame
    load({
      filters: [{authors: [pubkey], limit: 1}],
      relays: Router.get().FromPubkeys([pubkey]).getUrls(),
    })
  })
</script>

<div class="card2 bg-alt col-2 shadow-xl">
  <div class="flex justify-between">
    <Profile {pubkey} {url} />
    <Link class="btn btn-primary hidden sm:flex" href={makeChatPath([pubkey])}>
      <Icon icon="letter" />
      Start a Chat
    </Link>
  </div>
  <ProfileInfo {pubkey} {url} />
  {#if $events.length > 0}
    <div class="bg-alt badge badge-neutral border-none">
      Last active {formatTimestampRelative($events[0].created_at)}
    </div>
  {/if}
  <Link class="btn btn-primary sm:hidden" href={makeChatPath([pubkey])}>
    <Icon icon="letter" />
    Start a Chat
  </Link>
</div>
