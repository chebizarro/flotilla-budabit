import {writable} from "svelte/store"
import {describe, expect, it, vi} from "vitest"
import type {PublicationLifecycleObservation} from "@welshman/app"
import {defaultDebugDiagnosticsSettings} from "./debug-diagnostics"
import {installPublicationDebugDiagnostics} from "./publication-diagnostics"

describe("publication debug diagnostics", () => {
  it("subscribes only while the category is enabled and cleans up", () => {
    const settings = writable(defaultDebugDiagnosticsSettings())
    const record = vi.fn(() => true)
    const unsubscribe = vi.fn()
    let listener: ((event: PublicationLifecycleObservation) => void) | undefined
    const subscribe = vi.fn(callback => {
      listener = callback
      return unsubscribe
    })
    const uninstall = installPublicationDebugDiagnostics({
      enabled: true,
      settings,
      record,
      subscribe,
    })

    expect(subscribe).not.toHaveBeenCalled()
    settings.update(current => ({
      ...current,
      categories: {...current.categories, "publication-lifecycle": true},
    }))
    expect(subscribe).toHaveBeenCalledOnce()

    listener?.({
      type: "result",
      publicationId: "publication-1",
      eventKind: 1,
      attempt: 1,
      relay: "wss://relay.example/",
      status: "success" as never,
    })
    expect(record).toHaveBeenCalledWith(
      "publication-lifecycle",
      "result",
      expect.objectContaining({publicationId: "publication-1", eventKind: 1}),
    )

    settings.set(defaultDebugDiagnosticsSettings())
    expect(unsubscribe).toHaveBeenCalledOnce()
    uninstall()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it("does nothing when the build gate is disabled", () => {
    const subscribe = vi.fn()
    const uninstall = installPublicationDebugDiagnostics({enabled: false, subscribe})

    expect(subscribe).not.toHaveBeenCalled()
    expect(() => uninstall()).not.toThrow()
  })
})
