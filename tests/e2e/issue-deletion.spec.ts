import {expect, test} from "@playwright/test"
import {
  BASE_TIMESTAMP,
  TEST_PUBKEYS,
  createIssue,
  createRepoAnnouncement,
  encodeRepoNaddr,
  getRepoAddress,
  signTestEvent,
} from "./fixtures/events"
import {seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

test("commits an issue deletion locally only after a real relay acknowledgement", async ({page}) => {
  const relayUrl = "wss://issue-deletion.test"
  const identifier = "issue-deletion-fixture"
  const repoAddress = getRepoAddress(TEST_PUBKEYS.devUser, identifier)
  const title = "Issue deleted after relay acknowledgement"
  const announcement = signTestEvent(
    createRepoAnnouncement({
      identifier,
      name: "Issue deletion fixture",
      relays: [relayUrl],
      pubkey: TEST_PUBKEYS.devUser,
      created_at: BASE_TIMESTAMP,
    }),
  )
  const issue = signTestEvent(
    createIssue({
      repoAddress,
      subject: title,
      content: "The root remains local until its delete is acknowledged.",
      pubkey: TEST_PUBKEYS.devUser,
      created_at: BASE_TIMESTAMP + 1,
    }),
  )
  const mockRelay = new MockRelay({
    seedEvents: [announcement, issue],
    publishResponsesByRelay: {
      [`${relayUrl}/`]: {outcome: "accept", latency: 500, retain: true},
    },
  })

  await page.addInitScript(() => localStorage.clear())
  await seedDevSession(page)
  await mockRelay.setup(page)
  const naddr = encodeRepoNaddr(TEST_PUBKEYS.devUser, identifier, [relayUrl])
  await page.goto(`/git/${naddr}/issues/${issue.id}`)
  await expect(page.getByRole("heading", {name: title, exact: true})).toBeVisible()

  await page.getByRole("button", {name: "Open issue actions"}).click()
  await page.getByRole("button", {name: "Delete issue", exact: true}).click()
  await page
    .getByTestId("modal-root")
    .getByRole("button", {name: "Delete issue", exact: true})
    .click()
  const deletion = await mockRelay.waitForEvent(5)

  expect(deletion.tags.some(tag => tag[0] === "e" && tag[1] === issue.id)).toBe(true)
  await expect(page.getByRole("heading", {name: title, exact: true})).toBeVisible()

  await expect(
    page.getByTestId("modal-root").getByRole("button", {name: "Delete issue", exact: true}),
  ).toHaveCount(0, {timeout: 10_000})
  await page.getByRole("link", {name: "Issues", exact: true}).click()
  await expect(page.getByText(title, {exact: true})).toHaveCount(0)
})
