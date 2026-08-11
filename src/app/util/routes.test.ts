// @vitest-environment jsdom

import {beforeEach, describe, expect, it, vi} from "vitest"
import * as nip19 from "nostr-tools/nip19"

const {
  gotoMock,
  loadMock,
  repositoryGetEvent,
  repositoryQuery,
  requestMock,
  waitAndScrollToEventMock,
} = vi.hoisted(() => ({
  gotoMock: vi.fn(() => Promise.resolve()),
  loadMock: vi.fn(() => Promise.resolve([])),
  repositoryGetEvent: vi.fn(),
  repositoryQuery: vi.fn(() => []),
  requestMock: vi.fn(() => Promise.resolve(undefined)),
  waitAndScrollToEventMock: vi.fn(() => Promise.resolve(true)),
}))

vi.mock("$app/navigation", () => ({goto: gotoMock}))
vi.mock("@lib/html", () => ({
  waitAndScrollToEvent: waitAndScrollToEventMock,
}))
vi.mock("@app/core/state", () => ({
  makeChatId: (recipient: string) => recipient,
  entityLink: (entity: string) => `https://coracle.social/${entity}`,
  DM_KIND: 4,
}))
vi.mock("@app/core/community-feeds", () => ({
  GIT_PERMALINK_KIND: 1623,
  SMART_WIDGET_KIND: 30033,
}))
vi.mock("@welshman/net", () => ({load: loadMock, request: requestMock}))
vi.mock("@welshman/router", () => ({
  Router: {
    get: () => ({
      FromPubkey: () => ({getUrls: () => []}),
      FromUser: () => ({getUrls: () => []}),
    }),
  },
}))
vi.mock("@welshman/app", () => ({
  pubkey: {get: vi.fn()},
  repository: {getEvent: repositoryGetEvent, query: repositoryQuery},
  tracker: {getRelays: vi.fn(() => [])},
}))
vi.mock("@welshman/lib", () => ({
  identity: (value: unknown) => Boolean(value),
  sleep: vi.fn(),
}))
vi.mock("@welshman/util", () => ({
  COMMENT: 1111,
  EVENT_DATE: 31922,
  EVENT_TIME: 31923,
  MESSAGE: 9,
  THREAD: 11,
  ZAP_GOAL: 9041,
  getPubkeyTagValues: vi.fn(() => []),
  getTagValue: (name: string, tags: string[][]) => tags.find(tag => tag[0] === name)?.[1] || "",
  normalizeRelayUrl: (url: string) => (url.endsWith("/") ? url : `${url}/`),
  isRelayUrl: (url: string) => url.startsWith("wss://"),
  isReplaceable: (event: {kind: number}) => event.kind >= 10000 && event.kind < 40000,
  Address: class {
    kind: number
    pubkey: string
    identifier: string
    relays: string[]

    constructor(kind: number, pubkey: string, identifier: string, relays: string[] = []) {
      this.kind = kind
      this.pubkey = pubkey
      this.identifier = identifier
      this.relays = relays
    }

    static fromEvent(event: {kind: number; pubkey: string; tags: string[][]}) {
      return new this(event.kind, event.pubkey, event.tags.find(tag => tag[0] === "d")?.[1] || "")
    }

    toString() {
      return `${this.kind}:${this.pubkey}:${this.identifier}`
    }

    toNaddr() {
      return `naddr:${this.kind}:${this.pubkey}:${this.identifier}`
    }
  },
}))

const makeEvent = (overrides: Record<string, unknown> = {}) => ({
  id: "1".repeat(64),
  pubkey: "2".repeat(64),
  created_at: 1,
  kind: 1,
  tags: [],
  content: "",
  sig: "3".repeat(128),
  ...overrides,
})

const EVENT_TIME = 31923

