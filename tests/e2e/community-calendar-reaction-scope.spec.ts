import {expect, test} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const communityRelay = "wss://calendar-community.example"
const personalOutboxRelay = "wss://calendar-outbox.example"
const communityRelayConnection = `${communityRelay}/`
const communitySecret = Uint8Array.from(
  DEV_SECRET.match(/.{2}/g)?.map(byte => Number.parseInt(byte, 16)) || [],
)
const communityId = getPublicKey(new Uint8Array(32).fill(2))
const profileListIdentifier = `${communityId}-calendar`
const profileListAddress = `30000:${DEV_PUBKEY}:${profileListIdentifier}`

const definition = finalizeEvent(
  {
    kind: 32222,
    created_at: 1,
    content: "",
    tags: [
      ["d", communityId],
      ["name", "Calendar Reaction Community"],
      ["description", "Community calendar reaction scope test fixture"],
      ["r", communityRelay],
      ["content", "Calendar-event-creator"],
      ["k", "31922"],
      ["k", "31923"],
      ["a", profileListAddress, communityRelay],
      ["content", "General"],
      ["k", "1111"],
      ["k", "7"],
      ["k", "1984"],
      ["k", "1985"],
      ["a", profileListAddress, communityRelay],
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

const profileList = finalizeEvent(
  {
    kind: 30000,
    created_at: 2,
    content: "",
    tags: [
      ["d", profileListIdentifier],
      ["p", DEV_PUBKEY],
    ],
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
      ["h", communityId],
      ["title", "Calendar reaction scope"],
      ["start", "2099-01-01"],
    ],
  },
  communitySecret,
)

const calendarEventReplacement = finalizeEvent(
  {
    kind: 31922,
    created_at: 5,
    content: "Replacement with stable reaction projection",
    tags: [
      ["d", "calendar-reaction-scope"],
      ["h", communityId],
      ["title", "Calendar reaction scope replacement"],
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
      ["h", communityId],
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

const communityNaddr = nip19.naddrEncode({
  kind: 32222,
  pubkey: DEV_PUBKEY,
  identifier: communityId,
  relays: [communityRelay],
})
const eventPath = `/c/${communityNaddr}/calendar/calendar-reaction-scope`

const openCalendarEvent = async (
  page: Parameters<typeof seedDevSession>[0],
  mockRelay: MockRelay,
  title = "Calendar reaction scope",
) => {
  await seedDevSession(page)
  await mockRelay.setup(page)
  await page.goto(eventPath)
  await expect(page.getByRole("article").getByText(title, {exact: true})).toBeVisible({
    timeout: 20_000,
  })
}

test("publishes calendar reaction additions only to community relays", async ({page}) => {
  const destinations: string[] = []
  const mockRelay = new MockRelay({
    seedEvents: [definition, relayList, profileList, calendarEvent],
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
  await expect.poll(() => destinations).toEqual([communityRelayConnection])
})

test("publishes calendar reaction deletes only to community relays", async ({page}) => {
  const destinations: string[] = []
  const mockRelay = new MockRelay({
    seedEvents: [definition, relayList, profileList, calendarEvent, seededReaction],
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
  await expect.poll(() => destinations).toEqual([communityRelayConnection])
  expect(deletion.created_at).toBeGreaterThan(seededReaction.created_at)
})

test("projects a replaced calendar reaction delete during rejection and retry", async ({page}) => {
  const destinations: string[] = []
  const mockRelay = new MockRelay({
    seedEvents: [
      definition,
      relayList,
      profileList,
      calendarEvent,
      calendarEventReplacement,
      seededReaction,
    ],
    publishResponsesByRelay: {
      [communityRelay]: {outcome: "reject", latency: 2_000, message: "rejected for test"},
      [personalOutboxRelay]: {outcome: "accept", latency: 250},
    },
    onPublish: (event, relay) => {
      if (event.kind === 5) destinations.push(relay)
    },
  })

  await openCalendarEvent(page, mockRelay, "Calendar reaction scope replacement")
  const reaction = page.getByRole("button", {name: /Click to remove your reaction/})
  await expect(reaction).toBeVisible({timeout: 10_000})

  await reaction.click()
  await expect(reaction).toHaveCount(0, {timeout: 1_000})
  const deletion = await mockRelay.waitForEvent(5)
  await expect(reaction).toBeVisible({timeout: 5_000})

  const recoveryToast = page.getByRole("alert").filter({hasText: "Remove reaction"})
  await recoveryToast.getByRole("button", {name: "Retry", exact: true}).click()
  await expect(reaction).toHaveCount(0, {timeout: 1_000})
  await expect
    .poll(() => mockRelay.getPublishedEvents().filter(event => event.kind === 5).length)
    .toBe(2)
  await expect(reaction).toBeVisible({timeout: 5_000})

  expect(deletion.created_at).toBeGreaterThan(seededReaction.created_at)
  expect(destinations).toEqual([communityRelayConnection, communityRelayConnection])
})
