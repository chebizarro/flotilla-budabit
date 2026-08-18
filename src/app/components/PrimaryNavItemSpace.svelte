<script lang="ts">
  import {displayRelayUrl} from "@welshman/util"
  import PrimaryNavItem from "@lib/components/PrimaryNavItem.svelte"
  import RelayIcon from "@app/components/RelayIcon.svelte"
  import {goto} from "$app/navigation"
  import {makeExactCommunityPath, parseExactCommunityRouteParam} from "@app/util/routes"
  import {notifications} from "@app/util/notifications"

  type Props = {
    url: string
  }

  const {url}: Props = $props()
  const community = $derived(parseExactCommunityRouteParam(url))
  const path = $derived(community ? makeExactCommunityPath(community) : "/explore")

  const onClick = () => goto(path)
</script>

<PrimaryNavItem
  onclick={onClick}
  title={displayRelayUrl(url)}
  class="tooltip-right"
  notification={$notifications.has(path)}>
  <RelayIcon {url} size={7} class="rounded-full" />
</PrimaryNavItem>
