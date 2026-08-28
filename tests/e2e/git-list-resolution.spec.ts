import {expect, test} from "@playwright/test"

import {
  BASE_TIMESTAMP,
  TEST_COMMITS,
  TEST_PUBKEYS,
  createAppliedStatus,
  createClosedStatus,
  createIssue,
  createPullRequest,
  createRepoAnnouncement,
  encodeRepoNaddr,
  getRepoAddress,
  signTestEvent,
} from "./fixtures/events"
import {MockRelay} from "./helpers/mock-relay"

test("replaces an EOSE-backed empty issue list when late live activity arrives", async ({page}) => {
  const relayUrl = "wss://git-issue-list-resolution.test"
  const identifier = "issue-list-resolution-fixture"
  const repoAddress = getRepoAddress(TEST_PUBKEYS.alice, identifier)
  const announcement = signTestEvent(
    createRepoAnnouncement({
      identifier,
      name: "Issue list resolution fixture",
      relays: [relayUrl],
      pubkey: TEST_PUBKEYS.alice,
      created_at: BASE_TIMESTAMP,
    }),
  )
  const issue = signTestEvent(
    createIssue({
      repoAddress,
      subject: "Cold-start issue",
      content: "Delivered after the issue list initially rendered.",
      pubkey: TEST_PUBKEYS.charlie,
      created_at: BASE_TIMESTAMP + 1,
    }),
  )
  let activitySubscriptions = 0
  const mockRelay = new MockRelay({
    seedEvents: [announcement],
    onSubscribe: (_subscriptionId, filters) => {
      if (filters.some(filter => filter["#a"]?.includes(repoAddress))) {
        activitySubscriptions += 1
      }
    },
  })

  await page.addInitScript(() => localStorage.clear())
  await mockRelay.setup(page)
  const naddr = encodeRepoNaddr(TEST_PUBKEYS.alice, identifier, [relayUrl])
  await page.goto(`/git/${naddr}/issues`)

  await expect.poll(() => activitySubscriptions).toBeGreaterThan(0)
  await expect(page.getByText(/Live announcement updates cover/)).toHaveCount(0)

  await mockRelay.injectEvents([issue])

  await expect(page.getByText("Cold-start issue", {exact: true})).toBeVisible({timeout: 10_000})
})

test("fills the first issue page reactively and stops loading after history times out", async ({
  page,
}) => {
  const discoveryRelay = "wss://git-issue-autofill-discovery.test"
  const activityRelay = "wss://git-issue-autofill-activity.test"
  const identifier = "issue-autofill-fixture"
  const repoAddress = getRepoAddress(TEST_PUBKEYS.alice, identifier)
  const announcement = signTestEvent(
    createRepoAnnouncement({
      identifier,
      name: "Issue autofill fixture",
      relays: [activityRelay],
      pubkey: TEST_PUBKEYS.alice,
      created_at: BASE_TIMESTAMP,
    }),
  )
  const issues = Array.from({length: 24}, (_, index) =>
    signTestEvent(
      createIssue({
        repoAddress,
        subject: `Autofill issue ${index + 1}`,
        content: "Cold-start issue pagination fixture.",
        pubkey: TEST_PUBKEYS.charlie,
        created_at: BASE_TIMESTAMP + index + 1,
      }),
    ),
  )
  let activitySubscriptions = 0
  const mockRelay = new MockRelay({
    seedEvents: [announcement],
    subscriptionOutcomesByRelay: {[`${activityRelay}/`]: "stall"},
    onSubscribe: (_subscriptionId, _filters, relay) => {
      if (relay === `${activityRelay}/`) activitySubscriptions += 1
    },
  })

  await page.addInitScript(() => localStorage.clear())
  await mockRelay.setup(page)
  const naddr = encodeRepoNaddr(TEST_PUBKEYS.alice, identifier, [discoveryRelay])
  await page.goto(`/git/${naddr}/issues`)

  await expect.poll(() => activitySubscriptions).toBeGreaterThan(0)
  await mockRelay.injectEvents(issues.slice(0, 3))

  await expect(page.locator("[data-issue-id]")).toHaveCount(3, {timeout: 10_000})
  await expect(page.getByText("Looking for more issues…", {exact: true})).toHaveCount(0)

  await mockRelay.injectEvents(issues.slice(3, 4))

  await expect(page.locator("[data-issue-id]")).toHaveCount(4, {timeout: 10_000})

  await mockRelay.injectEvents(issues.slice(4))

  await expect(page.locator("[data-issue-id]")).toHaveCount(20, {timeout: 10_000})
  await expect(page.getByText("Page 1", {exact: true})).toBeVisible()
  await expect(page.getByRole("button", {name: "Next", exact: true})).toBeVisible()
})

