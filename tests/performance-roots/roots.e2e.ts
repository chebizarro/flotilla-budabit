import {expect, test, type Page} from "@playwright/test"
import {mkdir, readFile, writeFile} from "node:fs/promises"
import path from "node:path"
import {gunzipSync} from "node:zlib"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {hexToBytes} from "@noble/hashes/utils.js"
import {MockRelay} from "../e2e/helpers/mock-relay"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "../e2e/helpers/dev-session"
import {createRepoAnnouncement, signTestEvent} from "../e2e/fixtures/events/repo"

const secret = hexToBytes(DEV_SECRET)
const communityPubkey = getPublicKey(secret)
const communityId = getPublicKey(new Uint8Array(32).fill(22))
const relay = "wss://performance-roots.example"
const definition = finalizeEvent(
  {
    kind: 32222,
    created_at: 1,
    content: "",
    tags: [
      ["d", communityId],
      ["name", "Performance Community"],
      ["description", "Deterministic performance fixture"],
      ["r", relay],
      ["content", "Rooms"],
      ["k", "11", "room"],
      ["k", "1111"],
      ["content", "Apps"],
      ["k", "30033"],
    ],
  },
  secret,
)
const rooms = ["Design", "Engineering", "Operations"].map((title, index) =>
  finalizeEvent(
    {
      kind: 11,
      created_at: index + 2,
      content: title,
      tags: [["h", communityId], ["room"], ["title", title]],
    },
    secret,
  ),
)
const widgetIdentifier = "performance-widget"
const widget = finalizeEvent(
  {
    kind: 30033,
    created_at: 10,
    content: "Performance Widget",
    tags: [
      ["d", widgetIdentifier],
      ["l", "basic"],
      ["slot", "community-home-before-quicklinks", "Performance Widget"],
      ["button", "Open", "redirect", "https://example.com/performance"],
    ],
  },
  secret,
)
const widgetTarget = finalizeEvent(
  {
    kind: 30222,
    created_at: 11,
    content: "",
    tags: [
      ["d", "performance-widget-target"],
      ["a", `30033:${communityPubkey}:${widgetIdentifier}`, relay],
      ["k", "30033"],
      ["h", communityId],
      ["a", `32222:${communityPubkey}:${communityId}`, relay],
    ],
  },
  secret,
)
const widgetId = `30033:${communityPubkey}:${widgetIdentifier}`
const installedWidget = {
  ...widget,
  identifier: widgetIdentifier,
  widgetType: "basic",
  buttons: [
    {
      index: 0,
      label: "Open",
      type: "redirect",
      url: "https://example.com/performance",
    },
  ],
  slot: {type: "community-home-before-quicklinks", label: "Performance Widget"},
}
const repositories = Array.from({length: 18}, (_, index) =>
  signTestEvent(
    createRepoAnnouncement({
      identifier: `performance-repo-${index + 1}`,
      name: `Performance Repo ${String(index + 1).padStart(2, "0")}`,
      description: `Deterministic repository ${index + 1}`,
      relays: [relay],
      created_at: 100 + index,
      pubkey: DEV_PUBKEY,
    }),
  ),
)
const communityNaddr = nip19.naddrEncode({
  kind: 32222,
  pubkey: communityPubkey,
  identifier: communityId,
  relays: [relay],
})

type Measurement = {
  cache: "cold-data" | "warm-assets"
  route: string
  shellMs: number
  firstUsefulMs: number
  settledMs: number
  longTasks: Array<{startTime: number; duration: number}>
  resources: Array<{name: string; duration: number; transferSize: number}>
  relay: Awaited<ReturnType<MockRelay["getTelemetry"]>>
  server: {requestCount: number; responseBytes: number}
}

const waitForCacheComplete = async (page: Page) => {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const keys = await caches.keys()
          for (const key of keys.filter(candidate => candidate.startsWith("budabit-app-"))) {
            const cache = await caches.open(key)
            if (await cache.match("/__budabit_app_cache_complete__")) return true
          }
          return false
        }),
      {timeout: 60_000},
    )
    .toBe(true)
}

const measure = async (
  page: Page,
  mockRelay: MockRelay,
  route: string,
  cache: Measurement["cache"],
) => {
  await page.request.post("/__perf/reset")
  await page.goto(route, {waitUntil: "domcontentloaded"})
  const root = page.locator(
    route === "/git" ? '[data-perf="git-root"]' : '[data-perf="community-home"]',
  )
  await expect(root).toBeVisible()
  const shellMs = await page.evaluate(() => performance.now())
  if (route === "/git") {
    await expect(root).toHaveAttribute("data-perf-cards", "18")
  } else {
    await expect(root).toHaveAttribute("data-perf-core-ready", "true")
  }
  const firstUsefulMs = await page.evaluate(() => performance.now())
  if (route === "/git") {
    await expect(root).toHaveAttribute("data-perf-loading", "false")
  } else {
    await expect(root).toHaveAttribute(
      "data-perf-community",
      `32222:${communityPubkey}:${communityId}`,
    )
    await expect(root).toHaveAttribute("data-perf-rooms", "3")
    await expect(root).toHaveAttribute("data-perf-extensions-ready", "true")
    await expect(root).toHaveAttribute("data-perf-widgets", "1")
  }

  const browser = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[]
    const root = document.querySelector("[data-perf='git-root'],[data-perf='community-home']")
    return {
      routeCommitMs: navigation.responseEnd,
      settledMs: performance.now(),
      resources: resources.map(entry => ({
        name: entry.name,
        duration: entry.duration,
        transferSize: entry.transferSize,
      })),
      projection: root
        ? Object.fromEntries(
            Array.from(root.attributes)
              .filter(attribute => attribute.name.startsWith("data-perf"))
              .map(attribute => [attribute.name, attribute.value]),
          )
        : {},
    }
  })
  const longTasks = await page.evaluate(
    () =>
      (
        window as unknown as {
          __performanceRootLongTasks?: Array<{startTime: number; duration: number}>
        }
      ).__performanceRootLongTasks || [],
  )
  const server = await page.request.get("/__perf/state").then(response => response.json())
  const relayTelemetry = await mockRelay.getTelemetry()
  return {
    ...browser,
    cache,
    route,
    shellMs,
    firstUsefulMs,
    longTasks,
    relay: relayTelemetry,
    relayRequestCount: relayTelemetry.filter(entry => entry.type === "req").length,
    relayFilterCount: relayTelemetry
      .filter(entry => entry.type === "req")
      .reduce((total, entry) => total + (entry.filters?.length || 0), 0),
    server,
  }
}

