import {defineConfig, devices} from "@playwright/test"

const baseURL = "http://localhost:1849"

export default defineConfig({
  testDir: "./tests/performance-roots",
  testMatch: "**/*.e2e.ts",
  globalTeardown: "./tests/performance-roots/global-teardown.ts",
  outputDir: "./test-results/playwright-performance",
  reporter: [["line"]],
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: {timeout: 45_000},
  projects: [
    {name: "desktop", use: {...devices["Desktop Chrome"], baseURL}},
    {name: "mobile-4x", use: {...devices["Pixel 7"], baseURL}},
  ],
  webServer: {
    command: process.env.PERF_REUSE_BUILD
      ? "node tests/performance-roots/static-server.mjs"
      : "node tests/performance-roots/prepare-build.mjs && node tests/performance-roots/static-server.mjs",
    url: `${baseURL}/__perf/state`,
    reuseExistingServer: false,
    timeout: 900_000,
  },
})
