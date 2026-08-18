import {expect, test} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const communitySecret = Uint8Array.from(
  DEV_SECRET.match(/.{2}/g)?.map(byte => Number.parseInt(byte, 16)) || [],
)
const communityId = getPublicKey(new Uint8Array(32).fill(9))
const communityRelay = "wss://deep-link-community.example"
const community = nip19.naddrEncode({
  kind: 32222,
  pubkey: DEV_PUBKEY,
  identifier: communityId,
  relays: [communityRelay],
})
const definition = finalizeEvent(
  {
    kind: 32222,
    created_at: 1,
    content: "",
    tags: [
      ["d", communityId],
      ["name", "Deep Link Community"],
      ["r", communityRelay],
      ["content", "Threads"],
      ["k", "11", "threads"],
      ["a", `30000:${DEV_PUBKEY}:general`, communityRelay],
      ["content", "Calendar"],
      ["k", "31922"],
      ["k", "31923"],
      ["a", `30000:${DEV_PUBKEY}:general`, communityRelay],
      ["content", "Goals"],
      ["k", "9041"],
      ["a", `30000:${DEV_PUBKEY}:general`, communityRelay],
      ["content", "General"],
      ["k", "1111"],
      ["k", "7"],
      ["k", "1984"],
      ["k", "1985"],
      ["a", `30000:${DEV_PUBKEY}:general`, communityRelay],
    ],
  },
  communitySecret,
)
const profile = nip19.npubEncode(DEV_PUBKEY)

const deepLinks: Array<{path: string; expectedText?: string; component?: string}> = [
  {path: "/explore", expectedText: "Explore communities"},
  {path: "/settings/about", expectedText: "Thanks for using BudaBit!"},
  {path: "/settings/relays", expectedText: "Messaging Relays"},
  {path: "/git", expectedText: "Git Repositories"},
  {path: `/people/${profile}`, component: "PageBar"},
  {path: `/c/${community}`, component: "PageBar"},
  {path: `/c/${community}/threads`, expectedText: "Threads"},
  {path: `/c/${community}/calendar`, expectedText: "Calendar"},
  {path: `/c/${community}/goals`, expectedText: "Goals"},
  {path: `/c/${community}/badges`, expectedText: "Community Badges"},
  {path: `/c/${community}/widgets`, expectedText: "Widgets"},
]

test.describe("deep link refresh", () => {
  test.beforeEach(async ({page}) => {
    await seedDevSession(page)
    await new MockRelay({seedEvents: [definition]}).setup(page)
  })

  for (const {path, expectedText, component} of deepLinks) {
    test(`renders ${path} after reload`, async ({page}) => {
      const assertRoute = async () => {
        expect(new URL(page.url()).pathname).toBe(path)

        if (expectedText) {
          await expect(page.getByText(expectedText, {exact: true}).first()).toBeVisible({
            timeout: 15_000,
          })
        }

        if (component) {
          await expect(page.locator(`[data-component="${component}"]`).first()).toBeVisible({
            timeout: 15_000,
          })
        }
      }

      await page.goto(path, {waitUntil: "load"})
      await assertRoute()

      await page.reload({waitUntil: "load"})
      await assertRoute()
    })
  }
})
