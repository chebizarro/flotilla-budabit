import {expect, test, type Page} from "@playwright/test"
import {finalizeEvent, nip19, type VerifiedEvent} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const relayUrl = "wss://community-reply-target-navigation.example/"
const communitySecret = Uint8Array.from(
  DEV_SECRET.match(/.{2}/g)?.map(byte => Number.parseInt(byte, 16)) || [],
)

const definition = finalizeEvent(
  {
    kind: 10222,
    created_at: 1,
    content: "",
    tags: [
      ["alt", "BudaBit community definition"],
      ["r", relayUrl],
      ["content", "Thread-creator"],
      ["k", "11", "threads"],
      ["content", "Calendar-event-creator"],
      ["k", "31922"],
      ["k", "31923"],
      ["content", "Fundraiser-goals-creator"],
      ["k", "9041"],
      ["content", "general"],
      ["k", "1111"],
      ["k", "7"],
      ["k", "1984"],
      ["k", "1985"],
    ],
  },
  communitySecret,
)

const thread = finalizeEvent(
  {
    kind: 11,
    created_at: 2,
    content: "Thread body",
    tags: [
      ["h", DEV_PUBKEY],
      ["title", "Quoted thread replies"],
    ],
  },
  communitySecret,
)

const calendar = finalizeEvent(
  {
    kind: 31922,
    created_at: 3,
    content: "Calendar body",
    tags: [
      ["h", DEV_PUBKEY],
      ["d", "quoted-calendar-replies"],
      ["title", "Quoted calendar replies"],
      ["start", "2099-01-01"],
    ],
  },
  communitySecret,
)

const goal = finalizeEvent(
  {
    kind: 9041,
    created_at: 4,
    content: "Quoted goal replies",
    tags: [
      ["h", DEV_PUBKEY],
      ["summary", "Goal body"],
      ["amount", "1000"],
      ["relays", relayUrl],
    ],
  },
  communitySecret,
)

const makeComment = ({
  root,
  content,
  createdAt,
  parent,
}: {
  root: VerifiedEvent
  content: string
  createdAt: number
  parent?: VerifiedEvent
}) =>
  finalizeEvent(
    {
      kind: 1111,
      created_at: createdAt,
      content,
      tags: [
        ["h", DEV_PUBKEY],
        ["E", root.id, relayUrl, root.pubkey],
        ["K", String(root.kind)],
        ["P", root.pubkey, relayUrl],
        ...(parent
          ? [
              ["e", parent.id, relayUrl, parent.pubkey],
              ["k", "1111"],
              ["p", parent.pubkey, relayUrl],
            ]
          : []),
      ],
    },
    communitySecret,
  )

const makeReplyChain = (root: VerifiedEvent, label: string, createdAt: number) => {
  const parent = makeComment({root, content: `Original ${label} parent`, createdAt})
  const fillers = Array.from({length: 5}, (_, index) =>
    makeComment({
      root,
      content: `${label} filler ${index + 1}`,
      createdAt: createdAt + index + 1,
    }),
  )
  const parentNevent = nip19.neventEncode({id: parent.id, relays: [relayUrl]})
  const reply = makeComment({
    root,
    content: `nostr:${parentNevent}\n\nLatest ${label} reply`,
    createdAt: createdAt + 10,
  })

  return {parent, fillers, reply}
}

const threadChain = makeReplyChain(thread, "thread", 10)
const calendarChain = makeReplyChain(calendar, "calendar", 30)
const goalChain = makeReplyChain(goal, "goal", 50)
const communityInput = `ncommunity://${DEV_PUBKEY}?relay=${encodeURIComponent(relayUrl)}`
const communityPath = `/c/${encodeURIComponent(communityInput)}`

const openTarget = async ({
  page,
  path,
  root,
  parent,
  reply,
  label,
}: {
  page: Page
  path: string
  root: VerifiedEvent
  parent: VerifiedEvent
  reply: VerifiedEvent
  label: string
}) => {
  await page.goto(path)
  await expect(page.locator(`[data-event="${root.id}"]`).first()).toBeVisible({timeout: 10_000})

  const replyItem = page.locator(`[data-event="${reply.id}"]`).first()
  const quoteButton = replyItem.locator("button.my-2").filter({
    hasText: `Original ${label} parent`,
  })
  await expect(replyItem).toBeVisible({timeout: 10_000})
  await expect(quoteButton).toBeVisible({timeout: 10_000})
  await expect(page.locator(`[data-event="${parent.id}"]`)).toHaveCount(0)

  await quoteButton.click()

  await expect(page).toHaveURL(`${path}#event-${parent.id}`)
  await expect(page.locator(`[data-event="${parent.id}"]`).first()).toBeInViewport({
    timeout: 10_000,
  })
}

test.beforeEach(async ({page}) => {
  const events = [
    definition,
    thread,
    calendar,
    goal,
    threadChain.parent,
    ...threadChain.fillers,
    threadChain.reply,
    calendarChain.parent,
    ...calendarChain.fillers,
    calendarChain.reply,
    goalChain.parent,
    ...goalChain.fillers,
    goalChain.reply,
  ]
  await seedDevSession(page)
  await new MockRelay({seedEvents: events}).setup(page)
})

test("reveals a hidden quoted thread parent", async ({page}) => {
  await openTarget({
    page,
    path: `${communityPath}/threads/${thread.id}`,
    root: thread,
    ...threadChain,
    label: "thread",
  })
})

test("reveals a hidden quoted calendar parent", async ({page}) => {
  await openTarget({
    page,
    path: `${communityPath}/calendar/quoted-calendar-replies`,
    root: calendar,
    ...calendarChain,
    label: "calendar",
  })
})

test("reveals a hidden quoted goal parent", async ({page}) => {
  await openTarget({
    page,
    path: `${communityPath}/goals/${goal.id}`,
    root: goal,
    ...goalChain,
    label: "goal",
  })
})
