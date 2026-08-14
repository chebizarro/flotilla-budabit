// @vitest-environment jsdom

import {readable} from "svelte/store"
import {nip19} from "nostr-tools"
import {describe, expect, it, vi} from "vitest"
import {DELETE, matchFilters, type Filter, type TrustedEvent} from "@welshman/util"
import type {RequestOptions} from "@welshman/net"
import {
  GIT_COMMENT,
  GIT_ISSUE,
  GIT_LABEL,
  GIT_PULL_REQUEST,
  GIT_REPO_ANNOUNCEMENT,
  GIT_STATUS_CLOSED,
} from "@nostr-git/core/events"
import {
  COMMUNITY_SECTION_REPO_CURATOR,
  PROFILE_LIST_KIND,
  type CommunityDefinition,
} from "@app/core/community"
import {
  COMMUNITY_REPORT_KIND,
  getEffectiveCommunityReportState,
  makeCommunityPersonReport,
  makeCommunityReportDelete,
  type EffectiveCommunityReportState,
} from "@app/core/community-reports"
import {defaultRepoWatchOptions, type RepoWatchOptions} from "@app/core/repo-watch"
import {ROLE_NS} from "@app/util/labels"

const storeMocks = vi.hoisted(() => {
  const makeStore = (initial: any) => {
    let value = initial
    const subscribers = new Set<(next: any) => void>()

    return {
      subscribe(run: (next: any) => void) {
        subscribers.add(run)
        run(value)
        return () => subscribers.delete(run)
      },
      set(next: any) {
        value = next
        for (const run of subscribers) run(value)
      },
    }
  }

  return {
    backgroundEnabled: makeStore(true),
    pubkey: makeStore(undefined),
    repoAnnouncements: makeStore([]),
    repoWatchNotificationSeen: makeStore({}),
    repoWatchValues: makeStore({version: 1, repos: {}, notificationSeen: {}}),
    request: vi.fn(),
    receiveRepositoryCacheEvent: vi.fn(),
    selectLatestCommunityDefinition: vi.fn(),
  }
})

vi.mock("@welshman/net", async importOriginal => ({
  ...(await importOriginal<typeof import("@welshman/net")>()),
  load: vi.fn(() => Promise.resolve([])),
  request: storeMocks.request,
}))

vi.mock("@welshman/app", async importOriginal => ({
  ...(await importOriginal<typeof import("@welshman/app")>()),
  pubkey: storeMocks.pubkey,
  tracker: {hasRelay: vi.fn(() => false), addRelay: vi.fn()},
  userRelayList: readable(undefined),
  makeUserData: vi.fn(() => readable(undefined)),
  makeUserLoader: vi.fn(() => vi.fn()),
  ensurePlaintext: vi.fn(async (event: TrustedEvent) => event.content),
  makeOutboxLoader: vi.fn(() => vi.fn()),
  publishThunk: vi.fn(),
  signer: {get: vi.fn()},
}))

vi.mock("@welshman/router", async importOriginal => ({
  ...(await importOriginal<typeof import("@welshman/router")>()),
  Router: {
    get: () => ({FromUser: () => ({getUrls: () => ["wss://repo-store.example/"]})}),
  },
}))

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()},
  db: {},
}))

vi.mock("@app/core/state", () => ({
  chatsById: readable(new Map()),
  userSettingsValues: readable({show_notifications_badge: false}),
  fromCsv: (value: string) => (value || "").split(",").filter(Boolean),
  deriveEvent: vi.fn(() => readable(undefined)),
}))

vi.mock("@app/core/git-state", () => ({
  GIT_RELAYS: ["wss://repo-store.example/"],
  repoAnnouncements: storeMocks.repoAnnouncements,
  getRepoMaintainers: (event: TrustedEvent) =>
    Array.from(
      new Set([
        event.pubkey,
        ...event.tags.filter(tag => tag[0] === "maintainers").flatMap(tag => tag.slice(1)),
      ]),
    ),
  getStatusRootId: (event: TrustedEvent) =>
    event.tags.find(tag => tag[0] === "e" && tag[3] === "root")?.[1] ||
    event.tags.find(tag => tag[0] === "e")?.[1] ||
    "",
}))

vi.mock("@app/core/community-state", () => ({
  activeCommunityDefinition: readable(undefined),
  activeCommunityModeratorRequestStates: readable([]),
  activeCommunityPermissionStatus: readable({
    communityPubkey: "",
    key: "",
    loading: false,
    loaded: false,
    complete: false,
    hasCachedEvents: false,
  }),
  activeCommunityProfileListEvents: readable([]),
  activeCommunityRelays: readable([]),
  activeCommunityReportState: readable(undefined),
  activeCommunityUserModeratorRequestStates: readable([]),
  activeUserCommunityRefs: readable([]),
  communityMemberReportStates: readable(new Map()),
  makeCommunityProfileListFilters: vi.fn((definition: CommunityDefinition) =>
    definition.sections.flatMap(section =>
      section.profileLists.map(ref => ({
        kinds: [ref.kind],
        authors: [ref.pubkey],
        "#d": [ref.identifier],
        limit: 1,
      })),
    ),
  ),
  makeCommunityReportFilters: vi.fn((definition: CommunityDefinition) => [
    {kinds: [COMMUNITY_REPORT_KIND], "#h": [definition.pubkey], limit: 500},
  ]),
  selectLatestCommunityDefinition: storeMocks.selectLatestCommunityDefinition,
}))

