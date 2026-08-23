import {expect, test} from "@playwright/test"
import {
  BASE_TIMESTAMP,
  TEST_PUBKEYS,
  createRepoAnnouncement,
  signTestEvent,
} from "./fixtures/events"
import {DEV_SECRET} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const relayUrl = "wss://git-list-search-stability.test"

test("keeps the repository grid and surviving card mounted while search updates", async ({
  page,
}) => {
  const alphaName = "Mounted search alpha"
  const betaName = "Mounted search beta"
  const announcements = [
    signTestEvent(
      createRepoAnnouncement({
        identifier: "mounted-search-alpha",
        name: alphaName,
        relays: [relayUrl],
        pubkey: TEST_PUBKEYS.devUser,
        created_at: BASE_TIMESTAMP + 1,
      }),
    ),
    signTestEvent(
      createRepoAnnouncement({
        identifier: "mounted-search-beta",
        name: betaName,
        relays: [relayUrl],
        pubkey: TEST_PUBKEYS.devUser,
        created_at: BASE_TIMESTAMP + 2,
      }),
    ),
  ]
  const mockRelay = new MockRelay({seedEvents: announcements})

  await page.addInitScript(
    ({pubkey, secret}) => {
      localStorage.clear()
      localStorage.setItem("pubkey", JSON.stringify(pubkey))
      localStorage.setItem(
        "sessions",
        JSON.stringify({[pubkey]: {method: "nip01", secret, pubkey}}),
      )
      localStorage.setItem("git:selected-mode", JSON.stringify("personal"))
      localStorage.setItem("git:selected-tab", JSON.stringify("my-repos"))
    },
    {pubkey: TEST_PUBKEYS.devUser, secret: DEV_SECRET},
  )
  await mockRelay.setup(page)
  await page.goto("/git")

  await expect(page.getByText(alphaName, {exact: true})).toBeVisible({timeout: 10_000})
  await expect(page.getByText(betaName, {exact: true})).toBeVisible()
  await page.evaluate(name => {
    const grid = document.querySelector<HTMLElement>('[data-testid="repo-card-grid"]')
    const card = Array.from(
      grid?.querySelectorAll<HTMLElement>('[data-testid="repo-card"]') || [],
    ).find(candidate => candidate.textContent?.includes(name))
    if (!grid || !card) throw new Error("Repository grid fixture was not rendered")

    const state = {grid, card, disconnected: false}
    const observer = new MutationObserver(() => {
      if (!grid.isConnected || !card.isConnected) state.disconnected = true
    })
    observer.observe(document.body, {childList: true, subtree: true})
    ;(window as any).__repoSearchMountState = {state, observer}
  }, alphaName)

  await page.getByPlaceholder("Search repo, owner, npub, or naddr").fill("mounted search alpha")
  await expect(page.getByText(betaName, {exact: true})).toHaveCount(0)
  await expect(page.getByText(alphaName, {exact: true})).toBeVisible()

  await expect
    .poll(() =>
      page.evaluate(() => {
        const holder = (window as any).__repoSearchMountState
        const state = holder?.state
        const currentGrid = document.querySelector('[data-testid="repo-card-grid"]')
        return Boolean(
          state &&
          !state.disconnected &&
          state.grid === currentGrid &&
          state.grid.isConnected &&
          state.card.isConnected,
        )
      }),
    )
    .toBe(true)
})

test("expands personal repository scope only through show more", async ({page}) => {
  const announcements = Array.from({length: 40}, (_, index) =>
    signTestEvent(
      createRepoAnnouncement({
        identifier: `rendered-page-${index + 1}`,
        name: `Rendered page repository ${index + 1}`,
        relays: [relayUrl],
        pubkey: TEST_PUBKEYS.devUser,
        created_at: BASE_TIMESTAMP + index + 1,
      }),
    ),
  )
  const announcementRequests: Array<{authors?: string[]; limit?: number}> = []
  const mockRelay = new MockRelay({
    seedEvents: announcements,
    onSubscribe: (_subscriptionId, filters) => {
      for (const filter of filters) {
        if (filter.kinds?.includes(30617)) {
          announcementRequests.push({authors: filter.authors, limit: filter.limit})
        }
      }
    },
  })

  await page.addInitScript(
    ({pubkey, secret}) => {
      localStorage.clear()
      localStorage.setItem("pubkey", JSON.stringify(pubkey))
      localStorage.setItem(
        "sessions",
        JSON.stringify({[pubkey]: {method: "nip01", secret, pubkey}}),
      )
      localStorage.setItem("git:selected-mode", JSON.stringify("personal"))
      localStorage.setItem("git:selected-tab", JSON.stringify("my-repos"))
    },
    {pubkey: TEST_PUBKEYS.devUser, secret: DEV_SECRET},
  )
  await mockRelay.setup(page)
  await page.goto("/git")

  await expect(page.locator('[data-testid="repo-card"]')).toHaveCount(18, {timeout: 10_000})
  expect(announcementRequests).toContainEqual({
    authors: [TEST_PUBKEYS.devUser],
    limit: 18,
  })
  expect(
    announcementRequests.every(request => request.authors?.includes(TEST_PUBKEYS.devUser)),
  ).toBe(true)

  await page.getByRole("button", {name: "Show more repositories"}).click()

  await expect(page.locator('[data-testid="repo-card"]')).toHaveCount(36, {timeout: 10_000})
  await expect.poll(() => announcementRequests.some(request => request.limit === 36)).toBe(true)
})