test("replaces an empty PR list and paginates late live activity", async ({page}) => {
  const relayUrl = "wss://git-pr-list-resolution.test"
  const identifier = "pr-list-resolution-fixture"
  const repoAddress = getRepoAddress(TEST_PUBKEYS.alice, identifier)
  const announcement = signTestEvent(
    createRepoAnnouncement({
      identifier,
      name: "PR list resolution fixture",
      relays: [relayUrl],
      pubkey: TEST_PUBKEYS.alice,
      created_at: BASE_TIMESTAMP,
    }),
  )
  const pullRequests = Array.from({length: 24}, (_, index) =>
    signTestEvent(
      createPullRequest({
        repoAddress,
        subject: `Cold-start pull request ${index + 1}`,
        content: "Delivered after the PR list initially rendered.",
        tipCommitOid: TEST_COMMITS.second,
        pubkey: TEST_PUBKEYS.bob,
        created_at: BASE_TIMESTAMP + index + 1,
      }),
    ),
  )
  let activitySubscriptions = 0
  const mockRelay = new MockRelay({
    seedEvents: [announcement],
    onSubscribe: (_subscriptionId, filters) => {
      if (filters.some(filter => filter["#a"]?.includes(repoAddress))) {
        activitySubscriptions += 1
      }
    },
  })

  await page.addInitScript(() => localStorage.clear())
  await mockRelay.setup(page)
  const naddr = encodeRepoNaddr(TEST_PUBKEYS.alice, identifier, [relayUrl])
  await page.goto(`/git/${naddr}/prs`)

  await expect.poll(() => activitySubscriptions).toBeGreaterThan(0)
  await expect(page.getByText(/Live announcement updates cover/)).toHaveCount(0)

  await mockRelay.injectEvents(pullRequests)

  await expect(page.locator("[data-pr-id]")).toHaveCount(20, {timeout: 10_000})
  await expect(page.getByText("Page 1", {exact: true})).toBeVisible()
  await page.getByRole("button", {name: "Next", exact: true}).click()
  await expect(page.locator("[data-pr-id]")).toHaveCount(4)
  await expect(page.getByText("Page 2", {exact: true})).toBeVisible()
})

