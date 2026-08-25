import {expect, test} from "@playwright/test"

import {TEST_PUBKEYS} from "./fixtures/events"
import {MockRelay} from "./helpers/mock-relay"

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
