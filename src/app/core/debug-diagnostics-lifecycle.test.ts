import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

describe("root debug diagnostics lifecycle", () => {
  it("loads settings before installing gated diagnostics with synchronous cleanup", () => {
    const source = readFileSync("src/routes/+layout.svelte", "utf8")
    const refresh = source.indexOf("refreshDebugDiagnosticsSettings()")
    const install = source.indexOf("installRelayDebugDiagnostics({")

    expect(refresh).toBeGreaterThan(-1)
    expect(install).toBeGreaterThan(refresh)
    expect(source).toContain("enabled: browser && DIAGNOSTICS_ENABLED")
    expect(source).toContain("installRelayDiagnostics({enabled: browser && dev})")
    expect(source).toContain("onDestroy(uninstallRelayDebugDiagnostics)")
    expect(source).toContain("uninstallRelayDebugDiagnostics()")
    expect(source).toContain("installPublicationDebugDiagnostics({")
    expect(source).toContain("onDestroy(uninstallPublicationDebugDiagnostics)")
    expect(source).toContain("uninstallPublicationDebugDiagnostics()")
  })

  it("gates app-update tracing and correlates worker activation outcomes", () => {
    const layout = readFileSync("src/routes/+layout.svelte", "utf8")
    const worker = readFileSync("src/service-worker.js", "utf8")

    expect(layout).toContain("if (!DIAGNOSTICS_ENABLED) return false")
    expect(layout).toContain("diagnostics: DIAGNOSTICS_ENABLED &&")
    expect(layout).toContain('recordAppUpdateDebugDiagnostic("skip-waiting-posted"')
    expect(layout).toContain('recordAppUpdateDebugDiagnostic("active-worker-fetch-activity"')
    expect(worker).toContain('data?.type === "APP_CACHE_GET_FETCH_ACTIVITY"')
    expect(worker).toContain("trackFetchResponse(request")
    expect(worker).toContain('reportActivation("APP_CACHE_SKIP_WAITING_RECEIVED")')
    expect(worker).toContain('reportActivation("APP_CACHE_SKIP_WAITING_RESOLVED"')
    expect(worker).toContain('reportActivation("APP_CACHE_SKIP_WAITING_REJECTED"')
    expect(worker).toContain("const activation = self.skipWaiting()")
    expect(worker).not.toContain("event.waitUntil(activation)")
    expect(layout).toContain("if (appUpdateReloading) return")
    const controllerWait = layout.indexOf("const waitForControllerBuild")
    const controllerListener = layout.indexOf("return await new Promise<boolean>", controllerWait)
    expect(layout.slice(controllerWait, controllerListener)).not.toContain(
      "getServiceWorkerVersion",
    )
  })
})
