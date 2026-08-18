import {expect, test} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {MockRelay} from "./helpers/mock-relay"

const secret = new Uint8Array(32).fill(21)
const controller = getPublicKey(secret)
const communityId = getPublicKey(new Uint8Array(32).fill(22))
const relay = "wss://explore-search.example"
const definition = finalizeEvent(
  {
    kind: 32222,
    created_at: 1,
    content: "",
    tags: [
      ["d", communityId],
      ["name", "Searchable Builders"],
      ["description", "A community discovered through every supported identity form"],
      ["r", relay],
      ["content", "General"],
      ["k", "1111"],
      ["a", `30000:${controller}:members`, relay],
    ],
  },
  secret,
)
const naddr = nip19.naddrEncode({kind: 32222, pubkey: controller, identifier: communityId})
const npub = nip19.npubEncode(controller)

test("finds communities by name, link, npub, and NIP-05", async ({page}) => {
  await new MockRelay({seedEvents: [definition]}).setup(page)
  await page.route("**/.well-known/nostr.json?name=alice", route =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({names: {alice: controller}, relays: {[controller]: [relay]}}),
    }),
  )
  await page.goto("/explore")

  const search = page.getByLabel("Search communities")
  const submit = page.getByRole("button", {name: "Search", exact: true})
  for (const query of ["Searchable Builders", naddr, npub, "alice@example.com"]) {
    await search.fill(query)
    await submit.click()
    await expect(page.getByText("Searchable Builders", {exact: true})).toBeVisible({
      timeout: 15_000,
    })
  }
})