test("loads issue and PR statuses after partial root history without detail navigation", async ({
  page,
}) => {
  const fastRelay = "wss://git-list-status-fast.test"
  const failedRelay = "wss://git-list-status-failed.test"
  const identifier = "list-status-partial-history-fixture"
  const repoAddress = getRepoAddress(TEST_PUBKEYS.alice, identifier)
  const announcement = signTestEvent(
    createRepoAnnouncement({
      identifier,
      name: "List status partial history fixture",
      relays: [fastRelay, failedRelay],
      pubkey: TEST_PUBKEYS.alice,
      created_at: BASE_TIMESTAMP,
    }),
  )
  const issue = signTestEvent(
    createIssue({
      repoAddress,
      subject: "Closed from the issue list",
      content: "The root-scoped status must load after partial root history.",
      pubkey: TEST_PUBKEYS.charlie,
      created_at: BASE_TIMESTAMP + 1,
    }),
  )
  const pullRequest = signTestEvent(
    createPullRequest({
      repoAddress,
      subject: "Merged from the PR list",
      content: "The root-scoped status must load without opening the PR.",
      tipCommitOid: TEST_COMMITS.second,
      pubkey: TEST_PUBKEYS.bob,
      created_at: BASE_TIMESTAMP + 2,
    }),
  )
  const closedStatus = signTestEvent(
    createClosedStatus(issue.id, {
      pubkey: TEST_PUBKEYS.alice,
      created_at: BASE_TIMESTAMP + 3,
    }),
  )
  const mergedStatus = signTestEvent(
    createAppliedStatus(pullRequest.id, {
      pubkey: TEST_PUBKEYS.alice,
      created_at: BASE_TIMESTAMP + 4,
    }),
  )
  let statusGapRequests = 0
  const mockRelay = new MockRelay({
    seedEvents: [announcement, issue, pullRequest, closedStatus, mergedStatus],
    subscriptionOutcomesByRelay: {[`${failedRelay}/`]: "disconnect"},
    onSubscribe: (_subscriptionId, filters, relay) => {
      if (
        relay === `${fastRelay}/` &&
        filters.some(
          filter =>
            filter["#e"]?.some(id => id === issue.id || id === pullRequest.id) &&
            filter.kinds?.some(kind => kind >= 1630 && kind <= 1633),
        )
      ) {
        statusGapRequests += 1
      }
    },
  })

  await page.addInitScript(() => localStorage.clear())
  await mockRelay.setup(page)
  const naddr = encodeRepoNaddr(TEST_PUBKEYS.alice, identifier, [fastRelay])
  await page.goto(`/git/${naddr}/issues`)
  await page.getByRole("button", {name: "All", exact: true}).click()

  const issueRow = page.locator(`[data-issue-id="${issue.id}"]`)
  await expect(issueRow).toBeVisible({timeout: 15_000})
  await expect(issueRow.getByLabel("Closed")).toBeVisible({timeout: 15_000})
  await expect.poll(() => statusGapRequests).toBeGreaterThan(0)

  await page.goto(`/git/${naddr}/prs`)
  await page.getByRole("button", {name: "All", exact: true}).click()

  const prRow = page.locator(`[data-pr-id="${pullRequest.id}"]`)
  await expect(prRow).toBeVisible({timeout: 15_000})
  await expect(prRow.getByLabel("Merged")).toBeVisible({timeout: 15_000})
})

test("loads a bounded recent issue page before requesting older relay history", async ({page}) => {
  const relayUrl = "wss://git-issue-pagination.test"
  const identifier = "issue-pagination-fixture"
  const repoAddress = getRepoAddress(TEST_PUBKEYS.alice, identifier)
  const announcement = signTestEvent(
    createRepoAnnouncement({
      identifier,
      name: "Issue pagination fixture",
      relays: [relayUrl],
      pubkey: TEST_PUBKEYS.alice,
      created_at: BASE_TIMESTAMP,
    }),
  )
  const issues = Array.from({length: 100}, (_, index) =>
    signTestEvent(
      createIssue({
        repoAddress,
        subject: `Paginated issue ${index + 1}`,
        content: "Bounded repository root history.",
        pubkey: TEST_PUBKEYS.charlie,
        created_at: BASE_TIMESTAMP + index + 1,
      }),
    ),
  )
  const rootRequests: Array<{limit?: number; until?: number}> = []
  const mockRelay = new MockRelay({
    seedEvents: [announcement, ...issues],
    onSubscribe: (_subscriptionId, filters) => {
      const isStableLive = filters.some(
        filter => Array.isArray(filter["#q"]) && (filter["#q"] as string[]).includes(repoAddress),
      )
      for (const filter of filters) {
        if (
          !isStableLive &&
          filter["#a"]?.includes(repoAddress) &&
          filter.kinds?.includes(1621) &&
          filter.kinds?.includes(1618) &&
          filter.limit === 100
        ) {
          rootRequests.push({limit: filter.limit, until: filter.until})
        }
      }
    },
  })

  await page.addInitScript(() => localStorage.clear())
  await mockRelay.setup(page)
  const naddr = encodeRepoNaddr(TEST_PUBKEYS.alice, identifier, [relayUrl])
  await page.goto(`/git/${naddr}/issues`)

  await expect.poll(() => rootRequests.length).toBeGreaterThan(0)
  expect(rootRequests[0]).toEqual({limit: 100, until: undefined})
  await expect(page.getByText("Paginated issue 100", {exact: true})).toBeVisible({timeout: 10_000})

  const nextPage = page.getByRole("button", {name: "Next", exact: true})
  for (let index = 0; index < 4; index += 1) {
    await nextPage.click()
  }
  await expect(page.locator("[data-issue-id]")).toHaveCount(20)
  await expect(page.getByText("Page 5", {exact: true})).toBeVisible()

  await expect.poll(() => rootRequests.some(request => request.until !== undefined)).toBe(true)
  expect(rootRequests.find(request => request.until !== undefined)?.until).toBe(BASE_TIMESTAMP + 1)
})