const captureDiagnosticArtifact = async (page: Page, profile: string) => {
  await page.locator('[data-perf="diagnostics-control"] button', {hasText: "Perf"}).click()
  const panel = page.getByRole("region", {name: "Performance diagnostics"})
  await panel.getByRole("button", {name: "Start capture"}).click()
  await expect(panel.getByText(/Milestones/)).toBeVisible()
  await panel.getByRole("button", {name: "Stop capture"}).click()
  const downloadPromise = page.waitForEvent("download")
  await panel.getByRole("button", {name: "Download"}).click()
  const download = await downloadPromise
  const downloadedPath = await download.path()
  if (!downloadedPath) throw new Error("Diagnostics download did not produce a local file")
  const bytes = await readFile(downloadedPath)
  const decoded = download.suggestedFilename().endsWith(".gz") ? gunzipSync(bytes) : bytes
  const artifact = JSON.parse(decoded.toString("utf8")) as {
    schema?: string
    schemaVersion?: number
    runs?: Array<{route?: string; milestones?: Array<{name?: string}>}>
  }

  expect(artifact.schema).toBe("budabit-performance-run-v1")
  expect(artifact.schemaVersion).toBe(1)
  expect(
    artifact.runs?.some(
      run => run.route?.startsWith("/c/") && run.milestones?.some(item => item.name === "settled"),
    ),
  ).toBe(true)
  const output = path.resolve("test-results/performance-roots")
  await mkdir(output, {recursive: true})
  await writeFile(path.join(output, `${profile}-diagnostic.json.gz`), bytes)
}

test("measures Community Home and git with cold data and warm atomic assets", async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === "mobile-4x") {
    const session = await page.context().newCDPSession(page)
    await session.send("Emulation.setCPUThrottlingRate", {rate: 4})
  }
  await page.addInitScript(() => {
    if (location.pathname === "/git") {
      localStorage.removeItem("budabit/community-session")
      localStorage.setItem("git:selected-mode", JSON.stringify("personal"))
      localStorage.setItem("git:selected-tab", JSON.stringify("my-repos"))
    }
  })
  await seedDevSession(page)
  await page.addInitScript(
    ({widgetId, installedWidget}) => {
      localStorage.setItem(
        "flotilla/extensions",
        JSON.stringify({
          enabled: [widgetId],
          disabledDefaultIds: [],
          installed: {widget: {[widgetId]: installedWidget}},
          widgetInstallSources: {
            [widgetId]: {relays: ["wss://performance-roots.example"]},
          },
        }),
      )
    },
    {widgetId, installedWidget},
  )
  await page.addInitScript(() => {
    const entries: Array<{startTime: number; duration: number}> = []
    ;(
      window as unknown as {
        __performanceRootLongTasks: typeof entries
      }
    ).__performanceRootLongTasks = entries
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          entries.push({startTime: entry.startTime, duration: entry.duration})
        }
      }).observe({type: "longtask", buffered: true} as PerformanceObserverInit)
    } catch {
      // Long Task API is unavailable outside Chromium.
    }
  })
  const mockRelay = new MockRelay({
    seedEvents: [definition, ...rooms, widget, widgetTarget, ...repositories],
    latency: 25,
  })
  await mockRelay.setup(page)
  const routes = [`/c/${communityNaddr}`, "/git"]
  const measurements: Measurement[] = []

  for (const route of routes) {
    measurements.push(await measure(page, mockRelay, route, "cold-data"))
    if (route !== "/git") await captureDiagnosticArtifact(page, testInfo.project.name)
  }
  await waitForCacheComplete(page)
  for (const route of routes)
    measurements.push(await measure(page, mockRelay, route, "warm-assets"))

  expect(measurements.every(entry => entry.relay.some(item => item.type === "req"))).toBe(true)
  expect(measurements.every(entry => entry.relay.every(item => item.type !== "external"))).toBe(
    true,
  )
  const output = path.resolve("test-results/performance-roots")
  await mkdir(output, {recursive: true})
  await writeFile(
    path.join(output, `${testInfo.project.name}.json`),
    `${JSON.stringify({schema: "budabit-performance-roots-v1", profile: testInfo.project.name, measurements}, null, 2)}\n`,
  )
})
