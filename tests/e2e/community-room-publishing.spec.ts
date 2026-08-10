import {expect, test} from "@playwright/test"
import {finalizeEvent} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const relayUrl = "wss://community-room-publishing.example/"
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
      ["content", "rooms"],
      ["k", "11", "room"],
      ["content", "general"],
      ["k", "9", "room-message"],
      ["k", "1111"],
      ["k", "7"],
      ["k", "1984"],
      ["k", "1985"],
    ],
  },
  communitySecret,
)

const room = finalizeEvent(
  {
    kind: 11,
    created_at: 2,
    content: "Publishing regression room",
    tags: [["h", DEV_PUBKEY], ["room"], ["title", "Publishing Room"]],
  },
  communitySecret,
)

const seededMessage = finalizeEvent(
  {
    kind: 9,
    created_at: 3,
    content: "Message with a reaction",
    tags: [
      ["h", DEV_PUBKEY],
      ["E", room.id, relayUrl, DEV_PUBKEY],
      ["K", "11"],
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
      ["k", "9"],
      ["e", seededMessage.id, relayUrl],
    ],
  },
  communitySecret,
)

const communityInput = `ncommunity://${DEV_PUBKEY}?relay=${encodeURIComponent(relayUrl)}`
const roomPath = `/c/${encodeURIComponent(communityInput)}/rooms/${room.id}`

const openRoom = async (page: Parameters<typeof seedDevSession>[0], mockRelay: MockRelay) => {
  await seedDevSession(page)
  await mockRelay.setup(page)
  await page.goto(roomPath)
  await expect(
    page.locator('[data-component="PageBar"]').getByText("Publishing Room", {exact: true}),
  ).toBeVisible({timeout: 10_000})
  await expect(page.locator('.chat__compose [contenteditable="true"]')).toBeVisible()
}

test("shows a room message before relay acknowledgement and keeps it after success", async ({
  page,
}) => {
  const messageText = "Optimistic message before acknowledgement"
  const mockRelay = new MockRelay({
    seedEvents: [definition, room],
    publishResponsesByRelay: {
      [relayUrl]: {outcome: "accept", latency: 2_000},
    },
  })

  await openRoom(page, mockRelay)
  await page.locator('.chat__compose [contenteditable="true"]').fill(messageText)
  await page.getByRole("button", {name: "Send message"}).click()

  const message = page.locator("[data-event]").filter({hasText: messageText})
  await expect(message).toBeVisible({timeout: 1_000})
  await expect(message).toHaveCount(1)

  await mockRelay.waitForEvent(9)
  await page.waitForTimeout(2_100)

  await expect(message).toBeVisible()
  await expect(message).toHaveCount(1)
  await expect(message.getByText("Failed to send!", {exact: true})).toHaveCount(0)
})

test("keeps a failed room message visible with retry and discard actions", async ({page}) => {
  const messageText = "Retryable failed room message"
  const mockRelay = new MockRelay({
    seedEvents: [definition, room],
    publishResponsesByRelay: {
      [relayUrl]: {outcome: "reject", latency: 500, message: "rejected for test"},
    },
  })

  await openRoom(page, mockRelay)
  await page.locator('.chat__compose [contenteditable="true"]').fill(messageText)
  await page.getByRole("button", {name: "Send message"}).click()

  const message = page.locator("[data-event]").filter({hasText: messageText})
  const failure = message.getByText("Publication not confirmed.", {exact: true})
  await expect(message).toBeVisible({timeout: 1_000})
  await expect(failure).toBeVisible({timeout: 5_000})

  const recoveryToast = page.getByRole("alert").filter({hasText: "Room message"})
  await recoveryToast.getByRole("button", {name: "Dismiss notification"}).click()
  await expect(message).toBeVisible()

  await expect(page.getByRole("button", {name: /Open publication recovery/})).toHaveCount(0)
  const notificationsButton = page.getByRole("button", {name: "Notifications", exact: true})
  const notificationIndicator = notificationsButton.locator("div.absolute.rounded-full.bg-primary")
  await expect(notificationIndicator).toBeVisible()
  await notificationsButton.click()

  const publicationsButton = page.getByRole("button", {
    name: "Open publication recovery with 1 item",
  })
  await expect(publicationsButton).toBeVisible()
  await expect(publicationsButton).toHaveClass(/btn-warning/)
  await publicationsButton.click()
  const modalRoot = page.getByTestId("modal-root")
  await expect(page.getByRole("heading", {name: "Publication recovery"})).toBeVisible()
  await expect(page.getByText("Room message", {exact: true})).toBeVisible()
  await expect(modalRoot.getByRole("button", {name: "Retry", exact: true})).toBeVisible()
  await modalRoot.getByRole("button", {name: "Close", exact: true}).click()
  await page.getByRole("button", {name: "Close dialog"}).click({position: {x: 5, y: 5}})
  await expect(notificationIndicator).toBeVisible()

  await page.getByRole("link", {name: "Home", exact: true}).first().click()
  await expect(page).toHaveURL(/\/c\/npub/)
  await page.goBack()
  await expect(
    page.locator('[data-component="PageBar"]').getByText("Publishing Room", {exact: true}),
  ).toBeVisible({timeout: 10_000})
  await expect(message).toBeVisible()

  const retry = message.getByRole("button", {name: "Retry", exact: true})
  await expect(retry).toBeVisible()
  await retry.click()
  await expect
    .poll(() => mockRelay.getPublishedEvents().filter(event => event.kind === 9).length)
    .toBe(2)
  await expect(message).toHaveCount(1)
  await expect(failure).toBeVisible({timeout: 5_000})

  await recoveryToast.getByRole("button", {name: "Dismiss notification"}).click()
  await notificationsButton.click()
  await page.getByRole("button", {name: "Open publication recovery with 1 item"}).click()
  await modalRoot.getByRole("button", {name: "Discard local copy", exact: true}).click()
  await expect(page.getByText("No publications currently need attention.")).toBeVisible()
  await modalRoot.getByRole("button", {name: "Close", exact: true}).click()
  await page.getByRole("button", {name: "Close dialog"}).click({position: {x: 5, y: 5}})
  await expect(message).toHaveCount(0)
  await expect(notificationIndicator).toHaveCount(0)
})

