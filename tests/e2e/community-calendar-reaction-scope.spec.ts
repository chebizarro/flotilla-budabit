import {expect, test} from "@playwright/test"
import {finalizeEvent} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const communityRelay = "wss://calendar-community.example/"
const personalOutboxRelay = "wss://calendar-outbox.example/"
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
      ["r", communityRelay],
      ["content", "calendar"],
      ["k", "31922"],
      ["k", "31923"],
      ["content", "general"],
      ["k", "1111"],
      ["k", "7"],
      ["k", "1984"],
      ["k", "1985"],
    ],
  },
  communitySecret,
)

const relayList = finalizeEvent(
  {
    kind: 10002,
    created_at: 2,
    content: "",
    tags: [["r", personalOutboxRelay, "write"]],
  },
  communitySecret,
)

const calendarEvent = finalizeEvent(
  {
    kind: 31922,
    created_at: 3,
    content: "Strict community reaction transport",
    tags: [
      ["d", "calendar-reaction-scope"],
      ["h", DEV_PUBKEY],
      ["title", "Calendar reaction scope"],
      ["start", "2099-01-01"],
    ],
  },
  communitySecret,
)

const seededReaction = finalizeEvent(
  {
    kind: 7,
    created_at: 4,
    content: "🔥",
    tags: [
      ["h", DEV_PUBKEY],
      ["k", String(calendarEvent.kind)],
      ["e", calendarEvent.id, communityRelay],
      [
        "a",
        `${calendarEvent.kind}:${calendarEvent.pubkey}:calendar-reaction-scope`,
        communityRelay,
      ],
    ],
  },
  communitySecret,
)

const communityInput = `ncommunity://${DEV_PUBKEY}?relay=${encodeURIComponent(communityRelay)}`
const eventPath = `/c/${encodeURIComponent(communityInput)}/calendar/calendar-reaction-scope`

const openCalendarEvent = async (
  page: Parameters<typeof seedDevSession>[0],
  mockRelay: MockRelay,
) => {
  await seedDevSession(page)
  await mockRelay.setup(page)
  await page.goto(eventPath)
  await expect(
    page.getByRole("article").getByText("Calendar reaction scope", {exact: true}),
  ).toBeVisible({timeout: 10_000})
}

test("publishes calendar reaction additions only to community relays", async ({page}) => {
  const destinations: string[] = []
  const mockRelay = new MockRelay({
    seedEvents: [definition, relayList, calendarEvent],
    publishResponsesByRelay: {
      [communityRelay]: {outcome: "accept", latency: 250},
      [personalOutboxRelay]: {outcome: "accept", latency: 250},
    },
    onPublish: (event, relay) => {
      if (event.kind === 7) destinations.push(relay)
    },
  })

  await openCalendarEvent(page, mockRelay)
  await page.getByRole("button", {name: "Add reaction"}).click()
  const picker = page.locator("emoji-picker")
  await expect(picker).toBeVisible()
  await picker.evaluate(element => {
    element.dispatchEvent(
      new CustomEvent("emoji-click", {
        detail: {emoji: {unicode: "🔥"}, unicode: "🔥"},
      }),
    )
  })

  await mockRelay.waitForEvent(7)
  await expect.poll(() => destinations).toEqual([communityRelay])
})

test("publishes calendar reaction deletes only to community relays", async ({page}) => {
  const destinations: string[] = []
  const mockRelay = new MockRelay({
    seedEvents: [definition, relayList, calendarEvent, seededReaction],
    publishResponsesByRelay: {
      [communityRelay]: {outcome: "accept", latency: 250},
      [personalOutboxRelay]: {outcome: "accept", latency: 250},
    },
    onPublish: (event, relay) => {
      if (event.kind === 5) destinations.push(relay)
    },
  })

  await openCalendarEvent(page, mockRelay)
  const reaction = page.getByRole("button", {name: /Click to remove your reaction/})
  await expect(reaction).toBeVisible({timeout: 10_000})
  await reaction.click()

  const deletion = await mockRelay.waitForEvent(5)
  await expect.poll(() => destinations).toEqual([communityRelay])
  expect(deletion.created_at).toBeGreaterThan(seededReaction.created_at)
})
