import {expect, test, type Page} from "@playwright/test"
import {
  BASE_TIMESTAMP,
  TEST_PUBKEYS,
  createIssue,
  createRepoAnnouncement,
  encodeRepoNaddr,
  getRepoAddress,
  signTestEvent,
} from "./fixtures/events"
import {MockRelay} from "./helpers/mock-relay"

const relayUrl = "wss://repo-cache-offline.test"

const getCacheState = (page: Page) =>
  page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("budabit-repository-cache", 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction(["repositories", "repositoryEvents"], "readonly")
    const repositories = await new Promise<any[]>((resolve, reject) => {
      const request = transaction.objectStore("repositories").getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const events = await new Promise<any[]>((resolve, reject) => {
      const request = transaction.objectStore("repositoryEvents").getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    database.close()
    return {repositories, events}
  })

const makeFixture = (identifier: string) => {
  const repoAddress = getRepoAddress(TEST_PUBKEYS.alice, identifier)
  const announcement = signTestEvent(
    createRepoAnnouncement({
      identifier,
      name: "Offline repository cache",
      relays: [relayUrl],
      pubkey: TEST_PUBKEYS.alice,
      created_at: BASE_TIMESTAMP,
    }),
  )
  const issue = signTestEvent(
    createIssue({
      repoAddress,
      subject: `Cached issue ${identifier}`,
      content: "This issue renders from the verified repository sidecar.",
      pubkey: TEST_PUBKEYS.charlie,
      created_at: BASE_TIMESTAMP + 1,
    }),
  )
  return {repoAddress, announcement, issue}
}

const populateCache = async (page: Page, identifier: string) => {
  const fixture = makeFixture(identifier)
  const relay = new MockRelay({seedEvents: [fixture.announcement, fixture.issue]})
  await page.addInitScript(() => localStorage.clear())
  await relay.setup(page)
  const naddr = encodeRepoNaddr(TEST_PUBKEYS.alice, identifier, [relayUrl])
  const path = `/git/${naddr}/issues/${fixture.issue.id}`
  await page.goto(path)
  await expect(page.getByText(`Cached issue ${identifier}`, {exact: true})).toBeVisible({
    timeout: 10_000,
  })
  await expect
    .poll(async () => {
      const state = await getCacheState(page)
      return {
        repositories: state.repositories.filter(item => item.address === fixture.repoAddress)
          .length,
        events: state.events.filter(item => item.repositoryAddress === fixture.repoAddress).length,
      }
    })
    .toEqual({repositories: 1, events: 2})
  return {...fixture, path}
}

const openOffline = async (page: Page, path: string) => {
  const relay = new MockRelay({
    subscriptionOutcomesByRelay: {[`${relayUrl}/`]: "stall"},
  })
  await relay.setup(page)
  await page.goto(path)
}

test("renders a recent repository from verified cache while its relay is unavailable", async ({
  page,
  context,
}) => {
  const fixture = await populateCache(page, "recent-offline")
  const offlinePage = await context.newPage()
  await openOffline(offlinePage, fixture.path)

  await expect(offlinePage.getByText("Cached issue recent-offline", {exact: true})).toBeVisible({
    timeout: 10_000,
  })
})

test("retains a watched repository offline after recent eligibility expires", async ({
  page,
  context,
}) => {
  const fixture = await populateCache(page, "watched-offline")
  await page.evaluate(async repoAddress => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("budabit-repository-cache", 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction("repositories", "readwrite")
    const store = transaction.objectStore("repositories")
    const record = await new Promise<any>((resolve, reject) => {
      const request = store.get(repoAddress)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    record.watched = true
    record.lastAccessedAt = Date.now() - 31 * 24 * 60 * 60 * 1000
    store.put(record)
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
  }, fixture.repoAddress)

  const offlinePage = await context.newPage()
  await openOffline(offlinePage, fixture.path)

  await expect(offlinePage.getByText("Cached issue watched-offline", {exact: true})).toBeVisible({
    timeout: 10_000,
  })
})
