<script lang="ts">
  import cx from "classnames"
  import Link from "@lib/components/Link.svelte"
  import RoomName from "@app/components/RoomName.svelte"
  import type {CommunityPointer} from "@app/core/community"
  import type {CommunityRoomRoot} from "@app/core/community-rooms"
  import {makeExactCommunityRoomPath} from "@app/util/routes"

  type Props = {
    h?: string
    community: CommunityPointer
    room?: CommunityRoomRoot
    class?: string
    unstyled?: boolean
  }

  const {h, community, room, unstyled, ...props}: Props = $props()

  const roomId = $derived(room?.id || h || "")
  const path = $derived(roomId ? makeExactCommunityRoomPath(community, roomId) : "#")
</script>

<Link href={path} class={cx(props.class, {"link-content bg-alt": !unstyled})}>
  #<RoomName {h} {room} />
</Link>
