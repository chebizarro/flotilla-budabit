import {expect, test} from "@playwright/test"
import {finalizeEvent, getPublicKey} from "nostr-tools"
import {DEV_PUBKEY, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const currentCommunityController = getPublicKey(new Uint8Array(32).fill(2))
const currentCommunityId = getPublicKey(new Uint8Array(32).fill(3))
const memberCommunitySecret = Uint8Array.from({length: 32}, (_, index) => index + 1)
const memberCommunityId = getPublicKey(new Uint8Array(32).fill(4))
const profileListSecret = Uint8Array.from({length: 32}, (_, index) => index + 33)
const profileListPubkey = getPublicKey(profileListSecret)
const currentCommunityRelay = "wss://current-community.example"
const memberCommunityRelay = "wss://member-community.example"

test("discovers a cold member community when another community is already visible", async ({
  page,
}) => {
  const memberCommunityDefinition = finalizeEvent(
    {
      kind: 32222,
      created_at: 1,
      content: "",
      tags: [
        ["d", memberCommunityId],
        ["name", "Member Community"],
        ["description", "Preferred member community test fixture"],
        ["r", memberCommunityRelay],
        ["content", "General"],
        ["k", "1111"],
        ["a", `30000:${profileListPubkey}:General`, memberCommunityRelay],
      ],
    },
    memberCommunitySecret,
  )
  const memberProfileList = finalizeEvent(
    {
      kind: 30000,
      created_at: 1,
      content: "",
      tags: [
        ["d", "General"],
        ["p", DEV_PUBKEY],
      ],
    },
    profileListSecret,
  )
  const mockRelay = new MockRelay({
    seedEvents: [memberCommunityDefinition],
    seedEventsByRelay: {[memberCommunityRelay]: [memberProfileList]},
  })

  await seedDevSession(page)
  await page.addInitScript(
    ({controllerPubkey, communityId, relay}) => {
      localStorage.setItem(
        "budabit/community-session",
        JSON.stringify({
          version: 2,
          definition: {kind: 32222, controllerPubkey, communityId},
          relayHints: [relay],
        }),
      )
    },
    {
      controllerPubkey: currentCommunityController,
      communityId: currentCommunityId,
      relay: currentCommunityRelay,
    },
  )
  await mockRelay.setup(page)

  await page.goto("/explore")

  await expect(page.getByText("Last visited", {exact: true})).toBeVisible()
  await expect(page.getByText("Member", {exact: true})).toBeVisible({timeout: 15_000})
})
