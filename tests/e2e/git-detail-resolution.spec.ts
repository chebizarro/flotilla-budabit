import {expect, test} from "@playwright/test"

import {
  BASE_TIMESTAMP,
  TEST_COMMITS,
  TEST_PUBKEYS,
  createIssue,
  createPullRequest,
  createPullRequestUpdate,
  createRepoAnnouncement,
  encodeRepoNaddr,
  getRepoAddress,
  signTestEvent,
} from "./fixtures/events"
import {MockRelay} from "./helpers/mock-relay"

const relayUrl = "wss://git-detail-resolution.test"
const identifier = "detail-resolution-fixture"
const repoAddress = getRepoAddress(TEST_PUBKEYS.alice, identifier)

test("replaces EOSE-backed issue absence when repository live activity delivers it", async ({
  page,
}) => {
  const announcement = signTestEvent(
    createRepoAnnouncement({
      identifier,
      name: "Detail resolution fixture",
      relays: [relayUrl],
      pubkey: TEST_PUBKEYS.alice,
      created_at: BASE_TIMESTAMP,
    }),
  )
  const issue = signTestEvent(
    createIssue({
      repoAddress,
      subject: "Issue delivered after initial EOSE",
      content: "The issue arrived through the repository activity subscription.",
      pubkey: TEST_PUBKEYS.charlie,
      created_at: BASE_TIMESTAMP + 1,
    }),
  )
  let exactIssueLookups = 0
  let repoActivitySubscriptions = 0
  const mockRelay = new MockRelay({
    seedEvents: [announcement],
    onSubscribe: (_subscriptionId, filters) => {
      if (filters.some(filter => filter.ids?.includes(issue.id))) exactIssueLookups += 1
      if (filters.some(filter => filter["#a"]?.includes(repoAddress))) {
        repoActivitySubscriptions += 1
      }
    },
  })

  await page.addInitScript(() => localStorage.clear())
  await mockRelay.setup(page)
  const naddr = encodeRepoNaddr(TEST_PUBKEYS.alice, identifier, [relayUrl])
  await page.goto(`/git/${naddr}/issues/${issue.id}`)

  await expect.poll(() => exactIssueLookups).toBeGreaterThan(0)
  await expect.poll(() => repoActivitySubscriptions).toBeGreaterThan(0)
  await expect(
    page.getByText("Issue not found in the current repository history.", {exact: true}),
  ).toBeVisible()

  await mockRelay.injectEvents([issue])

  await expect(
    page.getByRole("heading", {name: "Issue delivered after initial EOSE", exact: true}),
  ).toBeVisible({timeout: 10_000})
  await expect(page.getByText(/Issue not found/)).toHaveCount(0)
})

test("reports unavailable repository relays for issue and pull request details", async ({page}) => {
  const relaylessIdentifier = `${identifier}-relayless`
  const announcement = signTestEvent(
    createRepoAnnouncement({
      identifier: relaylessIdentifier,
      name: "Relayless detail fixture",
      pubkey: TEST_PUBKEYS.alice,
      created_at: BASE_TIMESTAMP,
    }),
  )
  const mockRelay = new MockRelay({seedEvents: [announcement]})
  const missingId = "ab".repeat(32)

  await page.addInitScript(() => localStorage.clear())
  await mockRelay.setup(page)
  const naddr = encodeRepoNaddr(TEST_PUBKEYS.alice, relaylessIdentifier, [relayUrl])

  await page.goto(`/git/${naddr}/issues/${missingId}`)
  await expect(page.getByText("Repository Relays Unavailable", {exact: true})).toBeVisible()
  await expect(page.getByText("No issue found.", {exact: true})).toHaveCount(0)

  await page.goto(`/git/${naddr}/prs/${missingId}`)
  await expect(page.getByText("Repository Relays Unavailable", {exact: true})).toBeVisible()
  await expect(page.getByText("Pull request not found.", {exact: true})).toHaveCount(0)
})

