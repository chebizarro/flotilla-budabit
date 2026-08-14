import {expect, test} from "@playwright/test"

import {
  BASE_TIMESTAMP,
  TEST_COMMITS,
  TEST_PUBKEYS,
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

test("replaces an EOSE-backed empty PR list when late live activity arrives", async ({page}) => {
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
  const pullRequest = signTestEvent(
    createPullRequest({
      repoAddress,
      subject: "Cold-start pull request",
      content: "Delivered after the PR list initially rendered.",
      tipCommitOid: TEST_COMMITS.second,
      pubkey: TEST_PUBKEYS.bob,
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
  await page.goto(`/git/${naddr}/prs`)

  await expect.poll(() => activitySubscriptions).toBeGreaterThan(0)
  await expect(page.getByText(/Live announcement updates cover/)).toHaveCount(0)

  await mockRelay.injectEvents([pullRequest])

  await expect(page.getByText("Cold-start pull request", {exact: true})).toBeVisible({
    timeout: 10_000,
  })
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
      for (const filter of filters) {
        if (
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

  const loadMore = page.getByRole("button", {name: "Load more", exact: true})
  for (
    let index = 0;
    index < 6 && !rootRequests.some(request => request.until !== undefined);
    index += 1
  ) {
    await loadMore.click()
  }

  await expect.poll(() => rootRequests.some(request => request.until !== undefined)).toBe(true)
  expect(rootRequests.find(request => request.until !== undefined)?.until).toBe(BASE_TIMESTAMP + 1)
})

test("shows partial issue history and retries only current root work", async ({page}) => {
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
      for (const filter of filters) {
        if (
          filter["#a"]?.includes(repoAddress) &&
          filter.kinds?.includes(1621) &&
          filter.kinds?.includes(1618)
        ) {
          if (filter.limit === 100) rootRequests += 1
          if (filter.limit === 0) stableSubscriptions += 1
        }
      }
    },
  })

  await page.addInitScript(() => localStorage.clear())
  await mockRelay.setup(page)
  const naddr = encodeRepoNaddr(TEST_PUBKEYS.alice, identifier, [discoveryRelay])
  await page.goto(`/git/${naddr}/issues`)

  await expect(
    page.getByText("Some relays did not respond. Showing loaded activity.", {
      exact: true,
    }),
  ).toBeVisible({timeout: 15_000})
  await expect(page.getByText(/No issues exist/)).toHaveCount(0)
  expect(rootRequests).toBe(1)

  await page.getByRole("button", {name: "Show"}).click()
  const relayFailure = page.getByText(`${activityRelay}/`, {exact: true})
  await expect(relayFailure).toBeVisible()
  expect(
    await relayFailure.evaluate(element => {
      const rect = element.getBoundingClientRect()
      const topmost = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      )
      return element === topmost || element.contains(topmost)
    }),
  ).toBe(true)
  await page.getByRole("button", {name: "Retry failed"}).click()
  await expect.poll(() => rootRequests).toBeGreaterThan(1)
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
