import {request} from "@welshman/net"
import {repository} from "@welshman/app"
import {DELETE, type TrustedEvent} from "@welshman/util"
import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
import {
  parseCommunityAuthorityV2,
  parseCommunityDefinitionAddress,
  type CommunityPointer,
} from "@app/core/community-v2"

export const COMMUNITY_DELETE_LOOKBACK_SECONDS = 60 * 60 * 24 * 30
export const COMMUNITY_DELETE_SINCE_BUFFER_SECONDS = 60

export const normalizeDeleteCheckpoint = (value: number) =>
  value > 10_000_000_000 ? Math.round(value / 1000) : value

export const getCommunityDeleteSeenKey = (definitionAddress: string) => {
  const pointer = parseCommunityDefinitionAddress(definitionAddress)
  return pointer ? `communityDeleteSeen:${pointer.address}` : ""
}

export const getCommunityDeleteSince = (lastDeleteSeen: number) =>
  lastDeleteSeen > 0
    ? Math.max(0, lastDeleteSeen - COMMUNITY_DELETE_SINCE_BUFFER_SECONDS)
    : Math.floor(Date.now() / 1000) - COMMUNITY_DELETE_LOOKBACK_SECONDS

export const hydrateCommunityDeleteEvents = async ({
  relays,
  community,
  kinds,
  since,
  signal,
}: {
  relays: string[]
  community: CommunityPointer
  kinds: number[]
  since: number
  signal?: AbortSignal
}) => {
  const pointer = parseCommunityDefinitionAddress(community.address)
  if (
    relays.length === 0 ||
    kinds.length === 0 ||
    !pointer ||
    pointer.controllerPubkey !== community.controllerPubkey ||
    pointer.communityId !== community.communityId
  ) {
    return 0
  }

  let latestDeleteSeen = 0

  await request({
    relays,
    autoClose: true,
    threshold: 0.5,
    signal,
    priority: RELAY_REQUEST_PRIORITY.community,
    filters: [{kinds: [DELETE], "#h": [pointer.communityId], "#k": kinds.map(String), since}],
    onEvent: event => {
      if (parseCommunityAuthorityV2(event)?.address !== pointer.address) return
      if (!repository.getEvent(event.id)) {
        repository.publish(event as TrustedEvent)
      }
      if (event.created_at > latestDeleteSeen) {
        latestDeleteSeen = event.created_at
      }
    },
  }).catch(() => undefined)

  return latestDeleteSeen
}