test("rejects a foreign exact issue before canonical projection", async ({page}) => {
  const announcement = signTestEvent(
    createRepoAnnouncement({
      identifier,
      name: "Detail resolution fixture",
      relays: [relayUrl],
      pubkey: TEST_PUBKEYS.alice,
      created_at: BASE_TIMESTAMP,
    }),
  )
  const foreignIssue = signTestEvent(
    createIssue({
      repoAddress: getRepoAddress(TEST_PUBKEYS.bob, "foreign-repo"),
      subject: "Foreign issue must not render",
      content: "This exact ID belongs to a different repository.",
      pubkey: TEST_PUBKEYS.charlie,
      created_at: BASE_TIMESTAMP + 1,
    }),
  )
  const mockRelay = new MockRelay({seedEvents: [announcement, foreignIssue]})

  await page.addInitScript(() => localStorage.clear())
  await mockRelay.setup(page)
  const naddr = encodeRepoNaddr(TEST_PUBKEYS.alice, identifier, [relayUrl])
  await page.goto(`/git/${naddr}/issues/${foreignIssue.id}`)

  await expect(page.getByRole("heading", {name: "Foreign issue must not render"})).toHaveCount(0)
  await expect(
    page.getByText("Issue not found in the current repository history.", {exact: true}),
  ).toBeVisible()
})

test("resolves a pull request update deep link through one repository activity owner", async ({
  page,
}) => {
  const announcement = signTestEvent(
    createRepoAnnouncement({
      identifier,
      name: "Detail resolution fixture",
      relays: [relayUrl],
      pubkey: TEST_PUBKEYS.alice,
      created_at: BASE_TIMESTAMP,
    }),
  )
  const pullRequest = signTestEvent(
    createPullRequest({
      repoAddress,
      subject: "Resolved from update deep link",
      content: "The root is resolved by layout-owned exact loading.",
      tipCommitOid: TEST_COMMITS.second,
      pubkey: TEST_PUBKEYS.charlie,
      created_at: BASE_TIMESTAMP + 1,
    }),
  )
  const update = signTestEvent(
    createPullRequestUpdate({
      repoAddress,
      prEventId: pullRequest.id,
      tipCommitOid: TEST_COMMITS.third,
      pubkey: TEST_PUBKEYS.charlie,
      created_at: BASE_TIMESTAMP + 2,
    }),
  )
  let stableActivitySubscriptions = 0
  const mockRelay = new MockRelay({
    seedEvents: [announcement, pullRequest, update],
    onSubscribe: (_subscriptionId, filters) => {
      if (
        filters.some(
          filter =>
            filter.limit === 0 &&
            filter["#a"]?.includes(repoAddress) &&
            filter.kinds?.includes(1621) &&
            filter.kinds?.includes(1618),
        )
      ) {
        stableActivitySubscriptions += 1
      }
    },
  })

  await page.addInitScript(() => localStorage.clear())
  await mockRelay.setup(page)
  const naddr = encodeRepoNaddr(TEST_PUBKEYS.alice, identifier, [relayUrl])
  await page.goto(`/git/${naddr}/prs/${update.id}`)

  await expect(
    page.getByRole("heading", {name: "Resolved from update deep link", exact: true}),
  ).toBeVisible({timeout: 10_000})
  await expect.poll(() => stableActivitySubscriptions).toBe(1)

  await page.getByRole("link", {name: /Issues/}).click()
  await page.getByRole("link", {name: /PRs/}).click()
  await page.getByRole("link", {name: "Overview", exact: true}).click()
  await expect.poll(() => stableActivitySubscriptions).toBe(1)
})

