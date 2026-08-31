import {expect, test} from "@playwright/test"
import {nip19} from "nostr-tools"
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

const pullRequest = signTestEvent(
  createPullRequest({
    repoAddress,
    subject: "Quoted pull request comments",
    content: "Pull request body",
    tipCommitOid: TEST_COMMITS.second,
    pubkey: TEST_PUBKEYS.charlie,
    created_at: BASE_TIMESTAMP + 40,
  }),
)
const makePrComment = (content: string, createdAt: number) =>
  signTestEvent({
    kind: 1111,
    created_at: createdAt,
    content,
    pubkey: TEST_PUBKEYS.bob,
    tags: [
      ["E", pullRequest.id, relayUrl, pullRequest.pubkey],
      ["K", "1618"],
      ["P", pullRequest.pubkey, relayUrl],
      ["e", pullRequest.id, relayUrl, pullRequest.pubkey],
      ["k", "1618"],
      ["p", pullRequest.pubkey, relayUrl],
      ["q", repoAddress, relayUrl],
    ],
  })
const prTarget = makePrComment("Target pull request comment", BASE_TIMESTAMP + 41)
const latePrComment = makePrComment("Late pull request comment", BASE_TIMESTAMP + 42)
const prPath = `/git/${naddr}/prs/${pullRequest.id}`

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
  await expect
    .poll(() =>
      page.evaluate(id => {
        const target = document.querySelector(`[data-event="${id}"]`)
        const scroller = document.querySelector('[data-component="PageContent"]')
        const pageBar = document.querySelector('[data-component="PageBar"]')
        if (!target || !scroller || !pageBar) return Number.POSITIVE_INFINITY

        const targetRect = target.getBoundingClientRect()
        const scrollerRect = scroller.getBoundingClientRect()
        const pageBarRect = pageBar.getBoundingClientRect()

        return Math.abs(targetRect.top - Math.max(scrollerRect.top, pageBarRect.bottom))
      }, parent.id),
    )
    .toBeLessThan(24)
  await expect(page.locator("body")).toHaveAttribute("data-git-quote-document", "original")
})

test("does not re-scroll a pull request target when later comments arrive", async ({page}) => {
  const mockRelay = new MockRelay({seedEvents: [announcement, pullRequest, prTarget]})
  await page.addInitScript(() => localStorage.clear())
  await mockRelay.setup(page)
  await page.goto(`${prPath}#comment-${prTarget.id}`)

  const target = page.locator(`[data-event="${prTarget.id}"]`).first()
  const scroller = page.locator('[data-component="PageContent"]')
  await expect(target).toBeInViewport({timeout: 15_000})

  await scroller.evaluate(element => element.scrollTo({top: 0, behavior: "auto"}))
  await expect(target).not.toBeInViewport()
  await mockRelay.injectEvents([latePrComment])
  await expect(page.locator(`[data-event="${latePrComment.id}"]`).first()).toHaveCount(1)
  await page.waitForTimeout(250)

  await expect(target).not.toBeInViewport()
})
