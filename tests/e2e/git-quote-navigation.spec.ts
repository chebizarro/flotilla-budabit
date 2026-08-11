import {expect, test} from "@playwright/test"
import {nip19} from "nostr-tools"
import {
  BASE_TIMESTAMP,
  TEST_PUBKEYS,
  createIssue,
  createRepoAnnouncement,
  encodeRepoNaddr,
  getRepoAddress,
  signTestEvent,
} from "./fixtures/events"
import {MockRelay} from "./helpers/mock-relay"

const relayUrl = "wss://git-quote-navigation.example/"
const identifier = "quote-navigation"
const repoAddress = getRepoAddress(TEST_PUBKEYS.alice, identifier)
const announcement = signTestEvent(
  createRepoAnnouncement({
    identifier,
    name: "Quote navigation fixture",
    relays: [relayUrl],
    pubkey: TEST_PUBKEYS.alice,
    created_at: BASE_TIMESTAMP,
  }),
)
const issue = signTestEvent(
  createIssue({
    repoAddress,
    subject: "Quoted issue comments",
    content: "Issue body",
    pubkey: TEST_PUBKEYS.charlie,
    created_at: BASE_TIMESTAMP + 1,
  }),
)

const makeComment = (content: string, createdAt: number) =>
  signTestEvent({
    kind: 1111,
    created_at: createdAt,
    content,
    pubkey: TEST_PUBKEYS.bob,
    tags: [
      ["E", issue.id, relayUrl, issue.pubkey],
      ["K", "1621"],
      ["P", issue.pubkey, relayUrl],
      ["e", issue.id, relayUrl, issue.pubkey],
      ["k", "1621"],
      ["p", issue.pubkey, relayUrl],
      ["q", repoAddress, relayUrl],
    ],
  })

const parent = makeComment("Original issue comment for navigation", BASE_TIMESTAMP + 2)
const fillers = Array.from({length: 30}, (_, index) =>
  makeComment(`Issue filler comment ${index + 1}`, BASE_TIMESTAMP + index + 3),
)
const parentNevent = nip19.neventEncode({id: parent.id, relays: [relayUrl]})
const reply = makeComment(
  `nostr:${parentNevent}\n\nIssue reply containing the quoted parent`,
  BASE_TIMESTAMP + 30,
)
const naddr = encodeRepoNaddr(TEST_PUBKEYS.alice, identifier, [relayUrl])
const issuePath = `/git/${naddr}/issues/${issue.id}`

test("focuses a quoted issue comment without recreating the repository route", async ({page}) => {
  const mockRelay = new MockRelay({
    seedEvents: [announcement, issue, parent, ...fillers, reply],
  })
  await page.addInitScript(() => localStorage.clear())
  await mockRelay.setup(page)
  await page.goto(issuePath)
  await expect(page.getByRole("heading", {name: "Quoted issue comments", exact: true})).toBeVisible(
    {
      timeout: 10_000,
    },
  )

  const parentComment = page.locator(`[data-event="${parent.id}"]`).first()
  const replyComment = page.locator(`[data-event="${reply.id}"]`).first()
  await expect(parentComment).toBeVisible({timeout: 10_000})
  await expect(replyComment).toBeVisible({timeout: 10_000})
  await replyComment.evaluate(element => element.scrollIntoView({block: "start"}))
  await expect(parentComment).not.toBeInViewport()

  const quoteCard = replyComment.getByRole("link").filter({
    hasText: "Original issue comment for navigation",
  })
  await expect(quoteCard).toBeVisible({timeout: 10_000})
  await page.evaluate(() => {
    document.body.dataset.gitQuoteDocument = "original"
  })
  await quoteCard.click()

  await expect(page).toHaveURL(`${issuePath}#comment-${parent.id}`)
  await expect(parentComment).toBeInViewport({timeout: 10_000})
  await expect(page.locator("body")).toHaveAttribute("data-git-quote-document", "original")
})
