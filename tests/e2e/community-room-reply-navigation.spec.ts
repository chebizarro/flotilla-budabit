import {expect, test} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const relayUrl = "wss://community-room-reply-navigation.example"
const communitySecret = Uint8Array.from(
  DEV_SECRET.match(/.{2}/g)?.map(byte => Number.parseInt(byte, 16)) || [],
)
const communityId = getPublicKey(new Uint8Array(32).fill(2))
const profileListAddress = `30000:${DEV_PUBKEY}:general`
const messageFixtureStart = Math.floor(Date.now() / 1000) - 1_000

const definition = finalizeEvent(
  {
    kind: 32222,
    created_at: 1,
    content: "",
    tags: [
      ["d", communityId],
      ["name", "Reply Navigation Community"],
      ["description", "Community room reply navigation test fixture"],
      ["r", relayUrl],
      ["content", "Room-creator"],
      ["k", "11", "room"],
      ["k", "9", "room-message"],
      ["a", profileListAddress, relayUrl],
      ["content", "General"],
      ["k", "1111"],
      ["k", "7"],
      ["k", "1984"],
      ["k", "1985"],
      ["a", profileListAddress, relayUrl],
    ],
  },
  communitySecret,
)

const room = finalizeEvent(
  {
    kind: 11,
    created_at: 2,
    content: "Quoted reply navigation room",
    tags: [["h", communityId], ["room"], ["title", "Reply Navigation"]],
  },
  communitySecret,
)

const makeMessage = (content: string, createdAt: number) =>
  finalizeEvent(
    {
      kind: 9,
      created_at: createdAt,
      content,
      tags: [
        ["h", communityId],
        ["E", room.id, relayUrl, DEV_PUBKEY],
        ["K", "11"],
      ],
    },
    communitySecret,
  )

const parent = makeMessage(
  [
    "Original parent message for navigation",
    "Parent preview line two",
    "Parent preview line three",
    "Parent preview line four",
    "Parent preview line five",
    "Parent preview line six",
  ].join("\n"),
  messageFixtureStart,
)
const fillerMessages = Array.from({length: 240}, (_, index) =>
  makeMessage(`Filler message ${index + 1}`, messageFixtureStart + index + 1),
)
const parentNevent = nip19.neventEncode({id: parent.id, relays: [relayUrl]})
const reply = finalizeEvent(
  {
    kind: 9,
    created_at: messageFixtureStart + 241,
    content: `nostr:${parentNevent}\n\nReply after enough messages to move the parent off screen`,
    tags: [
      ["h", communityId],
      ["E", room.id, relayUrl, DEV_PUBKEY],
      ["K", "11"],
      ["e", parent.id, relayUrl, parent.pubkey],
      ["k", "9"],
      ["p", parent.pubkey, relayUrl],
      ["q", parent.id, relayUrl, parent.pubkey],
    ],
  },
  communitySecret,
)
const nearbyParent = makeMessage("Nearby parent message for navigation", messageFixtureStart + 242)
const nearbyFiller = makeMessage(
  "Message between nearby parent and reply",
  messageFixtureStart + 243,
)
const nearbyParentNevent = nip19.neventEncode({id: nearbyParent.id, relays: [relayUrl]})
const nearbyReply = finalizeEvent(
  {
    kind: 9,
    created_at: messageFixtureStart + 244,
    content: `nostr:${nearbyParentNevent}\n\nReply close to its quoted parent`,
    tags: [
      ["h", communityId],
      ["E", room.id, relayUrl, DEV_PUBKEY],
      ["K", "11"],
      ["e", nearbyParent.id, relayUrl, nearbyParent.pubkey],
      ["k", "9"],
      ["p", nearbyParent.pubkey, relayUrl],
      ["q", nearbyParent.id, relayUrl, nearbyParent.pubkey],
    ],
  },
  communitySecret,
)

const communityNaddr = nip19.naddrEncode({
  kind: 32222,
  pubkey: DEV_PUBKEY,
  identifier: communityId,
  relays: [relayUrl],
})
const roomPath = `/c/${communityNaddr}/rooms/${room.id}`

test("loads a room opened from a direct event permalink", async ({page}) => {
  const effectErrors: string[] = []
  page.on("pageerror", error => {
    if (error.message.includes("effect_update_depth_exceeded")) effectErrors.push(error.message)
  })
  const mockRelay = new MockRelay({seedEvents: [definition, room, nearbyParent]})

  await seedDevSession(page)
  await mockRelay.setup(page)
  await page.goto(`${roomPath}#event-${nearbyParent.id}`)

  await expect(
    page.locator('[data-component="PageBar"]').getByText("Reply Navigation", {exact: true}),
  ).toBeVisible({timeout: 15_000})
  await expect(page.locator(`[data-event="${nearbyParent.id}"]`).first()).toBeVisible({
    timeout: 10_000,
  })
  expect(effectErrors).toEqual([])
})

