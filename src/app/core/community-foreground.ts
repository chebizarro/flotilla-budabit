import {writable} from "svelte/store"

export type ActiveCommunityRoomLoad = {
  communityAddress: string
  roomId: string
  pending: boolean
}

const emptyActiveCommunityRoomLoad = (): ActiveCommunityRoomLoad => ({
  communityAddress: "",
  roomId: "",
  pending: false,
})

export const activeCommunityRoomLoad = writable<ActiveCommunityRoomLoad>(
  emptyActiveCommunityRoomLoad(),
)

export const clearActiveCommunityRoomLoad = (communityAddress: string, roomId: string) =>
  activeCommunityRoomLoad.update(current =>
    current.communityAddress === communityAddress && current.roomId === roomId
      ? emptyActiveCommunityRoomLoad()
      : current,
  )