test("resolves a pull request update when live delivery follows exact EOSE", async ({page}) => {
  const announcement = signTestEvent(
    createRepoAnnouncement({
      identifier,
      name: "Detail resolution fixture",
      relays: [relayUrl],
      pubkey: TEST_PUBKEYS.alice,
      created_at: BASE_TIMESTAMP,
    }),
  )
  const pullRequest = signTestEvent(
    createPullRequest({
      repoAddress,
      subject: "Late update deep link",
      content: "Resolved after the update arrives live.",
      tipCommitOid: TEST_COMMITS.second,
      pubkey: TEST_PUBKEYS.charlie,
      created_at: BASE_TIMESTAMP + 1,
    }),
  )
  const update = signTestEvent(
    createPullRequestUpdate({
      repoAddress,
      prEventId: pullRequest.id,
      tipCommitOid: TEST_COMMITS.third,
      pubkey: TEST_PUBKEYS.charlie,
      created_at: BASE_TIMESTAMP + 2,
    }),
  )
  const mockRelay = new MockRelay({seedEvents: [announcement, pullRequest]})

  await page.addInitScript(() => localStorage.clear())
  await mockRelay.setup(page)
  const naddr = encodeRepoNaddr(TEST_PUBKEYS.alice, identifier, [relayUrl])
  await page.goto(`/git/${naddr}/prs/${update.id}`)
  await expect(
    page.getByText("Pull request not found in the current repository history.", {exact: true}),
  ).toBeVisible()

  await mockRelay.injectEvents([update])
  await expect(page.getByRole("heading", {name: "Late update deep link", exact: true})).toBeVisible(
    {
      timeout: 10_000,
    },
  )
})

test("keeps one stable lane through large root growth and clears it on teardown", async ({
  page,
}) => {
  const stressRelay = "wss://git-live-growth-stress.test"
  const stressIdentifier = "live-growth-stress-fixture"
  const stressAddress = getRepoAddress(TEST_PUBKEYS.alice, stressIdentifier)
  const announcement = signTestEvent(
    createRepoAnnouncement({
      identifier: stressIdentifier,
      name: "Live growth stress fixture",
      relays: [stressRelay],
      pubkey: TEST_PUBKEYS.alice,
      created_at: BASE_TIMESTAMP,
    }),
  )
  const issues = Array.from({length: 150}, (_, index) =>
    signTestEvent(
      createIssue({
        repoAddress: stressAddress,
        subject: `Stress issue ${index + 1}`,
        content: "Injected after stable live coverage started.",
        pubkey: TEST_PUBKEYS.charlie,
        created_at: BASE_TIMESTAMP + index + 1,
      }),
    ),
  )
  let stableActivitySubscriptions = 0
  const mockRelay = new MockRelay({
    seedEvents: [announcement],
    onSubscribe: (_subscriptionId, filters, relay) => {
      if (
        relay === `${stressRelay}/` &&
        filters.some(
          filter =>
            filter.limit === 0 &&
            filter["#a"]?.includes(stressAddress) &&
            filter.kinds?.includes(1621) &&
            filter.kinds?.includes(1618),
        )
      ) {
        stableActivitySubscriptions += 1
      }
    },
  })

  await page.addInitScript(() => localStorage.clear())
  await mockRelay.setup(page)
  const naddr = encodeRepoNaddr(TEST_PUBKEYS.alice, stressIdentifier, [stressRelay])
  await page.goto(`/git/${naddr}`)
  await expect.poll(() => stableActivitySubscriptions).toBe(1)

  await mockRelay.injectEvents(issues)
  await expect(page.getByRole("link", {name: /Issues \(150\)/})).toBeVisible({timeout: 10_000})
  expect(stableActivitySubscriptions).toBe(1)

  await page.goto("/home")
  await expect
    .poll(() =>
      page.evaluate(relay => {
        const connections = (
          window as unknown as {
            __mockRelayConnections?: Map<
              string,
              {url: string; subscriptions: Map<string, Array<Record<string, unknown>>>}
            >
          }
        ).__mockRelayConnections
        return Array.from(connections?.values() || []).some(
          connection => connection.url === relay && connection.subscriptions.size > 0,
        )
      }, `${stressRelay}/`),
    )
    .toBe(false)
})
