import {expect, test} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const secret = Uint8Array.from(
  DEV_SECRET.match(/.{2}/g)?.map(byte => Number.parseInt(byte, 16)) || [],
)
const communityId = getPublicKey(new Uint8Array(32).fill(8))
const relay = "wss://room-notifications.example"
const definition = finalizeEvent(
  {
    kind: 32222,
    created_at: 1,
    content: "",
    tags: [
      ["d", communityId],
      ["name", "Room Notifications Community"],
      ["r", relay],
      ["content", "Rooms"],
      ["k", "11", "room"],
      ["k", "9", "room-message"],
      ["a", `30000:${DEV_PUBKEY}:general`, relay],
      ["content", "General"],
      ["k", "1111"],
      ["k", "7"],
      ["k", "1984"],
      ["k", "1985"],
      ["a", `30000:${DEV_PUBKEY}:general`, relay],
    ],
  },
  secret,
)
const makeRoom = (title: string, createdAt: number) =>
  finalizeEvent(
    {
      kind: 11,
      created_at: createdAt,
      content: title,
      tags: [["h", communityId], ["room"], ["title", title]],
    },
    secret,
  )
const firstRoom = makeRoom("First room", 2)
const secondRoom = makeRoom("Second room", 3)
const community = nip19.naddrEncode({
  kind: 32222,
  pubkey: DEV_PUBKEY,
  identifier: communityId,
  relays: [relay],
})
const firstRoomPath = `/c/${community}/rooms/${firstRoom.id}`
const secondRoomPath = `/c/${community}/rooms/${secondRoom.id}`

test("marks a room checked when navigating directly to another room", async ({page}) => {
  await page.addInitScript(() => localStorage.clear())
  await new MockRelay({seedEvents: [definition, firstRoom, secondRoom]}).setup(page)
  await page.goto(firstRoomPath)
  await expect(page.locator('[data-component="PageContent"]')).toBeVisible({timeout: 15_000})

  await page.evaluate(path => {
    document.body.dataset.clientNavigation = "ready"
    const link = document.createElement("a")
    link.href = path
    link.dataset.testid = "switch-room"
    link.textContent = "Switch room"
    document.body.appendChild(link)
  }, secondRoomPath)

  await page.getByTestId("switch-room").click()
  await expect(page).toHaveURL(secondRoomPath)
  await expect(page.locator("body")).toHaveAttribute("data-client-navigation", "ready")

  await expect
    .poll(() =>
      page.evaluate(path => {
        const checked = JSON.parse(localStorage.getItem("checked") || "{}")
        return checked[path] || 0
      }, firstRoomPath),
    )
    .toBeGreaterThan(0)

  const secondRoomChecked = await page.evaluate(path => {
    const checked = JSON.parse(localStorage.getItem("checked") || "{}")
    return checked[path]
  }, secondRoomPath)

  expect(secondRoomChecked).toBeUndefined()
})
