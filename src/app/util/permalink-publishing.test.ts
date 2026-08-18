import {beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => ({
  publishCount: 0,
  publishThunk: vi.fn(({event}: {event: Record<string, unknown>}) => {
    mocks.publishCount += 1
    return {
      event: {
        ...event,
        id: String(mocks.publishCount).padStart(64, "0"),
        pubkey: "2".repeat(64),
        sig: "3".repeat(128),
      },
    }
  }),
  repositoryPublish: vi.fn(),
  makeTargetedPublicationForCommunityV2: vi.fn(() => ({tags: []})),
}))

vi.mock("@welshman/app", () => ({
  publishThunk: mocks.publishThunk,
  repository: {publish: mocks.repositoryPublish},
}))

vi.mock("@welshman/util", () => ({
  makeEvent: (kind: number, event: Record<string, unknown>) => ({kind, ...event}),
  normalizeRelayUrl: (url: string) => (url.endsWith("/") ? url : `${url}/`),
  isRelayUrl: (url: string) => /^wss?:\/\//.test(url),
}))

vi.mock("@welshman/lib", () => ({randomId: () => "target-id"}))
vi.mock("@nostr-git/core/types", () => ({GIT_PERMALINK: 1623}))
vi.mock("@app/core/community", () => ({
  TARGETED_PUBLICATION_KIND_V2: 30222,
  makeCommunityPointer: ({controllerPubkey, communityId, relayHints}: any) => ({
    controllerPubkey,
    communityId,
    relayHints,
    address: `32222:${controllerPubkey}:${communityId}`,
    naddr: "naddr",
  }),
}))
vi.mock("@app/core/community-targeting", () => ({
  makeEventPublicationRef: (value: unknown) => value,
  makeTargetedPublicationForCommunityV2: mocks.makeTargetedPublicationForCommunityV2,
  withPublicationTargetingId: (event: {tags: string[][]}, id: string) => ({
    ...event,
    tags: [...event.tags, ["h", id]],
  }),
}))

const permalink = {
  id: "",
  pubkey: "",
  sig: "",
  kind: 1623 as const,
  created_at: 0,
  content: "code",
  tags: [],
}

describe("permalink publishing", () => {
  beforeEach(() => {
    mocks.publishCount = 0
    mocks.publishThunk.mockClear()
    mocks.repositoryPublish.mockClear()
    mocks.makeTargetedPublicationForCommunityV2.mockClear()
  })

  it("returns the relays used for a community-only permalink publication", async () => {
    const {publishPermalinkToDestinations} = await import("./permalink-publishing")

    const published = publishPermalinkToDestinations({
      permalink,
      relays: ["wss://repo.example.com"],
      communityOptions: [
        {
          controllerPubkey: "4".repeat(64),
          address: `32222:${"4".repeat(64)}:${"5".repeat(64)}`,
          communityId: "5".repeat(64),
          label: "Community",
          relays: ["wss://community.example.com"],
        },
      ],
      selection: {
        personal: false,
        communityAddresses: [`32222:${"4".repeat(64)}:${"5".repeat(64)}`],
      },
      createdAt: 10,
    })

    expect(published?.event).toMatchObject({kind: 1623, tags: [["h", "target-id"]]})
    expect(published?.relays).toEqual(["wss://community.example.com/", "wss://repo.example.com/"])
    expect(mocks.publishThunk.mock.calls[1]?.[0].event.tags).not.toContainEqual([
      "p",
      "5".repeat(64),
    ])
    expect(mocks.makeTargetedPublicationForCommunityV2).toHaveBeenCalledWith(
      expect.objectContaining({
        originalRef: expect.objectContaining({id: "1".padStart(64, "0")}),
        community: expect.objectContaining({
          address: `32222:${"4".repeat(64)}:${"5".repeat(64)}`,
        }),
      }),
    )
  })
})