test("settles partial issue history without exposing relay diagnostics", async ({page}) => {
  const discoveryRelay = "wss://git-issue-partial-discovery.test"
  const activityRelay = "wss://git-issue-partial-activity.test"
  const identifier = "issue-partial-fixture"
  const repoAddress = getRepoAddress(TEST_PUBKEYS.alice, identifier)
  const announcement = signTestEvent(
    createRepoAnnouncement({
      identifier,
      name: "Issue partial fixture",
      relays: [activityRelay],
      pubkey: TEST_PUBKEYS.alice,
      created_at: BASE_TIMESTAMP,
    }),
  )
  let rootRequests = 0
  let stableSubscriptions = 0
  const mockRelay = new MockRelay({
    seedEvents: [announcement],
    subscriptionOutcomesByRelay: {[`${activityRelay}/`]: "stall"},
    onSubscribe: (_subscriptionId, filters, relay) => {
      if (relay !== `${activityRelay}/`) return
      const isStableLive = filters.some(
        filter => Array.isArray(filter["#q"]) && (filter["#q"] as string[]).includes(repoAddress),
      )
      for (const filter of filters) {
        if (
          filter["#a"]?.includes(repoAddress) &&
          filter.kinds?.includes(1621) &&
          filter.kinds?.includes(1618)
        ) {
          if (isStableLive) stableSubscriptions += 1
          else if (filter.limit === 100) rootRequests += 1
        }
      }
    },
  })

  await page.addInitScript(() => localStorage.clear())
  await mockRelay.setup(page)
  const naddr = encodeRepoNaddr(TEST_PUBKEYS.alice, identifier, [discoveryRelay])
  await page.goto(`/git/${naddr}/issues`)

  await expect(page.getByText("No issues loaded.", {exact: true})).toBeVisible({timeout: 15_000})
  await expect(page.getByText(/Some relays did not respond/)).toHaveCount(0)
  await expect(page.getByRole("button", {name: "Show"})).toHaveCount(0)
  await expect(page.getByRole("button", {name: "Retry failed"})).toHaveCount(0)
  expect(rootRequests).toBe(1)
  expect(stableSubscriptions).toBe(1)
})

test("settles an empty PR list while cached issue activity is still incomplete", async ({page}) => {
  const relayUrl = "wss://git-empty-pr-settlement.test"
  const identifier = "empty-pr-settlement-fixture"
  const repoAddress = getRepoAddress(TEST_PUBKEYS.alice, identifier)
  const announcement = signTestEvent(
    createRepoAnnouncement({
      identifier,
      name: "Empty PR settlement fixture",
      relays: [relayUrl],
      pubkey: TEST_PUBKEYS.alice,
      created_at: BASE_TIMESTAMP,
    }),
  )
  const issue = signTestEvent(
    createIssue({
      repoAddress,
      subject: "Issue with stalled activity",
      content: "Its activity refresh must not block the empty PR state.",
      pubkey: TEST_PUBKEYS.charlie,
      created_at: BASE_TIMESTAMP + 1,
    }),
  )
  const mockRelay = new MockRelay({
    seedEvents: [announcement, issue],
    getSubscriptionOutcome: filters =>
      filters.some(filter =>
        [filter["#e"], filter["#E"], filter["#q"]].some(
          values => Array.isArray(values) && (values as unknown[]).includes(issue.id),
        ),
      )
        ? "stall"
        : undefined,
  })

  await page.addInitScript(() => localStorage.clear())
  await mockRelay.setup(page)
  const naddr = encodeRepoNaddr(TEST_PUBKEYS.alice, identifier, [relayUrl])
  await page.goto(`/git/${naddr}/prs`)

  await expect(page.getByText("No pull requests yet.", {exact: true})).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByText(/Some relays did not respond/)).toHaveCount(0)
})
