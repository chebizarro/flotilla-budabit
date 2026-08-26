import {expect, test} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"

import {TEST_PUBKEYS} from "./fixtures/events"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const communityRelay = "wss://git-entry-navigation.example"
const communityId = getPublicKey(new Uint8Array(32).fill(7))
const communitySecret = Uint8Array.from(
  DEV_SECRET.match(/.{2}/g)?.map(byte => Number.parseInt(byte, 16)) || [],
)
const communityNaddr = nip19.naddrEncode({
  kind: 32222,
  pubkey: DEV_PUBKEY,
  identifier: communityId,
  relays: [communityRelay],
})
const communityDefinition = finalizeEvent(
  {
    kind: 32222,
    created_at: 1,
    content: "",
    tags: [
      ["d", communityId],
      ["name", "Git Navigation Community"],
      ["r", communityRelay],
    ],
  },
  communitySecret,
)

test("opens the mobile Community drawer from the Git route", async ({page}) => {
  const mockRelay = new MockRelay()
  await page.setViewportSize({width: 411, height: 809})
  await page.addInitScript(
    ({ownerPubkey, communityId}) => {
      localStorage.clear()
      localStorage.setItem(
        "budabit/community-session",
        JSON.stringify({
          version: 2,
          definition: {kind: 32222, ownerPubkey, communityId},
          relayHints: [],
        }),
      )
    },
    {ownerPubkey: TEST_PUBKEYS.alice, communityId: TEST_PUBKEYS.bob},
  )
  await mockRelay.setup(page)
  await page.goto("/git")

  await page.getByRole("button", {name: "Open community menu"}).click()

  await expect(page.getByRole("button", {name: "Close drawer"})).toBeVisible()
  await expect(page).toHaveURL(/#[^#]+$/)
})

test("switches from a Community Home Git entry to personal Git", async ({page}) => {
  const effectErrors: string[] = []
  page.on("pageerror", error => {
    if (error.message.includes("effect_update_depth_exceeded")) effectErrors.push(error.message)
  })

  await page.setViewportSize({width: 411, height: 809})
  await seedDevSession(page)
  await new MockRelay({seedEvents: [communityDefinition]}).setup(page)
  await page.goto(`/c/${communityNaddr}`)

  await page.locator('[data-perf="community-home"]').getByRole("link", {name: "Git"}).click()

  await expect(page.locator('[data-perf="git-root"]')).toHaveAttribute(
    "data-perf-mode",
    "community",
  )

  await page.getByRole("link", {name: "Git"}).click()

  await expect(page).toHaveURL(/\/git$/)
  await expect(page.locator('[data-perf="git-root"]')).toHaveAttribute("data-perf-mode", "personal")
  await expect(page.getByText("Personal Git", {exact: true})).toBeVisible()
  expect(effectErrors).toEqual([])
})
