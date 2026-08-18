import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("exact community room routes", () => {
  const roomList = readProjectFile("../../routes/c/[community]/rooms/+page.svelte")
  const roomDetail = readProjectFile("../../routes/c/[community]/rooms/[room]/+page.svelte")
  const roomCreate = readProjectFile("../components/community/CommunityRoomCreate.svelte")
  const roomLink = readProjectFile("../components/RoomLink.svelte")

  it("parses only the canonical kind-32222 route pointer on direct refresh", () => {
    for (const source of [roomList, roomDetail]) {
      expect(source).toContain("parseExactCommunityRouteParam($page.params.community)")
      expect(source).not.toContain("parseCommunityRouteParam")
      expect(source).not.toContain("parsedCommunity?.pubkey")
      expect(source).not.toContain("ncommunity")
    }
  })

  it("separates stable room scope from exact branch identity and navigation", () => {
    expect(roomDetail).toContain('const communityId = $derived(community?.communityId || "")')
    expect(roomDetail).toContain('const communityAddress = $derived(community?.address || "")')
    expect(roomDetail).toContain("makeExactCommunityRoomPath(community, roomId)")
    expect(roomDetail).toContain("makeCommunityRoomMessagesFilter(communityId, room.id)")
    expect(roomDetail).toContain("scopeH={communityId}")
    expect(roomDetail).toContain("semanticKey: `room-message:${communityAddress}:${room.id}`")
    expect(roomDetail).toContain("owner: `active-room:${communityAddress}:${roomId}`")
    expect(roomDetail).toContain("`${communityAddress}:${roomId}`")
    expect(roomDetail).toContain("communityAddress,")
  })

  it("carries exact pointer context through room creation and links", () => {
    expect(roomCreate).toContain("community: CommunityPointer")
    expect(roomCreate).toContain("community.address")
    expect(roomCreate).toContain("community.communityId")
    expect(roomCreate).toContain("makeExactCommunityRoomPath(community, thunk.event.id)")
    expect(roomLink).toContain("community: CommunityPointer")
    expect(roomLink).toContain("makeExactCommunityRoomPath(community, roomId)")
    expect(roomLink).not.toContain("communityPubkey")
  })

  it("passes exact branch context into message actions and modals", () => {
    for (const component of [
      readProjectFile("../components/RoomItem.svelte"),
      readProjectFile("../components/ChannelMessage.svelte"),
    ]) {
      expect(component).toContain("community?: CommunityPointer")
      expect(component).toContain("community?.address || url")
      expect(component).toContain("communityAddress: community?.address")
      expect(component).toMatch(/pushModal\([\s\S]*?\{[\s\S]*?community,/)
    }
  })
})
