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

test("keeps a missing issue loading while repository activity can still deliver it", async ({
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
  await expect(page.getByText("Loading issue...", {exact: true})).toBeVisible()
  await expect(page.getByText("No issue found.", {exact: true})).toHaveCount(0)

  await mockRelay.injectEvents([issue])

  await expect(
    page.getByRole("heading", {name: "Issue delivered after initial EOSE", exact: true}),
  ).toBeVisible({timeout: 10_000})
  await expect(page.getByText("No issue found.", {exact: true})).toHaveCount(0)
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
  await expect(page.getByText("Loading issue...", {exact: true})).toBeVisible()
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