vi.mock("@app/core/repo-watch", async importOriginal => ({
  ...(await importOriginal<typeof import("@app/core/repo-watch")>()),
  repoWatchNotificationSeen: storeMocks.repoWatchNotificationSeen,
  userRepoWatchValues: storeMocks.repoWatchValues,
}))

vi.mock("@app/core/repo-cache", () => ({
  receiveRepositoryCacheEvent: storeMocks.receiveRepositoryCacheEvent,
}))

vi.mock("@app/util/notification-background", () => ({
  notificationBackgroundEnabled: storeMocks.backgroundEnabled,
}))

const owner = "a".repeat(64)
const maintainer = "b".repeat(64)
const communityMember = "c".repeat(64)
const outsider = "d".repeat(64)
const viewer = "e".repeat(64)
const communityPubkey = "f".repeat(64)
const listPubkey = "1".repeat(64)
const repoIdentifier = "watched-repo"
const repoAddress = `30617:${owner}:${repoIdentifier}`
const naddr = nip19.naddrEncode({kind: 30617, pubkey: owner, identifier: repoIdentifier})
const repoPath = `/git/${naddr}`

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: outsider,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const watchOptions = (overrides: Partial<RepoWatchOptions> = {}): RepoWatchOptions => ({
  issues: {...defaultRepoWatchOptions.issues, ...overrides.issues},
  prs: {...defaultRepoWatchOptions.prs, ...overrides.prs},
  status: {...defaultRepoWatchOptions.status, ...overrides.status},
  engagement: {...defaultRepoWatchOptions.engagement, ...overrides.engagement},
  assignments: overrides.assignments ?? defaultRepoWatchOptions.assignments,
  reviews: overrides.reviews ?? false,
  activityFilter: overrides.activityFilter ?? "all",
})

const makeRepo = (options = watchOptions()) => ({
  address: repoAddress,
  pubkey: owner,
  identifier: repoIdentifier,
  naddr,
  options,
  repoEvent: makeEvent({
    id: "accepted-repo-event",
    kind: GIT_REPO_ANNOUNCEMENT,
    pubkey: owner,
    tags: [
      ["d", repoIdentifier],
      ["maintainers", maintainer],
    ],
  }),
})

const communityDefinition: CommunityDefinition = {
  event: makeEvent({id: "community", kind: 10222, pubkey: communityPubkey}),
  pubkey: communityPubkey,
  relays: [],
  blossomServers: [],
  graspServers: [],
  mints: [],
  emailDigestServices: [],
  communityAlertServices: [],
  sections: [
    {
      name: COMMUNITY_SECTION_REPO_CURATOR,
      kinds: [{kind: GIT_REPO_ANNOUNCEMENT}],
      profileLists: [
        {
          kind: PROFILE_LIST_KIND,
          pubkey: listPubkey,
          identifier: COMMUNITY_SECTION_REPO_CURATOR,
          address: `${PROFILE_LIST_KIND}:${listPubkey}:${COMMUNITY_SECTION_REPO_CURATOR}`,
        },
      ],
      badges: [],
      retention: [],
    },
  ],
}