test("opens a quoted room parent without reloading the room", async ({page}) => {
  const mockRelay = new MockRelay({
    seedEvents: [
      definition,
      room,
      parent,
      ...fillerMessages,
      reply,
      nearbyParent,
      nearbyFiller,
      nearbyReply,
    ],
  })

  await seedDevSession(page)
  await mockRelay.setup(page)
  await page.goto(roomPath)
  await expect(
    page.locator('[data-component="PageBar"]').getByText("Reply Navigation", {exact: true}),
  ).toBeVisible({timeout: 15_000})

  const parentMessage = page.locator(`[data-event="${parent.id}"]`).first()
  const replyMessage = page.locator(`[data-event="${reply.id}"]`).first()
  const quoteButton = replyMessage.locator("button.my-2").filter({
    hasText: "Original parent message for navigation",
  })
  const quotePreview = quoteButton.locator("[data-quoted-event-preview]")
  await expect(replyMessage).toBeVisible({timeout: 10_000})
  await expect(quoteButton).toBeVisible({timeout: 10_000})
  await expect
    .poll(() => quotePreview.evaluate(element => element.getBoundingClientRect().height))
    .toBeLessThanOrEqual(49)
  await expect(parentMessage).toHaveCount(0)

  await replyMessage.evaluate(element => {
    element.setAttribute("data-jump-sentinel", "original")
  })
  await page.evaluate(() => {
    document.body.dataset.roomPermissionLoadingObserved = "false"
    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-room-loading-stage="permissions"]')) {
        document.body.dataset.roomPermissionLoadingObserved = "true"
      }
    })

    observer.observe(document.body, {attributes: true, childList: true, subtree: true})
  })
  await quoteButton.click()

  await expect(page).toHaveURL(`${roomPath}#event-${parent.id}`)
  await expect(parentMessage).toBeInViewport({timeout: 10_000})
  await expect(replyMessage).toHaveAttribute("data-jump-sentinel", "original")
  await expect(parentMessage).toHaveClass(/event-target-highlight/)
  await page.waitForTimeout(500)
  await expect(page.locator('[data-room-loading-stage="permissions"]')).toHaveCount(0)
  await expect(page.locator("body")).toHaveAttribute(
    "data-room-permission-loading-observed",
    "false",
  )
})

test("centers an already-visible nearby parent on repeated jumps", async ({page}) => {
  const mockRelay = new MockRelay({
    seedEvents: [definition, room, nearbyParent, nearbyFiller, nearbyReply],
  })

  await seedDevSession(page)
  await mockRelay.setup(page)
  await page.goto(roomPath)

  const parentMessage = page.locator(`[data-event="${nearbyParent.id}"]`).first()
  const replyMessage = page.locator(`[data-event="${nearbyReply.id}"]`).first()
  const quoteButton = replyMessage.getByRole("button", {
    name: "Nearby parent message for navigation",
    exact: true,
  })
  await expect(parentMessage).toBeVisible({timeout: 10_000})
  await expect(replyMessage).toBeVisible({timeout: 10_000})
  await replyMessage.evaluate(element => element.scrollIntoView({block: "center"}))
  await expect(parentMessage).toBeInViewport()

  const assertTargetCentered = async () => {
    await expect
      .poll(() =>
        page.evaluate(id => {
          const target = document.querySelector(`[data-event="${id}"]`)
          const scroller = document.querySelector('[data-component="PageContent"]')
          const composer = document.querySelector(".chat__compose")
          if (!target || !scroller || !composer) return Number.POSITIVE_INFINITY

          const targetRect = target.getBoundingClientRect()
          const scrollerRect = scroller.getBoundingClientRect()
          const composerRect = composer.getBoundingClientRect()
          const visibleBottom = Math.min(scrollerRect.bottom, composerRect.top)
          const visibleCenter = scrollerRect.top + (visibleBottom - scrollerRect.top) / 2

          return Math.abs(targetRect.top + targetRect.height / 2 - visibleCenter)
        }, nearbyParent.id),
      )
      .toBeLessThan(120)
  }

  await quoteButton.click()
  await expect(page).toHaveURL(`${roomPath}#event-${nearbyParent.id}`)
  await assertTargetCentered()
  await expect(parentMessage).toHaveClass(/event-target-highlight/)

  await replyMessage.evaluate(element => element.scrollIntoView({block: "center"}))
  await quoteButton.click()
  await assertTargetCentered()
})
