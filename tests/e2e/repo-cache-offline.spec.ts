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
import {DEV_SECRET} from "./helpers/dev-session"
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

const countBroadRepoListSubscriptions = (page: Page) =>
  page.evaluate(() => {
    const connections = (
      window as unknown as {
        __mockRelayConnections?: Map<
          string,
          {subscriptions: Map<string, Array<Record<string, unknown>>>}
        >
      }
    ).__mockRelayConnections

    if (!connections) return 0

    let count = 0
    for (const connection of connections.values()) {
      for (const filters of connection.subscriptions.values()) {
        if (
          filters.some(
            filter =>
              Array.isArray(filter.kinds) &&
              filter.kinds.includes(30617) &&
              filter.limit === 100 &&
              !filter.authors &&
              !filter["#d"],
          )
        ) {
          count += 1
        }
      }
    }
    return count
  })

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

test("uses live list replacements and cached roots during warm navigation", async ({
  page,
  context,
}) => {
  const identifier = "warm-list-navigation"
  const repoAddress = getRepoAddress(TEST_PUBKEYS.devUser, identifier)
  const cachedAnnouncement = signTestEvent(
    createRepoAnnouncement({
      identifier,
      name: "Cached warm repository",
      relays: [relayUrl],
      pubkey: TEST_PUBKEYS.devUser,
      created_at: BASE_TIMESTAMP,
    }),
  )
  const cachedIssue = signTestEvent(
    createIssue({
      repoAddress,
      subject: "Cached warm root",
      content: "This root renders before stalled detail history completes.",
      pubkey: TEST_PUBKEYS.charlie,
      created_at: BASE_TIMESTAMP + 1,
    }),
  )
  const liveAnnouncement = signTestEvent(
    createRepoAnnouncement({
      identifier,
      name: "Live replacement repository",
      relays: [relayUrl],
      pubkey: TEST_PUBKEYS.devUser,
      created_at: BASE_TIMESTAMP + 2,
    }),
  )
  const warmRelay = new MockRelay({seedEvents: [cachedAnnouncement, cachedIssue]})
  await page.addInitScript(() => localStorage.clear())
  await warmRelay.setup(page)

  const naddr = encodeRepoNaddr(TEST_PUBKEYS.devUser, identifier, [relayUrl])
  await page.goto(`/git/${naddr}/issues/${cachedIssue.id}`)
  await expect(page.getByText("Cached warm root", {exact: true})).toBeVisible({timeout: 10_000})
  await expect
    .poll(async () => {
      const state = await getCacheState(page)
      return {
        repositories: state.repositories.filter(item => item.address === repoAddress).length,
        events: state.events.filter(item => item.repositoryAddress === repoAddress).length,
      }
    })
    .toEqual({repositories: 1, events: 2})

  await page.close()
  const listPage = await context.newPage()
  await listPage.addInitScript(
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

  let listLiveSubscriptions = 0
  let stalledRootRequests = 0
  const stalledRelay = new MockRelay({
    subscriptionOutcomesByRelay: {[`${relayUrl}/`]: "stall"},
    onSubscribe: (_id, filters, url) => {
      if (
        filters.some(
          filter =>
            filter.kinds?.includes(30617) &&
            filter.limit === 100 &&
            !filter.authors &&
            !filter["#d"],
        )
      ) {
        listLiveSubscriptions += 1
      }
      if (
        url === `${relayUrl}/` &&
        filters.some(
          filter =>
            filter.limit === 100 &&
            filter["#a"]?.includes(repoAddress) &&
            filter.kinds?.includes(1621) &&
            filter.kinds?.includes(1618),
        )
      ) {
        stalledRootRequests += 1
      }
    },
  })
  await stalledRelay.setup(listPage)
  await listPage.goto("/git")

  await expect(listPage.getByText("Cached warm repository", {exact: true})).toBeVisible({
    timeout: 10_000,
  })
  await expect.poll(() => listLiveSubscriptions).toBeGreaterThan(0)

  await stalledRelay.injectEvents([liveAnnouncement])
  await expect(listPage.getByText("Live replacement repository", {exact: true})).toBeVisible()
  await expect(listPage.getByText("Cached warm repository", {exact: true})).toHaveCount(0)

  await listPage.getByText("Live replacement repository", {exact: true}).click()
  await expect.poll(() => stalledRootRequests).toBeGreaterThan(0)
  await expect.poll(() => countBroadRepoListSubscriptions(listPage)).toBe(0)
  await expect(listPage.getByTestId("repo-topbar-home")).toHaveText("Live replacement repository")
  await expect(listPage.getByText("Cached warm root", {exact: true})).toBeVisible()
})