describe("routes", () => {
  beforeEach(() => {
    gotoMock.mockReset()
    gotoMock.mockResolvedValue(undefined)
    loadMock.mockReset()
    loadMock.mockResolvedValue([])
    repositoryGetEvent.mockReset()
    repositoryQuery.mockReset()
    repositoryQuery.mockReturnValue([])
    requestMock.mockReset()
    requestMock.mockResolvedValue(undefined)
    waitAndScrollToEventMock.mockReset()
    waitAndScrollToEventMock.mockResolvedValue(true)
    window.history.replaceState(null, "", "/")
  })

  it("builds and parses community paths", async () => {
    const {
      makeCommunityPath,
      makeCommunityPermalinkPath,
      makeCommunityRoomPath,
      makeCommunityThreadPath,
      makeCommunityWidgetPath,
      parseCommunityRouteParam,
    } = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const communityNpub = nip19.npubEncode(communityPubkey)

    expect(makeCommunityPath(communityPubkey)).toBe(`/c/${communityNpub}`)
    expect(makeCommunityRoomPath(communityPubkey, "room-id")).toBe(
      `/c/${communityNpub}/rooms/room-id`,
    )
    expect(makeCommunityThreadPath(communityPubkey, "thread-id")).toBe(
      `/c/${communityNpub}/threads/thread-id`,
    )
    expect(makeCommunityPermalinkPath(communityPubkey)).toBe(`/c/${communityNpub}/permalinks`)
    expect(makeCommunityWidgetPath(communityPubkey)).toBe(`/c/${communityNpub}/widgets`)
    expect(parseCommunityRouteParam(communityNpub)).toEqual({
      pubkey: communityPubkey,
      relays: [],
      source: "npub",
    })
  })

  it("builds npub profile paths when no relay hints are provided", async () => {
    const {makeProfilePath} = await import("./routes")
    const profilePubkey = "a".repeat(64)
    const profileNpub = nip19.npubEncode(profilePubkey)

    expect(makeProfilePath(profilePubkey)).toBe(`/people/${profileNpub}`)
    expect(nip19.decode(profileNpub)).toEqual({type: "npub", data: profilePubkey})
  })

  it("builds nprofile profile paths when relay hints are provided", async () => {
    const {makeProfilePath} = await import("./routes")
    const profilePubkey = "b".repeat(64)
    const path = makeProfilePath(profilePubkey, [
      "wss://profile-relay.example.com",
      "",
      "wss://backup-relay.example.com",
    ])
    const encodedProfile = decodeURIComponent(path.replace(/^\/people\//, ""))
    const decoded = nip19.decode(encodedProfile)

    expect(path.startsWith("/people/nprofile1")).toBe(true)
    expect(decoded.type).toBe("nprofile")
    expect(decoded.data).toMatchObject({
      pubkey: profilePubkey,
      relays: ["wss://profile-relay.example.com", "wss://backup-relay.example.com"],
    })
  })

  it("builds git parent paths without using browser history", async () => {
    const {getGitParentPath} = await import("./routes")
    const repoPath = "/git/naddr1repo"

    expect(getGitParentPath(`${repoPath}/issues/issue-id`)).toBe(`${repoPath}/issues`)
    expect(getGitParentPath(`${repoPath}/prs/pr-id`)).toBe(`${repoPath}/prs`)
    expect(getGitParentPath(`${repoPath}/commits/commit-id`)).toBe(`${repoPath}/commits`)
    expect(getGitParentPath(`${repoPath}/extensions/widget-id`)).toBe(repoPath)
    expect(getGitParentPath(`${repoPath}/issues`)).toBe(repoPath)
    expect(getGitParentPath(repoPath)).toBe("/git")
    expect(getGitParentPath("/git")).toBe("/")
  })

  it("labels git parent targets by destination", async () => {
    const {getGitParentTarget} = await import("./routes")
    const repoPath = "/git/naddr1repo"

    expect(getGitParentTarget(`${repoPath}/issues/issue-id`)).toMatchObject({label: "Issues"})
    expect(getGitParentTarget(`${repoPath}/prs/pr-id`)).toMatchObject({label: "PRs"})
    expect(getGitParentTarget(`${repoPath}/commits/commit-id`)).toMatchObject({
      label: "Commits",
    })
    expect(getGitParentTarget(`${repoPath}/issues`)).toMatchObject({label: "Overview"})
    expect(getGitParentTarget(repoPath)).toMatchObject({label: "Repos"})
  })

  it("steps up code query breadcrumb paths", async () => {
    const {getGitParentPath} = await import("./routes")
    const codePath = "/git/naddr1repo/code"

    expect(getGitParentPath(codePath, "path=src/app/routes.ts")).toBe(`${codePath}?dir=src%2Fapp`)
    expect(getGitParentPath(codePath, "dir=src/app")).toBe(`${codePath}?dir=src`)
    expect(getGitParentPath(codePath, "dir=src")).toBe(codePath)
    expect(getGitParentPath(codePath)).toBe("/git/naddr1repo")
  })

  it("labels code query breadcrumb parent targets", async () => {
    const {getGitParentTarget} = await import("./routes")
    const codePath = "/git/naddr1repo/code"

    expect(getGitParentTarget(codePath, "path=src/app/routes.ts")).toMatchObject({
      label: "src/app",
    })
    expect(getGitParentTarget(codePath, "dir=src/app")).toMatchObject({label: "src"})
    expect(getGitParentTarget(codePath, "dir=src")).toMatchObject({label: "Code"})
    expect(getGitParentTarget(codePath)).toMatchObject({label: "Overview"})
  })

  it("keeps existing npub and nprofile route identifiers unchanged", async () => {
    const {makeProfilePath} = await import("./routes")
    const profilePubkey = "c".repeat(64)
    const profileNpub = nip19.npubEncode(profilePubkey)
    const profileNprofile = nip19.nprofileEncode({
      pubkey: profilePubkey,
      relays: ["wss://profile-relay.example.com"],
    })

    expect(makeProfilePath(profileNpub, ["wss://ignored.example.com"])).toBe(
      `/people/${profileNpub}`,
    )
    expect(makeProfilePath(profileNprofile, ["wss://ignored.example.com"])).toBe(
      `/people/${profileNprofile}`,
    )
  })

  it("parses encoded ncommunity route params", async () => {
    const {makeCommunityPath, parseCommunityRouteParam} = await import("./routes")
    const communityPubkey = "b".repeat(64)
    const value = `ncommunity://${communityPubkey}?relay=${encodeURIComponent(
      "wss://relay.example.com",
    )}`
    const normalizedValue = `ncommunity://${communityPubkey}?relay=${encodeURIComponent(
      "wss://relay.example.com/",
    )}`

    expect(makeCommunityPath(value)).toBe(`/c/${encodeURIComponent(normalizedValue)}`)
    expect(parseCommunityRouteParam(encodeURIComponent(value))).toEqual({
      pubkey: communityPubkey,
      relays: ["wss://relay.example.com/"],
      source: "ncommunity",
    })
  })

  it("routes community thread roots locally", async () => {
    const {getCommunityEventPath, getEventPath} = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const communityNpub = nip19.npubEncode(communityPubkey)
    const event = makeEvent({id: "thread-root", kind: 11, tags: [["h", communityPubkey]]})

    expect(getCommunityEventPath(event as any)).toBe(`/c/${communityNpub}/threads/thread-root`)
    expect(await getEventPath(event as any, [])).toBe(`/c/${communityNpub}/threads/thread-root`)
  })

  it("routes community room roots locally", async () => {
    const {getCommunityEventPath} = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const communityNpub = nip19.npubEncode(communityPubkey)
    const event = makeEvent({
      id: "room-root",
      kind: 11,
      tags: [["h", communityPubkey], ["room"], ["title", "General"]],
    })

    expect(getCommunityEventPath(event as any)).toBe(`/c/${communityNpub}/rooms/room-root`)
  })

  it("routes community replies and room messages to their parent roots", async () => {
    const {getCommunityEventPath} = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const communityNpub = nip19.npubEncode(communityPubkey)

    expect(
      getCommunityEventPath(
        makeEvent({
          kind: 1111,
          tags: [
            ["h", communityPubkey],
            ["E", "thread-root"],
            ["K", "11"],
          ],
        }) as any,
      ),
    ).toBe(`/c/${communityNpub}/threads/thread-root`)
    expect(
      getCommunityEventPath(
        makeEvent({
          kind: 1111,
          tags: [
            ["h", communityPubkey],
            ["E", "calendar-root"],
            ["K", "31922"],
            ["A", `31922:${"2".repeat(64)}:calendar-d`],
          ],
        }) as any,
      ),
    ).toBe(`/c/${communityNpub}/calendar/calendar-d`)
    expect(
      getCommunityEventPath(
        makeEvent({
          kind: 9,
          tags: [
            ["h", communityPubkey],
            ["E", "room-root"],
          ],
        }) as any,
      ),
    ).toBe(`/c/${communityNpub}/rooms/room-root`)
  })

  it("uses a cached calendar root identifier for comment navigation", async () => {
    const {getCommunityEventPath} = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const communityNpub = nip19.npubEncode(communityPubkey)
    repositoryGetEvent.mockReturnValue(
      makeEvent({
        id: "calendar-root",
        kind: EVENT_TIME,
        tags: [["d", "calendar-identifier"]],
      }),
    )
    const comment = makeEvent({
      kind: 1111,
      tags: [
        ["h", communityPubkey],
        ["E", "calendar-root"],
        ["K", String(EVENT_TIME)],
      ],
    })

    expect(getCommunityEventPath(comment as any)).toBe(
      `/c/${communityNpub}/calendar/calendar-identifier`,
    )
  })

  it("routes community report targets to in-app context pages", async () => {
    const {getCommunityReportTargetPath} = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const communityNpub = nip19.npubEncode(communityPubkey)

    expect(
      getCommunityReportTargetPath(communityPubkey, {
        targetEventKind: 9,
        targetEventId: "message-id",
        targetRootId: "room-root",
      }),
    ).toBe(`/c/${communityNpub}/rooms/room-root`)
    expect(
      getCommunityReportTargetPath(communityPubkey, {
        targetEventKind: 1111,
        targetRootKind: 11,
        targetRootId: "thread-root",
      }),
    ).toBe(`/c/${communityNpub}/threads/thread-root`)
    expect(
      getCommunityReportTargetPath(communityPubkey, {
        targetEventKind: 31922,
        targetEventId: "calendar-id",
        targetIdentifier: "calendar-d",
      }),
    ).toBe(`/c/${communityNpub}/calendar/calendar-d`)
    expect(
      getCommunityReportTargetPath(communityPubkey, {
        targetEventKind: 9041,
        targetEventId: "goal-id",
      }),
    ).toBe(`/c/${communityNpub}/goals/goal-id`)
  })

  it("routes targetable community events to their section pages", async () => {
    const {getCommunityEventPath} = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const communityNpub = nip19.npubEncode(communityPubkey)

    expect(
      getCommunityEventPath(makeEvent({kind: EVENT_TIME, tags: [["h", communityPubkey]]}) as any),
    ).toBe(`/c/${communityNpub}/calendar`)
    expect(
      getCommunityEventPath(makeEvent({kind: 9041, tags: [["h", communityPubkey]]}) as any),
    ).toBe(`/c/${communityNpub}/goals/${"1".repeat(64)}`)
    expect(
      getCommunityEventPath(makeEvent({kind: 30033, tags: [["h", communityPubkey]]}) as any),
    ).toBe(`/c/${communityNpub}/widgets`)
  })

  it("routes targeted original events using cached targeting events", async () => {
    const {getCommunityEventPath} = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const communityNpub = nip19.npubEncode(communityPubkey)

    repositoryQuery.mockReturnValue([
      makeEvent({
        kind: 30222,
        tags: [
          ["d", "target-1"],
          ["k", String(EVENT_TIME)],
          ["p", communityPubkey],
        ],
      }),
    ] as any)

    expect(
      getCommunityEventPath(
        makeEvent({
          kind: EVENT_TIME,
          tags: [
            ["h", "target-1"],
            ["d", "calendar-1"],
          ],
        }) as any,
      ),
    ).toBe(`/c/${communityNpub}/calendar/calendar-1`)
  })

  it("loads targeting events before falling back to external links", async () => {
    const {getEventPath} = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const communityNpub = nip19.npubEncode(communityPubkey)
    const targeting = makeEvent({
      kind: 30222,
      tags: [
        ["d", "target-1"],
        ["k", "9041"],
        ["p", communityPubkey],
      ],
    })

    repositoryQuery
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([targeting] as any)

    await expect(
      getEventPath(makeEvent({kind: 9041, tags: [["h", "target-1"]]}) as any, [
        "wss://relay.example.com",
      ]),
    ).resolves.toBe(`/c/${communityNpub}/goals/${"1".repeat(64)}`)
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({relays: ["wss://relay.example.com/"], autoClose: true}),
    )
  })

  it("routes targeted publication events to their community sections", async () => {
    const {getCommunityEventPath} = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const communityNpub = nip19.npubEncode(communityPubkey)

    expect(
      getCommunityEventPath(
        makeEvent({
          kind: 30222,
          tags: [
            ["d", "target-1"],
            ["k", "30033"],
            ["p", communityPubkey],
          ],
        }) as any,
      ),
    ).toBe(`/c/${communityNpub}/widgets`)
  })

  it("updates the hash before scrolling a same-room quoted event", async () => {
    const {goToEvent} = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const event = makeEvent({
      kind: 9,
      tags: [
        ["h", communityPubkey],
        ["E", "room-root"],
      ],
    })
    window.history.replaceState(null, "", `/c/${nip19.npubEncode(communityPubkey)}/rooms/room-root`)
    waitAndScrollToEventMock.mockImplementationOnce(() => {
      expect(window.location.hash).toBe(`#event-${event.id}`)
      return Promise.resolve(true)
    })

    await expect(goToEvent(event as any)).resolves.toBe(true)

    expect(gotoMock).not.toHaveBeenCalled()
    expect(waitAndScrollToEventMock).toHaveBeenCalledWith(event.id, {behavior: "auto"})
    expect(window.location.hash).toBe(`#event-${event.id}`)
  })

  it("does not let a source-page marker suppress cross-route navigation", async () => {
    const {goToEvent} = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const event = makeEvent({
      kind: 9,
      tags: [
        ["h", communityPubkey],
        ["E", "room-root"],
      ],
    })
    await expect(goToEvent(event as any)).resolves.toBe(true)

    expect(gotoMock).toHaveBeenCalledOnce()
    expect(gotoMock).toHaveBeenCalledWith(expect.stringMatching(/\/rooms\/room-root#event-/), {})
  })

  it("treats equivalent ncommunity and npub room paths as the same context", async () => {
    const {goToEvent} = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const communityInput = `ncommunity://${communityPubkey}?relay=${encodeURIComponent(
      "wss://relay.example.com",
    )}`
    const event = makeEvent({
      kind: 9,
      tags: [
        ["h", communityPubkey],
        ["E", "room-root"],
      ],
    })
    window.history.replaceState(
      null,
      "",
      `/c/${encodeURIComponent(communityInput)}/rooms/room-root`,
    )

    await expect(goToEvent(event as any)).resolves.toBe(true)

    expect(gotoMock).not.toHaveBeenCalled()
    expect(waitAndScrollToEventMock).toHaveBeenCalledWith(event.id, {behavior: "auto"})
    expect(window.location.hash).toBe(`#event-${event.id}`)
  })

  it("awaits cross-route navigation before waiting for the event target", async () => {
    const {goToEvent} = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const event = makeEvent({
      kind: 9,
      tags: [
        ["h", communityPubkey],
        ["E", "room-root"],
      ],
    })
    let resolveNavigation!: () => void
    gotoMock.mockReturnValueOnce(
      new Promise<void>(resolve => {
        resolveNavigation = resolve
      }),
    )

    const navigation = goToEvent(event as any)
    await vi.waitFor(() => expect(gotoMock).toHaveBeenCalledOnce())
    expect(waitAndScrollToEventMock).not.toHaveBeenCalled()

    resolveNavigation()
    await expect(navigation).resolves.toBe(true)
    expect(waitAndScrollToEventMock).toHaveBeenCalledWith(event.id, {behavior: "smooth"})
  })

  it("routes supported git events and comments to internal detail targets", async () => {
    const {getGitEventPath} = await import("./routes")
    const owner = "a".repeat(64)
    const repoAddress = `30617:${owner}:quoted-navigation`
    const issue = makeEvent({kind: 1621, tags: [["a", repoAddress]]})
    const pullRequest = makeEvent({kind: 1618, tags: [["a", repoAddress]]})
    const issueComment = makeEvent({
      kind: 1111,
      tags: [
        ["E", issue.id],
        ["K", "1621"],
        ["q", repoAddress],
      ],
    })
    const commitComment = makeEvent({
      kind: 1111,
      tags: [
        ["I", "git:commit:abc123"],
        ["K", "commit"],
        ["q", repoAddress],
      ],
    })

    await expect(getGitEventPath(issue as any, [])).resolves.toMatch(/\/issues\/1{64}$/)
    await expect(getGitEventPath(pullRequest as any, [])).resolves.toMatch(/\/prs\/1{64}$/)
    await expect(getGitEventPath(issueComment as any, [])).resolves.toMatch(
      /\/issues\/1{64}#comment-1{64}$/,
    )
    await expect(getGitEventPath(commitComment as any, [])).resolves.toMatch(
      /\/commits\/abc123#comment-1{64}$/,
    )
  })

  it("resolves git updates and statuses through their root events", async () => {
    const {getGitEventPath} = await import("./routes")
    const owner = "a".repeat(64)
    const repoAddress = `30617:${owner}:quoted-navigation`
    const root = makeEvent({id: "root-id", kind: 1618, tags: [["a", repoAddress]]})
    repositoryGetEvent.mockReturnValue(root)
    const update = makeEvent({
      kind: 1619,
      tags: [
        ["E", root.id],
        ["a", repoAddress],
      ],
    })
    const status = makeEvent({
      kind: 1632,
      tags: [
        ["e", root.id, "", "root"],
        ["a", repoAddress],
      ],
    })
    const coverLetter = makeEvent({
      kind: 1624,
      tags: [
        ["e", root.id],
        ["a", repoAddress],
      ],
    })

    await expect(getGitEventPath(update as any, [])).resolves.toMatch(/\/prs\/root-id$/)
    await expect(getGitEventPath(status as any, [])).resolves.toMatch(/\/prs\/root-id$/)
    await expect(getGitEventPath(coverLetter as any, [])).resolves.toMatch(/\/prs\/root-id$/)
  })

  it("loads legacy git comment and label roots to recover their repository routes", async () => {
    const {getGitEventPath} = await import("./routes")
    const owner = "a".repeat(64)
    const repoAddress = `30617:${owner}:quoted-navigation`
    const root = makeEvent({id: "root-id", kind: 1621, tags: [["a", repoAddress]]})
    repositoryGetEvent.mockReturnValue(root)
    const legacyComment = makeEvent({
      kind: 1111,
      tags: [
        ["E", root.id],
        ["K", "1621"],
      ],
    })
    const label = makeEvent({
      kind: 1985,
      tags: [["e", root.id]],
    })

    await expect(getGitEventPath(legacyComment as any, [])).resolves.toMatch(
      /\/issues\/root-id#comment-1{64}$/,
    )
    await expect(getGitEventPath(label as any, [])).resolves.toMatch(/\/issues\/root-id$/)

    const pullRequestRoot = makeEvent({
      id: "pr-root-id",
      kind: 1618,
      tags: [["a", repoAddress]],
    })
    repositoryGetEvent.mockReturnValue(pullRequestRoot)
    const staleImportedPrComment = makeEvent({
      kind: 1111,
      tags: [
        ["E", pullRequestRoot.id],
        ["K", "1621"],
      ],
    })

    await expect(getGitEventPath(staleImportedPrComment as any, [])).resolves.toMatch(
      /\/prs\/pr-root-id#comment-1{64}$/,
    )
  })

  it("focuses rendered git roots for metadata events and notification paths", async () => {
    const {goToEventIdPath, goToEventPath} = await import("./routes")
    const owner = "a".repeat(64)
    const rootId = "b".repeat(64)
    const repoNaddr = nip19.naddrEncode({
      kind: 30617,
      pubkey: owner,
      identifier: "quoted-navigation",
    })
    const path = `/git/${repoNaddr}/issues/${rootId}`
    const status = makeEvent({
      kind: 1632,
      tags: [["e", rootId, "", "root"]],
    })

    await expect(goToEventPath(status as any, path)).resolves.toBe(true)
    expect(gotoMock).toHaveBeenCalledWith(`${path}#event-${rootId}`, {})
    expect(waitAndScrollToEventMock).toHaveBeenCalledWith(rootId, {behavior: "smooth"})

    gotoMock.mockClear()
    waitAndScrollToEventMock.mockClear()

    await expect(goToEventIdPath(status.id, path)).resolves.toBe(true)
    expect(gotoMock).toHaveBeenCalledWith(`${path}#event-${rootId}`, {})
    expect(waitAndScrollToEventMock).toHaveBeenCalledWith(rootId, {behavior: "smooth"})
  })

  it("routes git permalinks to their exact code targets", async () => {
    const {getGitEventPath} = await import("./routes")
    const owner = "a".repeat(64)
    const repoAddress = `30617:${owner}:quoted-navigation`
    const permalink = makeEvent({
      kind: 1623,
      tags: [
        ["a", repoAddress],
        ["file", "src/app.ts"],
        ["lines", "12", "15"],
      ],
    })

    await expect(getGitEventPath(permalink as any, [])).resolves.toMatch(
      /\/code\?path=src%2Fapp\.ts#L12-L15$/,
    )

    const dashRangePermalink = makeEvent({
      kind: 1623,
      tags: [
        ["a", repoAddress],
        ["file", "src/app.ts"],
        ["line", "20-24"],
      ],
    })

    await expect(getGitEventPath(dashRangePermalink as any, [])).resolves.toMatch(
      /\/code\?path=src%2Fapp\.ts#L20-L24$/,
    )
  })

  it("does not classify community goal comments as git comments", async () => {
    const {getEventPath, getGitEventPath} = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const communityNpub = nip19.npubEncode(communityPubkey)
    const comment = makeEvent({
      kind: 1111,
      tags: [
        ["h", communityPubkey],
        ["E", "goal-id"],
        ["K", "9041"],
      ],
    })

    await expect(getGitEventPath(comment as any, [])).resolves.toBeUndefined()
    await expect(getEventPath(comment as any, [])).resolves.toBe(
      `/c/${communityNpub}/goals/goal-id`,
    )
  })

  it("keeps non-community events on external entity links", async () => {
    const {getCommunityEventPath, getEventPath} = await import("./routes")
    const event = makeEvent()
    const path = await getEventPath(event as any, ["wss://relay.example.com"])

    expect(getCommunityEventPath(event as any)).toBeUndefined()
    expect(
      getCommunityEventPath(makeEvent({kind: 11, tags: [["h", "topic"]]}) as any),
    ).toBeUndefined()
    expect(path.startsWith("https://coracle.social/nevent1")).toBe(true)
  })

  it("routes self-DMs to the signed-in user's chat", async () => {
    const {pubkey} = await import("@welshman/app")
    const {getEventPath} = await import("./routes")
    const selfPubkey = "a".repeat(64)
    vi.mocked(pubkey.get).mockReturnValue(selfPubkey)
    const selfDm = makeEvent({
      kind: 4,
      pubkey: selfPubkey,
      tags: [["p", selfPubkey]],
    })

    await expect(getEventPath(selfDm as any, [])).resolves.toBe(`/chat/${selfPubkey}`)
  })

  it("opens unsupported event destinations externally without navigating", async () => {
    const {goToEvent} = await import("./routes")
    const open = vi.spyOn(window, "open").mockImplementation(() => null)

    await expect(goToEvent(makeEvent() as any)).resolves.toBe(false)

    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/coracle\.social\/nevent1/),
      "_blank",
      "noopener,noreferrer",
    )
    expect(gotoMock).not.toHaveBeenCalled()
    open.mockRestore()
  })
})