storeMocks.selectLatestCommunityDefinition.mockImplementation(
  (events: TrustedEvent[], pubkey: string) => {
    const event = events
      .filter(candidate => candidate.kind === 10222 && candidate.pubkey === pubkey)
      .toSorted((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0]

    return event ? {...communityDefinition, event} : undefined
  },
)

const makeCommunityProfileList = ({
  id = "profile-list",
  createdAt = 1,
  pubkeys = [communityMember],
}: {
  id?: string
  createdAt?: number
  pubkeys?: string[]
} = {}) =>
  makeEvent({
    id,
    created_at: createdAt,
    kind: PROFILE_LIST_KIND,
    pubkey: listPubkey,
    tags: [["d", COMMUNITY_SECTION_REPO_CURATOR], ...pubkeys.map(pubkey => ["p", pubkey])],
  })

const emptyCommunityReportState = (): EffectiveCommunityReportState => ({
  eventReports: [],
  personReports: [],
})

const makeCommunityPersonBanState = (pubkey: string, deleteEvents: TrustedEvent[] = []) => {
  const report = makeEvent({
    id: `ban-${pubkey}`,
    kind: COMMUNITY_REPORT_KIND,
    pubkey: communityPubkey,
    tags: makeCommunityPersonReport({communityPubkey, pubkey}).tags,
  })

  return getEffectiveCommunityReportState({
    definition: communityDefinition,
    reportEvents: [report],
    deleteEvents,
  })
}

const makeCommunityRepo = ({
  options = watchOptions({activityFilter: "community"}),
  profileListEvents = [makeCommunityProfileList()],
  reportState = emptyCommunityReportState(),
}: {
  options?: RepoWatchOptions
  profileListEvents?: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
} = {}) => ({
  ...makeRepo(options),
  repoEvent: makeEvent({
    id: "community-repo-event",
    kind: GIT_REPO_ANNOUNCEMENT,
    pubkey: owner,
    tags: [
      ["d", repoIdentifier],
      ["maintainers", maintainer],
      ["h", communityPubkey],
    ],
  }),
  communityDefinition,
  communityProfileListEvents: profileListEvents,
  communityReportState: reportState,
})

describe("repo watch notifications", () => {
  it("creates candidates for supplied notification repos", async () => {
    const {getRepoWatchNotificationCandidates} = await import("./repo-watch-notifications")
    const issue = makeEvent({
      id: "issue",
      kind: GIT_ISSUE,
      pubkey: outsider,
      tags: [["a", repoAddress]],
    })

    expect(
      getRepoWatchNotificationCandidates({
        repos: [],
        issues: [issue],
        currentPubkey: viewer,
      }),
    ).toEqual([])
    expect(
      getRepoWatchNotificationCandidates({
        repos: [makeRepo()],
        issues: [issue],
        currentPubkey: viewer,
      }),
    ).toEqual([{path: `${repoPath}/issues`, latestEvent: issue}])
  })

  it("carries only announcement-declared relays with real repository triggers", async () => {
    const {getRepoWatchNotificationCandidates} = await import("./repo-watch-notifications")
    const issue = makeEvent({
      id: "scoped-issue",
      kind: GIT_ISSUE,
      pubkey: outsider,
      tags: [["a", repoAddress]],
    })
    const repoEvent = makeEvent({
      id: "repo-event",
      kind: GIT_REPO_ANNOUNCEMENT,
      pubkey: owner,
      tags: [
        ["d", repoIdentifier],
        ["relays", "wss://REPO.example/", "wss://second.example"],
      ],
    })

    expect(
      getRepoWatchNotificationCandidates({
        repos: [{...makeRepo(), repoEvent}],
        issues: [issue],
        currentPubkey: viewer,
      }),
    ).toEqual([
      {
        path: `${repoPath}/issues`,
        latestEvent: issue,
        repoRelayHints: ["wss://repo.example/", "wss://second.example/"],
      },
    ])
  })

  it("adds owned and maintained repos as baseline notification repos", async () => {
    const {defaultOwnedRepoNotificationOptions, getRepoNotificationRepos} =
      await import("./repo-watch-notifications")
    const watchedOptions = watchOptions({
      issues: {...defaultRepoWatchOptions.issues, comments: false},
    })
    const watchedRepoEvent = makeEvent({
      id: "watched-repo-event",
      kind: GIT_REPO_ANNOUNCEMENT,
      pubkey: owner,
      tags: [["d", repoIdentifier]],
    })
    const ownedRepoEvent = makeEvent({
      id: "owned-repo-event",
      kind: GIT_REPO_ANNOUNCEMENT,
      pubkey: viewer,
      tags: [["d", "owned-repo"]],
    })
    const maintainedRepoEvent = makeEvent({
      id: "maintained-repo-event",
      kind: GIT_REPO_ANNOUNCEMENT,
      pubkey: owner,
      tags: [
        ["d", "maintained-repo"],
        ["maintainers", viewer],
      ],
    })

    const repos = getRepoNotificationRepos({
      watchedRepos: [makeRepo(watchedOptions)],
      repoEvents: [watchedRepoEvent, ownedRepoEvent, maintainedRepoEvent],
      currentPubkey: viewer,
    })
    const watched = repos.find(repo => repo.address === repoAddress)
    const owned = repos.find(
      repo => repo.address === `${GIT_REPO_ANNOUNCEMENT}:${viewer}:owned-repo`,
    )
    const maintained = repos.find(
      repo => repo.address === `${GIT_REPO_ANNOUNCEMENT}:${owner}:maintained-repo`,
    )

    expect(watched).toEqual(
      expect.objectContaining({
        address: repoAddress,
        options: watchedOptions,
        repoEvent: watchedRepoEvent,
      }),
    )
    expect(owned?.options).toEqual(defaultOwnedRepoNotificationOptions)
    expect(maintained?.options).toEqual(defaultOwnedRepoNotificationOptions)
    expect(defaultOwnedRepoNotificationOptions.issues.comments).toBe(true)
    expect(defaultOwnedRepoNotificationOptions.prs.comments).toBe(true)
  })

  it("respects issue, PR, status, and assignment watch options", async () => {
    const {getRepoWatchNotificationCandidates} = await import("./repo-watch-notifications")
    const issue = makeEvent({
      id: "issue",
      kind: GIT_ISSUE,
      created_at: 10,
      tags: [["a", repoAddress]],
    })
    const issueComment = makeEvent({
      id: "issue-comment",
      kind: 1111,
      created_at: 20,
      tags: [
        ["E", issue.id],
        ["K", String(GIT_ISSUE)],
      ],
    })
    const pullRequest = makeEvent({
      id: "pr",
      kind: GIT_PULL_REQUEST,
      created_at: 10,
      tags: [["a", repoAddress]],
    })
    const prStatus = makeEvent({
      id: "pr-closed",
      kind: GIT_STATUS_CLOSED,
      created_at: 30,
      tags: [
        ["a", repoAddress],
        ["e", pullRequest.id, "", "root"],
      ],
    })
    const assignment = makeEvent({
      id: "assignment",
      kind: GIT_LABEL,
      created_at: 40,
      pubkey: maintainer,
      tags: [
        ["L", ROLE_NS],
        ["l", "assignee", ROLE_NS],
        ["a", repoAddress],
        ["e", issue.id],
        ["p", viewer],
      ],
    })
    const reviewerLabel = makeEvent({
      id: "reviewer",
      kind: GIT_LABEL,
      created_at: 50,
      pubkey: maintainer,
      tags: [
        ["L", ROLE_NS],
        ["l", "reviewer", ROLE_NS],
        ["a", repoAddress],
        ["e", pullRequest.id],
        ["p", viewer],
      ],
    })
    const options = watchOptions({
      issues: {new: false, comments: true},
      prs: {new: false, comments: false, updates: false},
      status: {open: false, draft: false, applied: false, closed: true},
      assignments: true,
      reviews: false,
    })

    expect(
      getRepoWatchNotificationCandidates({
        repos: [makeRepo(options)],
        issues: [issue],
        pullRequests: [pullRequest],
        statuses: [prStatus],
        comments: [issueComment],
        labels: [assignment, reviewerLabel],
        currentPubkey: viewer,
      }),
    ).toEqual([
      {path: `${repoPath}/issues`, latestEvent: assignment},
      {path: `${repoPath}/prs`, latestEvent: prStatus},
    ])

    expect(
      getRepoWatchNotificationCandidates({
        repos: [makeRepo({...options, reviews: true})],
        issues: [issue],
        pullRequests: [pullRequest],
        statuses: [prStatus],
        comments: [issueComment],
        labels: [assignment, reviewerLabel],
        currentPubkey: viewer,
      }),
    ).toEqual([
      {path: `${repoPath}/issues`, latestEvent: assignment},
      {path: `${repoPath}/prs`, latestEvent: reviewerLabel},
    ])
  })

  it("accepts assignment notifications only from the root author or current maintainers", async () => {
    const {getRepoWatchNotificationCandidates} = await import("./repo-watch-notifications")
    const issue = makeEvent({
      id: "authority-issue",
      kind: GIT_ISSUE,
      pubkey: outsider,
      tags: [["a", repoAddress]],
    })
    const makeAssignment = (id: string, author: string) =>
      makeEvent({
        id,
        kind: GIT_LABEL,
        pubkey: author,
        tags: [
          ["L", ROLE_NS],
          ["l", "assignee", ROLE_NS],
          ["e", issue.id],
          ["p", viewer],
        ],
      })
    const options = watchOptions({
      issues: {...defaultRepoWatchOptions.issues, new: false},
      assignments: true,
      activityFilter: "all",
    })

    for (const assignment of [
      makeAssignment("root-author-assignment", outsider),
      makeAssignment("maintainer-assignment", maintainer),
    ]) {
      expect(
        getRepoWatchNotificationCandidates({
          repos: [makeRepo(options)],
          issues: [issue],
          labels: [assignment],
          currentPubkey: viewer,
        }),
      ).toEqual([{path: `${repoPath}/issues`, latestEvent: assignment}])
    }

    expect(
      getRepoWatchNotificationCandidates({
        repos: [makeRepo(options)],
        issues: [issue],
        labels: [makeAssignment("outsider-assignment", communityMember)],
        currentPubkey: viewer,
      }),
    ).toEqual([])
  })

  it("requires accepted repository authority for assignment notifications", async () => {
    const {getRepoWatchNotificationCandidates} = await import("./repo-watch-notifications")
    const issue = makeEvent({
      id: "missing-authority-issue",
      kind: GIT_ISSUE,
      pubkey: outsider,
      tags: [["a", repoAddress]],
    })
    const assignment = makeEvent({
      id: "missing-authority-assignment",
      kind: GIT_LABEL,
      pubkey: outsider,
      tags: [
        ["L", ROLE_NS],
        ["l", "assignee", ROLE_NS],
        ["e", issue.id],
        ["p", viewer],
      ],
    })
    const {repoEvent: _repoEvent, ...repoWithoutAuthority} = makeRepo(
      watchOptions({issues: {...defaultRepoWatchOptions.issues, new: false}, assignments: true}),
    )

    expect(
      getRepoWatchNotificationCandidates({
        repos: [repoWithoutAuthority],
        issues: [issue],
        labels: [assignment],
        currentPubkey: viewer,
      }),
    ).toEqual([])
  })

  it("fails closed for role events when the root event is absent", async () => {
    const {getRepoWatchNotificationCandidates, getRepoWatchRootIdsForEvents} =
      await import("./repo-watch-notifications")
    const issueComment = makeEvent({
      id: "old-issue-comment",
      kind: GIT_COMMENT,
      created_at: 20,
      tags: [
        ["a", repoAddress],
        ["E", "old-issue"],
        ["K", String(GIT_ISSUE)],
      ],
    })
    const prStatus = makeEvent({
      id: "old-pr-status",
      kind: GIT_STATUS_CLOSED,
      created_at: 30,
      tags: [
        ["a", repoAddress],
        ["e", "old-pr", "", "root"],
        ["K", String(GIT_PULL_REQUEST)],
      ],
    })
    const assignment = makeEvent({
      id: "old-issue-assignment",
      kind: GIT_LABEL,
      created_at: 40,
      pubkey: maintainer,
      tags: [
        ["L", ROLE_NS],
        ["l", "assignee", ROLE_NS],
        ["a", repoAddress],
        ["e", "old-issue"],
        ["K", String(GIT_ISSUE)],
        ["p", viewer],
      ],
    })
    const options = watchOptions({
      issues: {new: false, comments: true},
      prs: {new: false, comments: false, updates: false},
      status: {open: false, draft: false, applied: false, closed: true},
      assignments: true,
    })

    expect(getRepoWatchRootIdsForEvents([issueComment, prStatus, assignment])).toEqual([
      "old-issue",
      "old-pr",
    ])
    expect(
      getRepoWatchNotificationCandidates({
        repos: [makeRepo(options)],
        statuses: [prStatus],
        comments: [issueComment],
        labels: [assignment],
        currentPubkey: viewer,
      }),
    ).toEqual([
      {path: `${repoPath}/issues`, latestEvent: issueComment},
      {path: `${repoPath}/prs`, latestEvent: prStatus},
    ])
  })

  it("applies maintainer and community activity filters by author", async () => {
    const {getRepoWatchNotificationCandidates} = await import("./repo-watch-notifications")
    const maintainerIssue = makeEvent({
      id: "maintainer-issue",
      kind: GIT_ISSUE,
      pubkey: maintainer,
      tags: [["a", repoAddress]],
    })
    const communityIssue = makeEvent({
      id: "community-issue",
      kind: GIT_ISSUE,
      pubkey: communityMember,
      tags: [["a", repoAddress]],
    })
    const outsiderIssue = makeEvent({
      id: "outsider-issue",
      kind: GIT_ISSUE,
      pubkey: outsider,
      created_at: 100,
      tags: [["a", repoAddress]],
    })

    expect(
      getRepoWatchNotificationCandidates({
        repos: [makeCommunityRepo({options: watchOptions({activityFilter: "maintainers"})})],
        issues: [communityIssue, outsiderIssue, maintainerIssue],
        currentPubkey: viewer,
      }),
    ).toEqual([{path: `${repoPath}/issues`, latestEvent: maintainerIssue}])
    expect(
      getRepoWatchNotificationCandidates({
        repos: [makeCommunityRepo()],
        issues: [maintainerIssue, outsiderIssue, communityIssue],
        currentPubkey: viewer,
      }),
    ).toEqual([{path: `${repoPath}/issues`, latestEvent: communityIssue}])
  })

  it("rejects banned community authors and missing report state", async () => {
    const {getRepoWatchNotificationCandidates} = await import("./repo-watch-notifications")
    const issue = makeEvent({
      id: "banned-community-issue",
      kind: GIT_ISSUE,
      pubkey: communityMember,
      tags: [["a", repoAddress]],
    })
    const allowedRepo = makeCommunityRepo()
    const {communityReportState: _reportState, ...repoWithoutReportState} = allowedRepo

    expect(
      getRepoWatchNotificationCandidates({
        repos: [allowedRepo],
        issues: [issue],
        currentPubkey: viewer,
      }),
    ).toEqual([{path: `${repoPath}/issues`, latestEvent: issue}])
    expect(
      getRepoWatchNotificationCandidates({
        repos: [makeCommunityRepo({reportState: makeCommunityPersonBanState(communityMember)})],
        issues: [issue],
        currentPubkey: viewer,
      }),
    ).toEqual([])
    expect(
      getRepoWatchNotificationCandidates({
        repos: [repoWithoutReportState],
        issues: [issue],
        currentPubkey: viewer,
      }),
    ).toEqual([])
  })

  it("admits a community author again after the same author deletes their ban", async () => {
    const {getRepoWatchNotificationCandidates} = await import("./repo-watch-notifications")
    const issue = makeEvent({
      id: "deleted-ban-community-issue",
      kind: GIT_ISSUE,
      pubkey: communityMember,
      tags: [["a", repoAddress]],
    })
    const banId = `ban-${communityMember}`
    const deleteEvent = makeEvent({
      id: "delete-community-ban",
      kind: DELETE,
      pubkey: communityPubkey,
      tags: makeCommunityReportDelete({reportId: banId}).tags,
    })
    const wrongAuthorDelete = {...deleteEvent, id: "wrong-author-delete", pubkey: outsider}

    expect(
      getRepoWatchNotificationCandidates({
        repos: [
          makeCommunityRepo({
            reportState: makeCommunityPersonBanState(communityMember, [deleteEvent]),
          }),
        ],
        issues: [issue],
        currentPubkey: viewer,
      }),
    ).toEqual([{path: `${repoPath}/issues`, latestEvent: issue}])
    expect(
      getRepoWatchNotificationCandidates({
        repos: [
          makeCommunityRepo({
            reportState: makeCommunityPersonBanState(communityMember, [wrongAuthorDelete]),
          }),
        ],
        issues: [issue],
        currentPubkey: viewer,
      }),
    ).toEqual([])
  })

  it("rejects revoked community authors and admits them after regrant", async () => {
    const {getRepoWatchNotificationCandidates} = await import("./repo-watch-notifications")
    const issue = makeEvent({
      id: "community-grant-issue",
      kind: GIT_ISSUE,
      pubkey: communityMember,
      tags: [["a", repoAddress]],
    })
    const granted = makeCommunityProfileList({id: "grant", createdAt: 10})
    const revoked = makeCommunityProfileList({id: "revoke", createdAt: 20, pubkeys: []})
    const regranted = makeCommunityProfileList({id: "regrant", createdAt: 30})
    const getCandidates = (profileListEvents: TrustedEvent[]) =>
      getRepoWatchNotificationCandidates({
        repos: [makeCommunityRepo({profileListEvents})],
        issues: [issue],
        currentPubkey: viewer,
      })

    expect(getCandidates([granted])).toEqual([{path: `${repoPath}/issues`, latestEvent: issue}])
    expect(getCandidates([granted, revoked])).toEqual([])
    expect(getCandidates([granted, revoked, regranted])).toEqual([
      {path: `${repoPath}/issues`, latestEvent: issue},
    ])
  })

  it("rolls Git badges up from repo notification paths", async () => {
    const {hasGitNotification} = await import("./repo-watch-notifications")

    expect(hasGitNotification(new Set([`${repoPath}/issues`]))).toBe(true)
    expect(hasGitNotification(new Set(["/git"]))).toBe(false)
    expect(hasGitNotification(new Set(["/chat/example"]))).toBe(false)
  })

  it("partitions watcher activity by actual repo relay and foreground ownership", async () => {
    const {buildRepoWatchActivityRelayGroups} = await import("./repo-watch-notifications")
    const {getRepoLiveOwnershipKey} = await import("@app/core/repo-live-ownership")
    const secondAddress = `30617:${maintainer}:second-repo`
    const sharedRelay = "wss://shared.example/"
    const targets = [
      {
        address: repoAddress,
        relays: ["wss://first.example", sharedRelay],
        since: 10,
        limit: 200,
        authors: [communityMember],
      },
      {
        address: secondAddress,
        relays: ["wss://second.example", sharedRelay],
        since: 10,
        limit: 200,
        authors: [maintainer],
      },
    ]
    const groups = buildRepoWatchActivityRelayGroups(
      targets,
      new Set([getRepoLiveOwnershipKey(repoAddress, sharedRelay)]),
    )

    expect(groups.map(group => group.relay)).toEqual([
      "wss://first.example/",
      "wss://second.example/",
      sharedRelay,
    ])
    expect(groups[0].filters[0]["#a"]).toEqual([repoAddress])
    expect(groups[1].filters[0]["#a"]).toEqual([secondAddress])
    expect(groups[2].filters[0]["#a"]).toEqual([repoAddress, secondAddress])
    expect(groups[2].filters[0]).not.toHaveProperty("authors")
    expect(groups[2].localFilters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({"#a": [repoAddress], authors: [communityMember]}),
        expect.objectContaining({"#a": [secondAddress], authors: [maintainer]}),
      ]),
    )
    expect(groups[2].liveFilters[0]["#a"]).toEqual([secondAddress])
    expect(groups[2].liveFilters[0]).not.toHaveProperty("authors")

    const restored = buildRepoWatchActivityRelayGroups(targets)
    expect(restored[2].liveFilters[0]["#a"]).toEqual([repoAddress, secondAddress])
  })

  it("chunks root-scoped watcher filters into one bounded relay group", async () => {
    const {buildRepoWatchRootRelayGroups} = await import("./repo-watch-notifications")
    const rootIds = Array.from({length: 201}, (_, index) => `root-${index}`)
    const [group] = buildRepoWatchRootRelayGroups([
      {
        address: repoAddress,
        relays: ["wss://repo.example"],
        since: 10,
        limit: 200,
        rootIds,
        authors: [communityMember],
      },
    ])

    expect(group.relay).toBe("wss://repo.example/")
    expect(group.filters).toHaveLength(15)
    expect(
      group.filters.filter(filter => filter["#E"]).map(filter => filter["#E"]?.length),
    ).toEqual([100, 100, 1])
    expect(group.liveFilters.every(filter => !filter.authors)).toBe(true)
    expect(group.localFilters.filter(filter => !filter.ids).every(filter => filter.authors)).toBe(
      true,
    )
    expect(group.localFilters.filter(filter => filter.ids).every(filter => !filter.authors)).toBe(
      true,
    )
  })

  it("paginates broad outsider pages until older authorized activity is admitted", async () => {
    const {createBoundedRepoWatchHistoryLoader} = await import("./repo-watch-notifications")
    const relay = "wss://repo-history.example/"
    const outsiders = [
      makeEvent({
        id: "new-outsider-one",
        kind: GIT_ISSUE,
        pubkey: outsider,
        created_at: 30,
        tags: [["a", repoAddress]],
      }),
      makeEvent({
        id: "new-outsider-two",
        kind: GIT_ISSUE,
        pubkey: outsider,
        created_at: 29,
        tags: [["a", repoAddress]],
      }),
    ]
    const authorized = makeEvent({
      id: "older-authorized",
      kind: GIT_ISSUE,
      pubkey: communityMember,
      created_at: 20,
      tags: [["a", repoAddress]],
    })
    const requestHistory = vi.fn(async (options: RequestOptions) => {
      const page = options.filters[0].until === undefined ? outsiders : [authorized]
      for (const event of page) options.onEvent?.(event, relay)
      options.onEose?.(relay)
      return page
    })
    const admitted: TrustedEvent[] = []
    const loadHistory = createBoundedRepoWatchHistoryLoader({
      request: requestHistory,
      onEvent: event => admitted.push(event),
    })
    const relayFilters: Filter[] = [{kinds: [GIT_ISSUE], "#a": [repoAddress], since: 1, limit: 2}]

    const result = await loadHistory({
      relays: [relay],
      relayFilters,
      localFilters: relayFilters.map(filter => ({...filter, authors: [communityMember]})),
      pageSize: 2,
      maxPages: 3,
      timeoutMs: 1000,
    })

    expect(requestHistory).toHaveBeenCalledTimes(2)
    expect(requestHistory.mock.calls.every(([options]) => !options.filters[0].authors)).toBe(true)
    expect(admitted).toEqual([authorized])
    expect(result).toEqual({
      events: [authorized],
      complete: false,
      timedOut: false,
      saturated: true,
    })
  })

  it("retains incomplete semantics for a saturated outsider-only scan", async () => {
    const {
      aggregateRepoWatchHistoryStatus,
      buildRepoWatchScopedFilterGroups,
      createBoundedRepoWatchHistoryLoader,
      isRepoWatchCommunitySourceComplete,
      selectRepoWatchLoadRelays,
    } = await import("./repo-watch-notifications")
    const relay = "wss://saturated-repo-history.example/"
    const outsiderEvents = [
      makeEvent({
        id: "saturated-outsider-one",
        kind: GIT_ISSUE,
        pubkey: outsider,
        created_at: 30,
        tags: [["a", repoAddress]],
      }),
      makeEvent({
        id: "saturated-outsider-two",
        kind: GIT_ISSUE,
        pubkey: outsider,
        created_at: 29,
        tags: [["a", repoAddress]],
      }),
    ]
    const requestHistory = vi.fn(async (options: RequestOptions) => {
      for (const event of outsiderEvents) options.onEvent?.(event, relay)
      options.onEose?.(relay)
      return outsiderEvents
    })
    const onEvent = vi.fn()
    const loadHistory = createBoundedRepoWatchHistoryLoader({request: requestHistory, onEvent})

    await expect(
      loadHistory({
        relays: [relay],
        relayFilters: [{kinds: [GIT_ISSUE], "#a": [repoAddress], since: 1}],
        localFilters: [
          {kinds: [GIT_ISSUE], "#a": [repoAddress], authors: [communityMember], since: 1},
        ],
        pageSize: 2,
        maxPages: 1,
        timeoutMs: 1000,
      }),
    ).resolves.toEqual({events: [], complete: false, timedOut: false, saturated: true})
    expect(onEvent).not.toHaveBeenCalled()
    expect(
      aggregateRepoWatchHistoryStatus([
        {loading: false, complete: true, saturated: false},
        {loading: false, complete: false, saturated: true},
      ]),
    ).toEqual({loading: false, complete: false, saturated: true})
    const authorityRelays = Array.from({length: 7}, (_, index) => `wss://authority-${index}.test`)
    expect(selectRepoWatchLoadRelays(authorityRelays, false)).toHaveLength(7)
    expect(selectRepoWatchLoadRelays(authorityRelays, true)).toHaveLength(6)
    expect(
      buildRepoWatchScopedFilterGroups([
        {relays: ["wss://one.test"], filters: [{authors: ["1"]}]},
        {relays: ["wss://two.test"], filters: [{authors: ["2"]}]},
      ]).map(group => ({relay: group.relay, authors: group.filters[0].authors})),
    ).toEqual([
      {relay: "wss://one.test/", authors: ["1"]},
      {relay: "wss://two.test/", authors: ["2"]},
    ])
    expect(
      isRepoWatchCommunitySourceComplete(
        "one",
        [
          {communityPubkey: "one", relays: ["wss://one.test"], filters: [{authors: ["1"]}]},
          {communityPubkey: "two", relays: ["wss://two.test"], filters: [{authors: ["2"]}]},
        ],
        new Set(["one:wss://one.test/"]),
      ),
    ).toBe(true)
    expect(
      buildRepoWatchScopedFilterGroups([
        {communityPubkey: "one", relays: ["wss://shared.test"], filters: [{authors: ["1"]}]},
        {communityPubkey: "two", relays: ["wss://shared.test"], filters: [{authors: ["2"]}]},
      ]).map(group => group.scope),
    ).toEqual(["one", "two"])
    expect(
      buildRepoWatchScopedFilterGroups([
        {communityPubkey: "relayless", relays: [], filters: [{authors: ["3"]}]},
      ]),
    ).toEqual([
      {
        relay: "",
        scope: "relayless",
        filters: [{authors: ["3"]}],
        localFilters: [{authors: ["3"]}],
        liveFilters: [],
      },
    ])
  })

  it("hydrates non-member watched-community context including exact report deletes", async () => {
    const {repoWatchNotificationCandidates, watchedRepoCommunityContexts} =
      await import("./repo-watch-notifications")
    const relay = "wss://repo-store.example/"
    const originalAbortSignalAny = AbortSignal.any
    Object.defineProperty(AbortSignal, "any", {
      configurable: true,
      value: (signals: AbortSignal[]) => {
        const controller = new AbortController()
        const abort = () => controller.abort()
        for (const signal of signals) {
          if (signal.aborted) abort()
          else signal.addEventListener("abort", abort, {once: true})
        }
        return controller.signal
      },
    })
    const createdAt = Math.floor(Date.now() / 1000) - 10
    const repoEvent = makeEvent({
      id: "store-community-repo",
      kind: GIT_REPO_ANNOUNCEMENT,
      pubkey: owner,
      created_at: createdAt - 5,
      tags: [
        ["d", repoIdentifier],
        ["maintainers", maintainer],
        ["relays", relay],
        ["h", communityPubkey, relay],
      ],
    })
    const definitionEvent = makeEvent({
      id: "store-community-definition",
      kind: 10222,
      pubkey: communityPubkey,
      created_at: createdAt - 4,
    })
    const profileListEvent = makeCommunityProfileList({
      id: "store-community-grant",
      createdAt: createdAt - 3,
    })
    const reportEvent = makeEvent({
      id: "store-community-ban",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: communityPubkey,
      created_at: createdAt - 2,
      tags: makeCommunityPersonReport({communityPubkey, pubkey: communityMember}).tags,
    })
    const reportDeleteEvent = makeEvent({
      id: "store-community-ban-delete",
      kind: DELETE,
      pubkey: communityPubkey,
      created_at: createdAt - 1,
      tags: makeCommunityReportDelete({reportId: reportEvent.id}).tags,
    })
    const issue = makeEvent({
      id: "store-community-issue",
      kind: GIT_ISSUE,
      pubkey: communityMember,
      created_at: createdAt,
      tags: [["a", repoAddress]],
    })
    const availableEvents = [
      repoEvent,
      definitionEvent,
      profileListEvent,
      reportEvent,
      reportDeleteEvent,
      issue,
    ]

    storeMocks.request.mockReset()
    storeMocks.receiveRepositoryCacheEvent.mockClear()
    storeMocks.pubkey.set(viewer)
    storeMocks.repoAnnouncements.set([repoEvent])
    storeMocks.repoWatchNotificationSeen.set({})
    storeMocks.repoWatchValues.set({
      version: 1,
      repos: {[repoAddress]: watchOptions({activityFilter: "community"})},
      notificationSeen: {},
    })
    storeMocks.request.mockImplementation(async (options: RequestOptions) => {
      if (options.lifetime === "live") return []

      const events = availableEvents.filter(event => matchFilters(options.filters, event))
      for (const event of events) options.onEvent?.(event, relay)
      options.onEose?.(relay)
      return events
    })

    let contexts = new Map<string, any>()
    let candidates: any[] = []
    const unsubscribeContexts = watchedRepoCommunityContexts.subscribe(value => {
      contexts = value
    })
    const unsubscribeCandidates = repoWatchNotificationCandidates.subscribe(value => {
      candidates = value
    })

    await vi.waitFor(() => {
      expect(contexts.get(communityPubkey)).toMatchObject({ready: true})
      expect(candidates).toEqual([
        {
          path: `${repoPath}/issues`,
          latestEvent: issue,
          repoRelayHints: [relay],
        },
      ])
    })

    expect(contexts.get(communityPubkey)?.reportState.personReports).toEqual([])
    expect(
      storeMocks.request.mock.calls.some(call =>
        (call[0] as RequestOptions).filters.some(
          filter =>
            filter.kinds?.includes(DELETE) &&
            filter.authors?.[0] === communityPubkey &&
            filter["#e"]?.[0] === reportEvent.id,
        ),
      ),
    ).toBe(true)
    expect(
      storeMocks.receiveRepositoryCacheEvent.mock.calls.some(
        call => (call[0] as TrustedEvent).id === issue.id,
      ),
    ).toBe(true)

    unsubscribeCandidates()
    unsubscribeContexts()
    storeMocks.repoWatchValues.set({version: 1, repos: {}, notificationSeen: {}})
    storeMocks.repoAnnouncements.set([])
    storeMocks.pubkey.set(undefined)
    Object.defineProperty(AbortSignal, "any", {
      configurable: true,
      value: originalAbortSignalAny,
    })
  })
})