test("rolls a rejected reaction addition back and reapplies it during retry", async ({page}) => {
  const mockRelay = new MockRelay({
    seedEvents: [definition, room, seededMessage],
    publishResponsesByRelay: {
      [relayUrl]: {outcome: "reject", latency: 2_000, message: "rejected for test"},
    },
  })

  await openRoom(page, mockRelay)
  const message = page.locator("[data-event]").filter({hasText: seededMessage.content})
  await message.getByRole("button", {name: "Add reaction"}).last().click()
  const picker = page.locator("emoji-picker")
  await expect(picker).toBeVisible()
  await picker.evaluate(element => {
    element.dispatchEvent(
      new CustomEvent("emoji-click", {
        detail: {emoji: {unicode: "🔥"}, unicode: "🔥"},
      }),
    )
  })

  const pendingReaction = message.getByRole("button", {name: "Publishing reaction..."})
  await expect(pendingReaction).toBeVisible({timeout: 1_000})
  await mockRelay.waitForEvent(7)
  await expect(pendingReaction).toHaveCount(0, {timeout: 5_000})

  const recoveryToast = page.getByRole("alert").filter({hasText: "Reaction"})
  await recoveryToast.getByRole("button", {name: "Retry", exact: true}).click()
  await expect(pendingReaction).toBeVisible({timeout: 1_000})
  await expect
    .poll(() => mockRelay.getPublishedEvents().filter(event => event.kind === 7).length)
    .toBe(2)
  await expect(pendingReaction).toHaveCount(0, {timeout: 5_000})
})

test("commits an accepted reaction addition", async ({page}) => {
  const mockRelay = new MockRelay({
    seedEvents: [definition, room, seededMessage],
    publishResponsesByRelay: {
      [relayUrl]: {outcome: "accept", latency: 500},
    },
  })

  await openRoom(page, mockRelay)
  const message = page.locator("[data-event]").filter({hasText: seededMessage.content})
  await message.getByRole("button", {name: "Add reaction"}).last().click()
  const picker = page.locator("emoji-picker")
  await expect(picker).toBeVisible()
  await picker.evaluate(element => {
    element.dispatchEvent(
      new CustomEvent("emoji-click", {
        detail: {emoji: {unicode: "🔥"}, unicode: "🔥"},
      }),
    )
  })

  await expect(message.getByRole("button", {name: "Publishing reaction..."})).toBeVisible({
    timeout: 1_000,
  })
  await mockRelay.waitForEvent(7)
  await expect(message.getByRole("button", {name: /Click to remove your reaction/})).toBeVisible({
    timeout: 5_000,
  })
})

test("rolls a rejected reaction delete back and reapplies it during retry", async ({page}) => {
  const mockRelay = new MockRelay({
    seedEvents: [definition, room, seededMessage, seededReaction],
    publishResponsesByRelay: {
      [relayUrl]: {outcome: "reject", latency: 2_000, message: "rejected for test"},
    },
  })

  await openRoom(page, mockRelay)
  const message = page.locator("[data-event]").filter({hasText: seededMessage.content})
  const reaction = message.getByRole("button", {name: /Click to remove your reaction/})
  await expect(reaction).toBeVisible()

  await reaction.click()
  await expect(reaction).toHaveCount(0)
  await mockRelay.waitForEvent(5)
  await expect(reaction).toBeVisible({timeout: 5_000})

  const recoveryToast = page.getByRole("alert").filter({hasText: "Remove reaction"})
  await recoveryToast.getByRole("button", {name: "Retry", exact: true}).click()
  await expect(reaction).toHaveCount(0)
  await expect
    .poll(() => mockRelay.getPublishedEvents().filter(event => event.kind === 5).length)
    .toBe(2)
  await expect(reaction).toBeVisible({timeout: 5_000})
})

test("commits an accepted reaction delete without restoring the reaction", async ({page}) => {
  const mockRelay = new MockRelay({
    seedEvents: [definition, room, seededMessage, seededReaction],
    publishResponsesByRelay: {
      [relayUrl]: {outcome: "accept", latency: 500},
    },
  })

  await openRoom(page, mockRelay)
  const message = page.locator("[data-event]").filter({hasText: seededMessage.content})
  const reaction = message.getByRole("button", {name: /Click to remove your reaction/})
  await expect(reaction).toBeVisible()

  await reaction.click()
  await mockRelay.waitForEvent(5)
  await expect(reaction).toHaveCount(0)
  await page.waitForTimeout(750)
  await expect(reaction).toHaveCount(0)
})
