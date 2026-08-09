import {expect, test} from "@playwright/test"
import {
  BASE_TIMESTAMP,
  TEST_COMMITS,
  TEST_PUBKEYS,
  createPullRequest,
  createRepoAnnouncement,
  encodeRepoNaddr,
  getRepoAddress,
  signTestEvent,
} from "./fixtures/events"
import {seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const relayUrl = "wss://pr-spam-hiding.test"
const identifier = "pr-spam-hiding-fixture"
const repoAddress = getRepoAddress(TEST_PUBKEYS.devUser, identifier)
const title = "Owner-hidden spam pull request"

const makeEvents = () => {
  const announcement = signTestEvent(
    createRepoAnnouncement({
      identifier,
      name: "PR spam hiding fixture",
      relays: [relayUrl],
      pubkey: TEST_PUBKEYS.devUser,
      created_at: BASE_TIMESTAMP,
    }),
  )
  const pullRequest = signTestEvent(
    createPullRequest({
      repoAddress,
      subject: title,
      content: "This pull request should be hidden only after an owner report is acknowledged.",
      tipCommitOid: TEST_COMMITS.second,
      pubkey: TEST_PUBKEYS.charlie,
      created_at: BASE_TIMESTAMP + 1,
    }),
  )

  return {announcement, pullRequest}
}

const openHideConfirmation = async (page: Parameters<typeof seedDevSession>[0]) => {
  await page.getByRole("button", {name: "Open pull request actions"}).click()
  await page.getByRole("button", {name: "Hide spam", exact: true}).click()
  await page
    .getByTestId("modal-root")
    .getByRole("button", {name: "Hide spam", exact: true})
    .click()
}

test("commits an owner spam report only after relay acknowledgement", async ({page}) => {
  const {announcement, pullRequest} = makeEvents()
  const mockRelay = new MockRelay({
    seedEvents: [announcement, pullRequest],
    publishResponsesByRelay: {
      [`${relayUrl}/`]: {outcome: "accept", latency: 500, retain: true},
    },
  })

  await page.addInitScript(() => localStorage.clear())
  await seedDevSession(page)
  await mockRelay.setup(page)
  const naddr = encodeRepoNaddr(TEST_PUBKEYS.devUser, identifier, [relayUrl])
  await page.goto(`/git/${naddr}/prs`)
  await page.getByText(title, {exact: true}).click()
  await expect(page.getByRole("heading", {name: title, exact: true})).toBeVisible()

  await openHideConfirmation(page)
  const report = await mockRelay.waitForEvent(1984)

  expect(report.tags).toContainEqual(["e", pullRequest.id, "spam"])
  await expect(page.getByRole("heading", {name: title, exact: true})).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/prs/${pullRequest.id}(?:#.*)?$`))

  await expect(page).toHaveURL(new RegExp(`/git/${naddr}/prs/?$`), {timeout: 10_000})
  await expect(page.getByText(title, {exact: true})).toHaveCount(0)
})

test("a rejected owner spam report remains local-free and retries the exact event", async ({page}) => {
  const {announcement, pullRequest} = makeEvents()
  const mockRelay = new MockRelay({
    seedEvents: [announcement, pullRequest],
    publishResponsesByRelay: {
      [`${relayUrl}/`]: {outcome: "reject", latency: 10, message: "blocked by test"},
    },
  })

  await page.addInitScript(() => localStorage.clear())
  await seedDevSession(page)
  await mockRelay.setup(page)
  const naddr = encodeRepoNaddr(TEST_PUBKEYS.devUser, identifier, [relayUrl])
  await page.goto(`/git/${naddr}/prs/${pullRequest.id}`)
  await expect(page.getByRole("heading", {name: title, exact: true})).toBeVisible()

  await openHideConfirmation(page)
  await expect(page.getByText(/No target relay acknowledged publication/)).toBeVisible()
  await expect(page.getByRole("heading", {name: title, exact: true})).toBeVisible()
  const firstReport = (await mockRelay.waitForEvents(event => event.kind === 1984, 1))[0]

  await page.getByTestId("modal-root").getByRole("button", {name: "Go back"}).click()
  await openHideConfirmation(page)
  await expect.poll(() => mockRelay.getPublishedEventsByKind(1984).length).toBe(2)
  const secondReport = mockRelay.getPublishedEventsByKind(1984)[1]

  expect(secondReport.id).toBe(firstReport.id)
  await expect(page.getByRole("heading", {name: title, exact: true})).toBeVisible()
})
