// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {EVENT_TIME, THREAD, type TrustedEvent} from "@welshman/util"
import {finalizeEvent} from "nostr-tools/pure"
import {
  COMMUNITY_DEFINITION_KIND,
  COMMUNITY_SUBTYPE_ROOM,
  COMMUNITY_SUBTYPE_THREADS,
  PROFILE_LIST_KIND,
  TARGETED_PUBLICATION_KIND,
  parseCommunityDefinition,
} from "@app/core/community"
import {
  makeAddressablePublicationRef,
  makeTargetedPublicationForCommunity,
} from "@app/core/community-targeting"

const mocks = vi.hoisted(() => {
  const createStore = <T>(initial: T) => {
    let value = initial

    return {
      get: vi.fn(() => value),
      set: vi.fn((next: T) => {
        value = next
      }),
      subscribe: vi.fn((run: (value: T) => void) => {
        run(value)
        return () => {}
      }),
    }
  }

  const load = vi.fn()
  const request = vi.fn()
  const loadCommunityEvents = vi.fn(async (relays: string[], filters: any[], options?: any) => {
    const events: any[] = []
    await load({
      relays,
      filters,
      options,
      onEvent: (event: any) => events.push(event),
    })

    return events
  })
  const loadCommunityEventsWithStatus = vi.fn(
    async (relays: string[], filters: any[], options?: any) => ({
      events: await loadCommunityEvents(relays, filters, options),
      complete: true,
      timedOutRelays: [],
      failedRelays: [],
    }),
  )
  const authenticateCommunityRelays = vi.fn(async () => undefined)
  const getPubkeyOutboxRelays = vi.fn(() => [] as string[])

  return {
    publishThunk: vi.fn(),
    load,
    request,
    loadCommunityEvents,
    loadCommunityEventsWithStatus,
    authenticateCommunityRelays,
    getPubkeyOutboxRelays,
    pushToast: vi.fn(),
    repository: {query: vi.fn(() => [] as any[])},
    signer: createStore(null),
    pubkey: createStore(undefined as string | undefined),
    goto: vi.fn(),
    activeRepoClass: createStore(null),
    activeCommunityDefinition: createStore(undefined as any),
    activeCommunityPermissionStatus: createStore({
      communityPubkey: "",
      key: "",
      loading: false,
      loaded: false,
      hasCachedEvents: false,
    }),
    activeCommunityProfileListEvents: createStore([] as any[]),
    activeCommunityRelayHints: createStore([] as string[]),
    activeCommunityRelays: createStore([] as string[]),
    activeCommunityPublishRelays: createStore([] as string[]),
    activeCommunityReportState: createStore(undefined as any),
  }
})

const communityPubkey = "a".repeat(64)
const calendarWriterPubkey = "b".repeat(64)
const calendarMemberPubkey = "c".repeat(64)
const outsiderPubkey = "d".repeat(64)
const zapStreamProviderPubkey = "cf45a6ba1363ad7ed213a078e710d24115ae721c9b47bd1ebf4458eaefb4c2a5"

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: communityPubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const communityDefinition = parseCommunityDefinition(
  makeEvent({
    kind: COMMUNITY_DEFINITION_KIND,
    pubkey: communityPubkey,
    tags: [
      ["content", "Events and meetups"],
      ["k", String(EVENT_TIME)],
      ["a", `${PROFILE_LIST_KIND}:${calendarWriterPubkey}:Events and meetups`],
    ],
  }),
)!
const communityDefinitionWithRelays = parseCommunityDefinition(
  makeEvent({
    kind: COMMUNITY_DEFINITION_KIND,
    pubkey: communityPubkey,
    tags: [
      ["r", "wss://relay.example.com/"],
      ["content", "Events and meetups"],
      ["k", String(EVENT_TIME)],
      ["a", `${PROFILE_LIST_KIND}:${calendarWriterPubkey}:Events and meetups`],
    ],
  }),
)!

const calendarProfileList = makeEvent({
  kind: PROFILE_LIST_KIND,
  pubkey: calendarWriterPubkey,
  tags: [
    ["d", "Events and meetups"],
    ["p", calendarWriterPubkey],
    ["p", calendarMemberPubkey],
  ],
})

const calendarTargetingEvent = makeEvent({
  id: "target-1",
  pubkey: calendarWriterPubkey,
  kind: TARGETED_PUBLICATION_KIND,
  tags: makeTargetedPublicationForCommunity({
    targetingId: "target-1",
    originalKind: EVENT_TIME,
    originalRef: makeAddressablePublicationRef({
      kind: EVENT_TIME,
      pubkey: calendarWriterPubkey,
      identifier: "event-1",
      relay: "wss://relay.example.com/",
    }),
    communityPubkey,
    communityRelay: "wss://relay.example.com/",
  }).tags,
})

const calendarEvent = makeEvent({
  id: "calendar-event-1",
  pubkey: calendarWriterPubkey,
  kind: EVENT_TIME,
  tags: [
    ["d", "event-1"],
    ["title", "Community meetup"],
  ],
})
const calendarEventRef = `${EVENT_TIME}:${calendarWriterPubkey}:event-1`

vi.mock("@welshman/app", () => ({
  publishThunk: mocks.publishThunk,
  repository: mocks.repository,
  signer: mocks.signer,
  pubkey: mocks.pubkey,
}))

vi.mock("$app/navigation", () => ({
  goto: mocks.goto,
}))

vi.mock("@app/core/git-state", () => ({
  activeRepoClass: mocks.activeRepoClass,
}))

vi.mock("@app/core/community-state", () => ({
  activeCommunityDefinition: mocks.activeCommunityDefinition,
  activeCommunityPermissionStatus: mocks.activeCommunityPermissionStatus,
  activeCommunityProfileListEvents: mocks.activeCommunityProfileListEvents,
  activeCommunityRelayHints: mocks.activeCommunityRelayHints,
  activeCommunityRelays: mocks.activeCommunityRelays,
  activeCommunityPublishRelays: mocks.activeCommunityPublishRelays,
  activeCommunityReportState: mocks.activeCommunityReportState,
  authenticateCommunityRelays: mocks.authenticateCommunityRelays,
  getCommunityBootstrapRelays: vi.fn((relays: string[] = []) => relays),
  getCommunityPermissionStatusKeyPrefix: vi.fn(() => "expected:"),
  getCommunityPermissionReadiness: vi.fn(
    ({status, communityPubkey}: {status: any; communityPubkey: string}) => {
      if (status.communityPubkey !== communityPubkey || !status.key.startsWith("expected:")) {
        return "loading"
      }
      if (status.hasCachedEvents) return "ready"
      if (status.loading && !status.loaded) return "loading"
      return status.complete ? "ready" : "unavailable"
    },
  ),
  getPubkeyOutboxRelays: mocks.getPubkeyOutboxRelays,
  loadCommunityEvents: mocks.loadCommunityEvents,
  loadCommunityEventsWithStatus: mocks.loadCommunityEventsWithStatus,
}))

vi.mock("@welshman/net", () => ({
  PublishStatus: {Success: "success"},
  load: mocks.load,
  request: mocks.request,
}))

vi.mock("@app/util/toast", () => ({
  pushToast: mocks.pushToast,
}))

type FakeWindow = {
  postMessage: ReturnType<typeof vi.fn>
}

const makeSourceWindow = (): FakeWindow => ({
  postMessage: vi.fn(),
})

const makeExtension = (overrides: Record<string, any> = {}) => {
  const iframeWindow = makeSourceWindow()
  const widget = {
    id: "test-widget-event",
    kind: 30033,
    content: "Test",
    pubkey: "a".repeat(64),
    tags: [["d", "test-widget"]],
    identifier: "test-widget",
    widgetType: "tool",
    buttons: [],
    permissions: [],
    ...(overrides.widget || {}),
  }

  return {
    id: "test-extension",
    origin: "https://widget.example.com",
    type: "widget",
    iframe: {contentWindow: iframeWindow},
    repoContext: null,
    ...overrides,
    widget,
    iframeWindow,
  }
}

const storagePermissions = ["storage:get", "storage:set", "storage:keys", "storage:remove"]

const makeStorageExtension = (overrides: Record<string, any> = {}) =>
  makeExtension({
    widget: {permissions: storagePermissions},
    ...overrides,
  })

const makeWidgetStorageExtension = (overrides: Record<string, any> = {}) =>
  makeExtension({
    type: "widget",
    widget: {
      id: "weather-event",
      kind: 30033,
      content: "Weather",
      pubkey: "a".repeat(64),
      tags: [["d", "weather"]],
      identifier: "weather",
      widgetType: "tool",
      buttons: [],
      permissions: storagePermissions,
    },
    ...overrides,
  })

const sendBridgeRequest = async (
  bridge: any,
  extension: any,
  action: string,
  payload: Record<string, any>,
) => {
  const source = makeSourceWindow()
  await bridge.handleMessage({
    data: {id: `${action}-request`, type: "request", action, payload},
    source,
    origin: extension.origin,
  } as any)

  return source.postMessage.mock.calls.at(-1)?.[0].payload
}

const getLocalStorageKeys = () =>
  Array.from({length: localStorage.length}, (_, index) => localStorage.key(index)).filter(Boolean)

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  localStorage.clear()
  mocks.publishThunk.mockReturnValue({complete: Promise.resolve(), results: {}})
  mocks.load.mockResolvedValue(undefined)
  mocks.request.mockImplementation((options: any) => {
    options.onStart?.(options.relays[0])
    return new Promise(resolve => {
      options.signal?.addEventListener("abort", () => resolve([]), {once: true})
    })
  })
  mocks.repository.query.mockReturnValue([])
  mocks.getPubkeyOutboxRelays.mockReturnValue([])
  mocks.goto.mockResolvedValue(undefined)
  mocks.pubkey.set(undefined)
  mocks.activeRepoClass.set(null)
  mocks.activeCommunityDefinition.set(undefined)
  mocks.activeCommunityPermissionStatus.set({
    communityPubkey: "",
    key: "",
    loading: false,
    loaded: false,
    hasCachedEvents: false,
  })
  mocks.activeCommunityProfileListEvents.set([])
  mocks.activeCommunityRelayHints.set([])
  mocks.activeCommunityRelays.set([])
  mocks.activeCommunityPublishRelays.set([])
  mocks.activeCommunityReportState.set(undefined)
})

afterEach(() => {
  localStorage.clear()
})

describe("ExtensionBridge", () => {
  it("posts events to the extension origin and uses '*' only for sandboxed iframes", async () => {
    const {ExtensionBridge} = await import("./bridge")

    const extension = makeExtension()
    const bridge = new ExtensionBridge(extension as any)
    bridge.post("ui:toast", {message: "hello"})

    expect(extension.iframeWindow.postMessage).toHaveBeenCalledWith(
      {type: "event", action: "ui:toast", payload: {message: "hello"}},
      "https://widget.example.com",
    )

    const sandboxed = makeExtension({origin: "null"})
    const sandboxedBridge = new ExtensionBridge(sandboxed as any)
    sandboxedBridge.post("ui:toast", {message: "hello"})

    expect(sandboxed.iframeWindow.postMessage).toHaveBeenCalledWith(
      {type: "event", action: "ui:toast", payload: {message: "hello"}},
      "*",
    )
  })

  it("authenticates active community relays before publishing to them", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const communityRelay = "wss://community.example.com/"
    const publicRelay = "wss://public.example.com/"
    mocks.activeCommunityRelays.set([communityRelay])
    mocks.activeCommunityPublishRelays.set([communityRelay])
    mocks.activeCommunityRelayHints.set([communityRelay])
    mocks.publishThunk.mockReturnValue({
      complete: Promise.resolve(),
      results: {
        [communityRelay]: {status: "success"},
        [publicRelay]: {status: "success"},
      },
    })

    const extension = makeExtension({widget: {permissions: ["nostr:publish"]}})
    const bridge = new ExtensionBridge(extension as any)
    const response = await sendBridgeRequest(bridge, extension, "nostr:publish", {
      event: {kind: 30311, created_at: 1, content: "", tags: []},
      relays: [communityRelay, publicRelay],
    })

    expect(mocks.authenticateCommunityRelays).toHaveBeenCalledWith([communityRelay], {
      priorityRelays: [communityRelay],
    })
    expect(mocks.authenticateCommunityRelays.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.publishThunk.mock.invocationCallOrder[0],
    )
    expect(response.result.successCount).toBe(2)
  })

  it("rejects community-scoped events from generic nostr publishing", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const extension = makeExtension({widget: {permissions: ["nostr:publish"]}})
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "nostr:publish", {
        event: {
          kind: 30311,
          created_at: 1,
          content: "",
          tags: [["h", communityPubkey]],
        },
        relays: ["wss://relay.example.com/"],
      }),
    ).resolves.toEqual({
      error: "Community-scoped events must use a dedicated community publish capability",
    })
    expect(mocks.publishThunk).not.toHaveBeenCalled()

    await expect(
      sendBridgeRequest(bridge, extension, "nostr:publish", {
        event: {kind: 30222, created_at: 1, content: "", tags: [["d", "target"]]},
        relays: ["wss://relay.example.com/"],
      }),
    ).resolves.toEqual({
      error: "Community-scoped events must use a dedicated community publish capability",
    })
    expect(mocks.publishThunk).not.toHaveBeenCalled()
  })

  it("verifies externally signed events before publishing", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const relay = "wss://relay.example.com/"
    const signedEvent = finalizeEvent(
      {kind: 30311, created_at: 1, content: "", tags: []},
      new Uint8Array(32).fill(1),
    )
    const extension = makeExtension({widget: {permissions: ["nostr:publish"]}})
    const bridge = new ExtensionBridge(extension as any)
    mocks.publishThunk.mockReturnValue({
      complete: Promise.resolve(),
      results: {[relay]: {status: "success"}},
      event: signedEvent,
    })

    await expect(
      sendBridgeRequest(bridge, extension, "nostr:publish", {
        event: signedEvent,
        relays: [relay],
      }),
    ).resolves.toMatchObject({status: "ok", result: {eventId: signedEvent.id, successCount: 1}})

    mocks.publishThunk.mockClear()
    await expect(
      sendBridgeRequest(bridge, extension, "nostr:publish", {
        event: {...signedEvent, content: "tampered"},
        relays: [relay],
      }),
    ).resolves.toEqual({error: "Externally signed event failed cryptographic verification"})
    expect(mocks.publishThunk).not.toHaveBeenCalled()
  })

  it("returns failure when generic publishing is not accepted by any relay", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const extension = makeExtension({widget: {permissions: ["nostr:publish"]}})
    const bridge = new ExtensionBridge(extension as any)
    mocks.publishThunk.mockReturnValue({complete: Promise.resolve(), results: {}})

    await expect(
      sendBridgeRequest(bridge, extension, "nostr:publish", {
        event: {kind: 30311, created_at: 1, content: "", tags: []},
        relays: ["wss://relay.example.com/"],
      }),
    ).resolves.toEqual({error: "Event was not accepted by any relay"})
  })

  it("rejects privileged actions when the extension does not have permission", async () => {
    const {ExtensionBridge} = await import("./bridge")

    const extension = makeExtension()
    const bridge = new ExtensionBridge(extension as any)
    const source = makeSourceWindow()

    await bridge.handleMessage({
      data: {id: "req-1", type: "request", action: "storage:get", payload: {key: "secret"}},
      source,
      origin: extension.origin,
    } as any)

    expect(source.postMessage).toHaveBeenCalledWith(
      {
        id: "req-1",
        type: "response",
        action: "storage:get",
        payload: {error: 'Extension not permitted to perform "storage:get"'},
      },
      extension.origin,
    )
  })

  it("returns host subscription IDs, forwards matched events, and cleans up on detach", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const extension = makeExtension({
      widget: {permissions: ["nostr:subscribe", "nostr:unsubscribe"]},
    })
    const bridge = new ExtensionBridge(extension as any)

    const response = await sendBridgeRequest(bridge, extension, "nostr:subscribe", {
      subscriptionId: "client-selected-id",
      relays: ["wss://relay.example"],
      filter: {kinds: [30301], "#d": ["board"], limit: 20},
    })

    expect(response).toMatchObject({status: "ok", subscriptionId: expect.stringMatching(/^sub-/)})
    expect(response.subscriptionId).not.toBe("client-selected-id")
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        relays: ["wss://relay.example/"],
        lifetime: "live",
        priority: -100,
        owner: "extension:test-extension",
      }),
    )

    const options = mocks.request.mock.calls[0][0]
    options.onEvent(makeEvent({kind: 30301, tags: [["d", "board"]]}), "wss://relay.example/")
    expect(extension.iframeWindow.postMessage).toHaveBeenCalledWith(
      {
        type: "event",
        action: "nostr:subscription:event",
        payload: {
          subscriptionId: response.subscriptionId,
          event: expect.objectContaining({kind: 30301}),
        },
      },
      extension.origin,
    )

    bridge.detach()
    expect(options.signal.aborted).toBe(true)
  })

  it("navigates the host app through ui:navigate", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const extension = makeExtension()
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "ui:navigate", {
        path: "/c/npub1example/calendar/event-1",
      }),
    ).resolves.toEqual({status: "ok"})
    expect(mocks.goto).toHaveBeenCalledWith("/c/npub1example/calendar/event-1")

    await expect(
      sendBridgeRequest(bridge, extension, "ui:navigate", {path: "https://example.com/"}),
    ).resolves.toEqual({error: "Invalid navigation path"})
  })

  it("forwards ui:resize requests to the widget resize callback", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const onResizeRequest = vi.fn()
    const extension = makeExtension({onResizeRequest})
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "ui:resize", {height: 640, width: 320}),
    ).resolves.toEqual({status: "ok"})
    expect(onResizeRequest).toHaveBeenCalledWith({height: 640, width: 320})
  })

  it("rejects invalid ui:resize dimensions", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const onResizeRequest = vi.fn()
    const extension = makeExtension({onResizeRequest})
    const bridge = new ExtensionBridge(extension as any)

    await expect(sendBridgeRequest(bridge, extension, "ui:resize", {height: -1})).resolves.toEqual({
      error: "Invalid resize height: expected positive finite number",
    })
    await expect(sendBridgeRequest(bridge, extension, "ui:resize", {})).resolves.toEqual({
      error: "Invalid resize payload: expected positive finite height or width",
    })
    expect(onResizeRequest).not.toHaveBeenCalled()
  })

  it("writes storage values to encoded v2 keys and reports decoded keys", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const extension = makeStorageExtension({id: "ext:with/slash"})
    const bridge = new ExtensionBridge(extension as any)
    const storageKey = "theme:color"
    const expectedKey = "budabit:ext:v2:ext%3Awith%2Fslash:global:theme%3Acolor"

    await expect(
      sendBridgeRequest(bridge, extension, "storage:set", {
        key: storageKey,
        data: {mode: "dark"},
      }),
    ).resolves.toEqual({status: "ok"})

    expect(localStorage.getItem(expectedKey)).toBe(JSON.stringify({mode: "dark"}))
    expect(localStorage.getItem("flotilla:ext:ext:with/slash:theme:color")).toBeNull()

    await expect(
      sendBridgeRequest(bridge, extension, "storage:get", {key: storageKey}),
    ).resolves.toEqual({status: "ok", data: {mode: "dark"}})
    await expect(sendBridgeRequest(bridge, extension, "storage:keys", {})).resolves.toEqual({
      status: "ok",
      keys: [storageKey],
    })

    await expect(
      sendBridgeRequest(bridge, extension, "storage:remove", {key: storageKey}),
    ).resolves.toEqual({status: "ok"})
    expect(localStorage.getItem(expectedKey)).toBeNull()
  })

  it("falls back to legacy storage keys without duplicating storage:keys results", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const extension = makeStorageExtension({id: "legacy-ext"})
    const bridge = new ExtensionBridge(extension as any)

    localStorage.setItem("flotilla:ext:legacy-ext:settings", JSON.stringify({legacy: true}))
    localStorage.setItem("flotilla:ext:legacy-ext:other", JSON.stringify({old: true}))
    localStorage.setItem("budabit:ext:v2:legacy-ext:global:settings", JSON.stringify({v2: true}))

    await expect(
      sendBridgeRequest(bridge, extension, "storage:get", {key: "settings"}),
    ).resolves.toEqual({status: "ok", data: {v2: true}})
    await expect(sendBridgeRequest(bridge, extension, "storage:keys", {})).resolves.toEqual({
      status: "ok",
      keys: ["settings", "other"],
    })
  })

  it("encodes repo-scoped storage with the repo address component", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const repoContext = {pubkey: "a".repeat(64), name: "repo:name"}
    const extension = makeStorageExtension({id: "repo-ext", repoContext})
    const bridge = new ExtensionBridge(extension as any)
    const expectedRepoAddress = `30617:${repoContext.pubkey}:${repoContext.name}`
    const expectedKey = `budabit:ext:v2:repo-ext:repo:${encodeURIComponent(expectedRepoAddress)}:build%3Astate`

    await expect(
      sendBridgeRequest(bridge, extension, "storage:set", {
        key: "build:state",
        repoScoped: true,
        data: {status: "green"},
      }),
    ).resolves.toEqual({status: "ok"})

    expect(localStorage.getItem(expectedKey)).toBe(JSON.stringify({status: "green"}))
    expect(getLocalStorageKeys().some(key => key?.includes(`repo:${repoContext.pubkey}:`))).toBe(
      false,
    )

    await expect(
      sendBridgeRequest(bridge, extension, "storage:get", {
        key: "build:state",
        repoScoped: true,
      }),
    ).resolves.toEqual({status: "ok", data: {status: "green"}})
  })

  it("reads legacy repo-scoped storage when no v2 value exists", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const repoContext = {pubkey: "b".repeat(64), name: "repo"}
    const extension = makeStorageExtension({id: "repo-ext", repoContext})
    const bridge = new ExtensionBridge(extension as any)

    localStorage.setItem(
      `flotilla:ext:repo-ext:repo:${repoContext.pubkey}:${repoContext.name}:settings`,
      JSON.stringify({legacyRepo: true}),
    )

    await expect(
      sendBridgeRequest(bridge, extension, "storage:get", {key: "settings", repoScoped: true}),
    ).resolves.toEqual({status: "ok", data: {legacyRepo: true}})
  })

  it("falls back to bare widget identifier legacy storage for canonical widget ids", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const extension = makeWidgetStorageExtension({id: `30033:${"a".repeat(64)}:weather`})
    const bridge = new ExtensionBridge(extension as any)

    localStorage.setItem("flotilla:ext:weather:prefs", JSON.stringify({legacyWidget: true}))

    await expect(
      sendBridgeRequest(bridge, extension, "storage:get", {key: "prefs"}),
    ).resolves.toEqual({status: "ok", data: {legacyWidget: true}})
    await expect(sendBridgeRequest(bridge, extension, "storage:keys", {})).resolves.toEqual({
      status: "ok",
      keys: ["prefs"],
    })
  })

  it("stores same-d widgets from different publishers under separate v2 keys", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const first = makeWidgetStorageExtension({id: `30033:${"a".repeat(64)}:weather`})
    const second = makeWidgetStorageExtension({
      id: `30033:${"b".repeat(64)}:weather`,
      widget: {
        ...makeWidgetStorageExtension().widget,
        pubkey: "b".repeat(64),
        permissions: storagePermissions,
      },
    })
    const firstBridge = new ExtensionBridge(first as any)
    const secondBridge = new ExtensionBridge(second as any)

    await sendBridgeRequest(firstBridge, first, "storage:set", {key: "prefs", data: {unit: "c"}})
    await sendBridgeRequest(secondBridge, second, "storage:set", {key: "prefs", data: {unit: "f"}})

    await expect(
      sendBridgeRequest(firstBridge, first, "storage:get", {key: "prefs"}),
    ).resolves.toEqual({status: "ok", data: {unit: "c"}})
    await expect(
      sendBridgeRequest(secondBridge, second, "storage:get", {key: "prefs"}),
    ).resolves.toEqual({status: "ok", data: {unit: "f"}})

    expect(getLocalStorageKeys().sort()).toEqual([
      `budabit:ext:v2:30033%3A${"a".repeat(64)}%3Aweather:global:prefs`,
      `budabit:ext:v2:30033%3A${"b".repeat(64)}%3Aweather:global:prefs`,
    ])
  })

  it("ignores messages from the wrong origin or source window", async () => {
    const {ExtensionBridge} = await import("./bridge")

    const targetWindow = makeSourceWindow()
    const bridge = new ExtensionBridge(makeExtension() as any)
    bridge.attachHandlers(targetWindow as any)

    const wrongOriginSource = makeSourceWindow()
    await bridge.handleMessage({
      data: {id: "req-1", type: "request", action: "ui:toast", payload: {message: "hello"}},
      source: wrongOriginSource,
      origin: "https://evil.example.com",
    } as any)

    const wrongSource = makeSourceWindow()
    await bridge.handleMessage({
      data: {id: "req-2", type: "request", action: "ui:toast", payload: {message: "hello"}},
      source: wrongSource,
      origin: "https://widget.example.com",
    } as any)

    expect(mocks.pushToast).not.toHaveBeenCalled()
    expect(wrongOriginSource.postMessage).not.toHaveBeenCalled()
    expect(wrongSource.postMessage).not.toHaveBeenCalled()

    bridge.detach()
  })

  it("routes matching responses back to the pending request promise", async () => {
    const {ExtensionBridge} = await import("./bridge")

    const extension = makeExtension()
    const bridge = new ExtensionBridge(extension as any)
    const requestPromise = bridge.request("ui:toast", {message: "hello"})

    const [message, origin] = extension.iframeWindow.postMessage.mock.calls[0]
    expect(origin).toBe(extension.origin)

    await bridge.handleMessage({
      data: {
        id: message.id,
        type: "response",
        action: "ui:toast",
        payload: {status: "ok"},
      },
      source: extension.iframe.contentWindow,
      origin: extension.origin,
    } as any)

    await expect(requestPromise).resolves.toEqual({status: "ok"})
  })

  it("checks descriptor write capabilities through active section mappings", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.pubkey.set(calendarWriterPubkey)

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:checkWriteCapabilities"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:checkWriteCapabilities", {
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toMatchObject({
      status: "ok",
      contextSessionId: expect.any(String),
      contextVersion: 0,
      capabilities: [
        {
          descriptor: {kind: EVENT_TIME},
          sectionNames: ["Events and meetups"],
          writableSectionNames: ["Events and meetups"],
          moderatorSectionNames: ["Events and meetups"],
          canWrite: true,
          canModerate: true,
        },
      ],
    })
  })

  it("checks descriptor write capabilities through extension runtime context", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.pubkey.set(calendarMemberPubkey)

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:checkWriteCapabilities"],
      },
      communityRuntimeContext: {
        definition: communityDefinition,
        profileListEvents: [calendarProfileList],
        relays: ["wss://preview.example.com/"],
        relayHints: ["wss://preview.example.com/"],
        communityContext: {
          version: 1,
          contextSessionId: "preview-community-context",
          contextVersion: 3,
          pubkey: communityPubkey,
          ncommunity: "",
          relays: ["wss://preview.example.com/"],
          relayHints: ["wss://preview.example.com/"],
          blossomServers: [],
          sections: [],
          viewer: {pubkey: calendarMemberPubkey, isOwner: false, isBanned: false},
        },
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:checkWriteCapabilities", {
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toMatchObject({
      status: "ok",
      contextSessionId: "preview-community-context",
      contextVersion: 3,
      capabilities: [
        {
          descriptor: {kind: EVENT_TIME},
          writableSectionNames: ["Events and meetups"],
          moderatorSectionNames: [],
          canWrite: true,
          canModerate: false,
        },
      ],
    })
    expect(mocks.loadCommunityEvents).not.toHaveBeenCalled()
  })

  it("resolves a fresh extension runtime context for every community request", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const revokedCalendarProfileList = makeEvent({
      id: "calendar-profile-list-revoked",
      created_at: 2,
      kind: PROFILE_LIST_KIND,
      pubkey: calendarWriterPubkey,
      tags: [
        ["d", "Events and meetups"],
        ["p", calendarWriterPubkey],
      ],
    })
    const makeRuntimeContext = (profileListEvents: TrustedEvent[], contextVersion: number) => ({
      definition: communityDefinition,
      profileListEvents,
      relays: ["wss://preview.example.com/"],
      relayHints: ["wss://preview.example.com/"],
      communityContext: {
        version: 1 as const,
        contextSessionId: "live-community-context",
        contextVersion,
        pubkey: communityPubkey,
        ncommunity: "",
        relays: ["wss://preview.example.com/"],
        relayHints: ["wss://preview.example.com/"],
        blossomServers: [],
        sections: [],
        viewer: {pubkey: calendarMemberPubkey, isOwner: false, isBanned: false},
      },
    })
    let runtimeContext: ReturnType<typeof makeRuntimeContext> | undefined = makeRuntimeContext(
      [calendarProfileList],
      1,
    )
    const runtimeContextProvider = vi.fn(() => runtimeContext)

    // These stale fallbacks must not win over the provider or its fail-closed result.
    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://stale.example.com/"])
    mocks.pubkey.set(calendarMemberPubkey)

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:checkWriteCapabilities"],
      },
      communityRuntimeContext: makeRuntimeContext([calendarProfileList], 0),
      communityRuntimeContextProvider: runtimeContextProvider,
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:checkWriteCapabilities", {
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toMatchObject({
      status: "ok",
      contextVersion: 1,
      capabilities: [expect.objectContaining({canWrite: true})],
    })

    runtimeContext = makeRuntimeContext([revokedCalendarProfileList], 2)
    await expect(
      sendBridgeRequest(bridge, extension, "community:checkWriteCapabilities", {
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toMatchObject({
      status: "ok",
      contextVersion: 2,
      capabilities: [expect.objectContaining({canWrite: false})],
    })

    runtimeContext = undefined
    await expect(
      sendBridgeRequest(bridge, extension, "community:checkWriteCapabilities", {
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toEqual({
      error: "Community runtime context is not available",
      code: "COMMUNITY_CONTEXT_NOT_READY",
    })
    expect(runtimeContextProvider).toHaveBeenCalledTimes(3)
  })

  it("recognizes descriptor writers without treating them as section moderators", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.pubkey.set(calendarMemberPubkey)

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:checkWriteCapabilities"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:checkWriteCapabilities", {
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toMatchObject({
      status: "ok",
      capabilities: [
        {
          descriptor: {kind: EVENT_TIME},
          writableSectionNames: ["Events and meetups"],
          moderatorSectionNames: [],
          canWrite: true,
          canModerate: false,
        },
      ],
    })
  })

  it("fails closed for definition-listed profile-list owners while their list event is missing", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.pubkey.set(calendarWriterPubkey)

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:checkWriteCapabilities"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:checkWriteCapabilities", {
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toEqual({
      error: "Community context is unavailable",
      code: "COMMUNITY_CONTEXT_NOT_READY",
    })
    expect(mocks.loadCommunityEvents).toHaveBeenCalled()
  })

  it("hydrates profile-list events before resolving descriptor capabilities", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.pubkey.set(calendarMemberPubkey)
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (filters?.[0]?.kinds?.[0] === PROFILE_LIST_KIND) onEvent?.(calendarProfileList)
    })

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:checkWriteCapabilities"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:checkWriteCapabilities", {
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toMatchObject({
      status: "ok",
      capabilities: [
        {
          writableSectionNames: ["Events and meetups"],
          moderatorSectionNames: [],
          canWrite: true,
          canModerate: false,
        },
      ],
    })
    expect(mocks.loadCommunityEvents).toHaveBeenCalledWith(
      ["wss://relay.example.com/"],
      expect.arrayContaining([
        expect.objectContaining({
          kinds: [PROFILE_LIST_KIND],
          authors: [calendarWriterPubkey],
          "#d": ["Events and meetups"],
        }),
      ]),
      expect.objectContaining({authenticate: true}),
    )
  })

  it("returns the latest moderator-authored shared config", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.pubkey.set(calendarMemberPubkey)
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (filters?.[0]?.kinds?.[0] !== 30078) return
      onEvent?.(
        makeEvent({
          id: "invalid-config",
          kind: 30078,
          pubkey: "d".repeat(64),
          created_at: 100,
          content: JSON.stringify({header: "Invalid", eventRefs: ["invalid"]}),
          tags: [["d", filters[0]["#d"][0]]],
        }),
      )
      onEvent?.(
        makeEvent({
          id: "valid-config",
          kind: 30078,
          pubkey: calendarWriterPubkey,
          created_at: 90,
          content: JSON.stringify({header: "Featured", eventRefs: [calendarEventRef]}),
          tags: [["d", filters[0]["#d"][0]]],
        }),
      )
    })

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:querySharedConfig"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:querySharedConfig", {
        namespace: "budabit-calendar-widget",
        key: "featured-calendar-event",
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toMatchObject({
      status: "ok",
      event: {id: "valid-config"},
      config: {header: "Featured", eventRefs: [calendarEventRef]},
    })
  })

  it("returns cached shared config before relay loads", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const cachedConfig = makeEvent({
      id: "cached-config",
      kind: 30078,
      pubkey: calendarWriterPubkey,
      created_at: 100,
      content: JSON.stringify({header: "Cached", eventRefs: [calendarEventRef]}),
      tags: [
        [
          "d",
          `budabit-community-config:${communityPubkey}:budabit-calendar-widget:featured-calendar-event`,
        ],
      ],
    })

    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.repository.query.mockReturnValue([cachedConfig])
    mocks.pubkey.set(calendarMemberPubkey)

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:querySharedConfig"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:querySharedConfig", {
        namespace: "budabit-calendar-widget",
        key: "featured-calendar-event",
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toMatchObject({
      status: "ok",
      event: {id: "cached-config"},
      config: {header: "Cached", eventRefs: [calendarEventRef]},
    })
    expect(mocks.loadCommunityEvents).not.toHaveBeenCalled()
  })

  it("fails closed for cached shared config while its required profile list is missing", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const cachedConfig = makeEvent({
      id: "pending-ref-config",
      kind: 30078,
      pubkey: calendarWriterPubkey,
      created_at: 100,
      content: JSON.stringify({header: "Cached", eventRefs: [calendarEventRef]}),
      tags: [
        [
          "d",
          `budabit-community-config:${communityPubkey}:budabit-calendar-widget:featured-calendar-event`,
        ],
      ],
    })

    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.repository.query.mockReturnValue([cachedConfig])

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:querySharedConfig"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:querySharedConfig", {
        namespace: "budabit-calendar-widget",
        key: "featured-calendar-event",
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toEqual({
      error: "Community context is unavailable",
      code: "COMMUNITY_CONTEXT_NOT_READY",
    })
    expect(mocks.loadCommunityEvents).toHaveBeenCalled()
  })

  it("returns not-ready for shared config while cached permission evidence is refreshing", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.activeCommunityPermissionStatus.set({
      communityPubkey,
      key: "permission-load",
      loading: true,
      loaded: false,
      hasCachedEvents: true,
    })
    mocks.pubkey.set(calendarMemberPubkey)

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:querySharedConfig"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:querySharedConfig", {
        namespace: "budabit-calendar-widget",
        key: "featured-calendar-event",
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toEqual({
      error: "Community context is still loading",
      code: "COMMUNITY_CONTEXT_NOT_READY",
    })
    expect(mocks.loadCommunityEvents).not.toHaveBeenCalled()
  })

  it("only lets descriptor moderators publish shared config", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeCommunityDefinition.set(communityDefinitionWithRelays)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.activeCommunityPublishRelays.set(["wss://relay.example.com/"])
    mocks.pubkey.set(calendarMemberPubkey)

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:publishSharedConfig"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:publishSharedConfig", {
        namespace: "budabit-calendar-widget",
        key: "featured-calendar-event",
        descriptors: [{kind: EVENT_TIME}],
        config: {header: "Featured", eventRefs: [calendarEventRef]},
      }),
    ).resolves.toMatchObject({
      error: "Current user is not a moderator for the requested community descriptors",
    })

    mocks.pubkey.set(calendarWriterPubkey)
    mocks.publishThunk.mockReturnValue({
      complete: Promise.resolve(),
      results: {"wss://relay.example.com/": {status: "success"}},
      event: {id: "published-config"},
    })

    await expect(
      sendBridgeRequest(bridge, extension, "community:publishSharedConfig", {
        namespace: "budabit-calendar-widget",
        key: "featured-calendar-event",
        descriptors: [{kind: EVENT_TIME}],
        config: {header: "Featured", eventRefs: [calendarEventRef]},
      }),
    ).resolves.toMatchObject({status: "ok", eventId: "published-config"})
    expect(mocks.authenticateCommunityRelays).toHaveBeenCalledWith(
      ["wss://relay.example.com/"],
      expect.any(Object),
    )
    expect(mocks.publishThunk).toHaveBeenCalledWith(
      expect.objectContaining({
        relays: ["wss://relay.example.com/"],
        event: expect.objectContaining({kind: 30078}),
      }),
    )
  })

  it("does not use runtime relay hints for dedicated community publishing", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelayHints.set(["wss://hint.example.com/"])
    mocks.activeCommunityRelays.set(["wss://hint.example.com/"])
    mocks.pubkey.set(calendarWriterPubkey)

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:publishSharedConfig"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:publishSharedConfig", {
        namespace: "budabit-calendar-widget",
        key: "featured-calendar-event",
        descriptors: [{kind: EVENT_TIME}],
        config: {header: "Featured", eventRefs: [calendarEventRef]},
      }),
    ).resolves.toEqual({
      error: "Community definition must declare relays before publishing",
      code: "COMMUNITY_CONTEXT_NOT_READY",
    })
    expect(mocks.authenticateCommunityRelays).not.toHaveBeenCalled()
    expect(mocks.publishThunk).not.toHaveBeenCalled()
  })

  it("uses widget relay hints when community definition relays are empty", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelayHints.set(["wss://hint.example.com/"])
    mocks.activeCommunityRelays.set([])
    mocks.pubkey.set(calendarWriterPubkey)

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:checkWriteCapabilities"],
      },
      communityContext: {
        version: 1,
        contextSessionId: "community-context-test",
        contextVersion: 0,
        pubkey: communityPubkey,
        ncommunity: "",
        relays: ["wss://hint.example.com/"],
        relayHints: ["wss://hint.example.com/"],
        blossomServers: [],
        sections: [],
        viewer: {pubkey: calendarWriterPubkey, isOwner: false, isBanned: false},
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:checkWriteCapabilities", {
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toMatchObject({
      status: "ok",
      contextVersion: 0,
      capabilities: [
        {
          descriptor: {kind: EVENT_TIME},
          canWrite: true,
        },
      ],
    })
  })

  it("returns descriptor errors instead of falling back to default sections", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:checkWriteCapabilities"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:checkWriteCapabilities", {
        descriptors: [{kind: 1}],
      }),
    ).resolves.toEqual({error: "No active community section supports event descriptor 1"})
  })

  it("queries community events through descriptor section mappings", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      const firstKind = filters?.[0]?.kinds?.[0]

      if (firstKind === TARGETED_PUBLICATION_KIND) {
        onEvent?.(calendarTargetingEvent)
      } else if (firstKind === EVENT_TIME) {
        onEvent?.(calendarEvent)
      }
    })

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:queryEvents"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:queryEvents", {
        descriptors: [{kind: EVENT_TIME}],
        limit: 5,
      }),
    ).resolves.toMatchObject({
      status: "ok",
      events: [calendarEvent],
      relays: ["wss://relay.example.com/"],
      descriptors: [{kind: EVENT_TIME}],
      contextSessionId: expect.any(String),
      contextVersion: 0,
    })
    const loadCalls = mocks.load.mock.calls.map(([args]) => args)
    expect(loadCalls).toContainEqual(
      expect.objectContaining({
        filters: [
          expect.objectContaining({
            kinds: [TARGETED_PUBLICATION_KIND],
            "#p": [communityPubkey],
            "#k": [String(EVENT_TIME)],
          }),
        ],
      }),
    )
    expect(loadCalls).toContainEqual(
      expect.objectContaining({
        filters: expect.arrayContaining([
          {
            kinds: [EVENT_TIME],
            authors: [calendarWriterPubkey],
            "#d": ["event-1"],
            limit: 100,
          },
        ]),
      }),
    )
  })

  it("returns cached community events when relay event queries are empty", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.repository.query.mockImplementation(((filters: any[]) => {
      const firstKind = filters?.[0]?.kinds?.[0]

      if (firstKind === TARGETED_PUBLICATION_KIND) return [calendarTargetingEvent]
      if (firstKind === EVENT_TIME) return [calendarEvent]

      return []
    }) as any)

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:queryEvents"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:queryEvents", {
        descriptors: [{kind: EVENT_TIME}],
        limit: 5,
      }),
    ).resolves.toMatchObject({
      status: "ok",
      events: [calendarEvent],
    })
  })

  it("reports timeout when outsider targeting-wrapper pages saturate the cursor budget", async () => {
    const {ExtensionBridge} = await import("./bridge")
    let targetingPage = 0

    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (filters?.[0]?.kinds?.[0] !== TARGETED_PUBLICATION_KIND) return

      const pageCreatedAt = 1000 - targetingPage * 100
      targetingPage += 1
      Array.from({length: 100}, (_, index) =>
        makeEvent({
          id: `outsider-target-${targetingPage}-${index}`,
          pubkey: outsiderPubkey,
          created_at: pageCreatedAt - index,
          kind: TARGETED_PUBLICATION_KIND,
          tags: makeTargetedPublicationForCommunity({
            targetingId: `outsider-target-${targetingPage}-${index}`,
            originalKind: EVENT_TIME,
            originalRef: makeAddressablePublicationRef({
              kind: EVENT_TIME,
              pubkey: outsiderPubkey,
              identifier: `outsider-event-${targetingPage}-${index}`,
            }),
            communityPubkey,
          }).tags,
        }),
      ).forEach(onEvent)
    })

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:queryEvents"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:queryEvents", {
        descriptors: [{kind: EVENT_TIME}],
        limit: 5,
      }),
    ).resolves.toEqual({
      error: "Community relay query is still loading",
      code: "COMMUNITY_QUERY_TIMEOUT",
    })

    const targetingLoads = mocks.loadCommunityEvents.mock.calls.filter(
      call => call[1]?.[0]?.kinds?.[0] === TARGETED_PUBLICATION_KIND,
    )
    expect(targetingLoads).toHaveLength(3)
    expect(targetingLoads[0][1][0]).toEqual({
      kinds: [TARGETED_PUBLICATION_KIND],
      "#p": [communityPubkey],
      "#k": [String(EVENT_TIME)],
      limit: 100,
    })
    expect(targetingLoads[1][1][0]).toHaveProperty("until")
    const cachedTargetingCall = (mocks.repository.query.mock.calls as any[][]).find(
      ([filters]) => filters?.[0]?.kinds?.[0] === TARGETED_PUBLICATION_KIND,
    )
    expect(cachedTargetingCall?.[0]?.[0]).toMatchObject({
      authors: [communityPubkey, calendarWriterPubkey, calendarMemberPubkey],
      limit: 100,
    })
  })

  it("reports timeout when a saturated direct-event scan admits fewer than the limit", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const directDefinition = parseCommunityDefinition(
      makeEvent({
        kind: COMMUNITY_DEFINITION_KIND,
        pubkey: communityPubkey,
        tags: [
          ["content", "Events and meetups"],
          ["k", "1"],
          ["a", `${PROFILE_LIST_KIND}:${calendarWriterPubkey}:Events and meetups`],
        ],
      }),
    )!
    let directPage = 0

    mocks.activeCommunityDefinition.set(directDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (filters?.[0]?.kinds?.[0] !== 1) return

      const pageCreatedAt = 1000 - directPage * 100
      directPage += 1
      Array.from({length: 100}, (_, index) =>
        makeEvent({
          id: `outsider-direct-${directPage}-${index}`,
          pubkey: directPage === 1 && index === 0 ? calendarMemberPubkey : outsiderPubkey,
          created_at: pageCreatedAt - index,
          kind: 1,
          tags: [["h", communityPubkey]],
        }),
      ).forEach(onEvent)
    })

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:queryEvents"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:queryEvents", {
        descriptors: [{kind: 1}],
        limit: 5,
      }),
    ).resolves.toEqual({
      error: "Community relay query is still loading",
      code: "COMMUNITY_QUERY_TIMEOUT",
    })

    const directLoads = mocks.loadCommunityEvents.mock.calls.filter(
      call => call[1]?.[0]?.kinds?.[0] === 1,
    )
    expect(directLoads).toHaveLength(3)
    expect(directLoads[0][1]).toEqual([{kinds: [1], "#h": [communityPubkey], limit: 100}])
    expect(directLoads[1][1][0]).toHaveProperty("until")
  })

  it("returns enough authorized events from an incomplete saturated scan", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const directDefinition = parseCommunityDefinition(
      makeEvent({
        kind: COMMUNITY_DEFINITION_KIND,
        pubkey: communityPubkey,
        tags: [
          ["content", "Events and meetups"],
          ["k", "1"],
          ["a", `${PROFILE_LIST_KIND}:${calendarWriterPubkey}:Events and meetups`],
        ],
      }),
    )!
    let directPage = 0

    mocks.activeCommunityDefinition.set(directDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (filters?.[0]?.kinds?.[0] !== 1) return

      const pageCreatedAt = 1000 - directPage * 100
      directPage += 1
      Array.from({length: 100}, (_, index) =>
        makeEvent({
          id: `enough-direct-${directPage}-${index}`,
          pubkey: directPage === 1 && index < 5 ? calendarMemberPubkey : outsiderPubkey,
          created_at: pageCreatedAt - index,
          kind: 1,
          tags: [["h", communityPubkey]],
        }),
      ).forEach(onEvent)
    })

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:queryEvents"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    const result = await sendBridgeRequest(bridge, extension, "community:queryEvents", {
      descriptors: [{kind: 1}],
      limit: 5,
    })

    expect(result).toMatchObject({status: "ok"})
    expect(result.events).toHaveLength(5)
    expect(result.events.map((event: TrustedEvent) => event.id)).toEqual(
      Array.from({length: 5}, (_, index) => `enough-direct-1-${index}`),
    )
    const directLoads = mocks.loadCommunityEvents.mock.calls.filter(
      call => call[1]?.[0]?.kinds?.[0] === 1,
    )
    expect(directLoads).toHaveLength(3)
  })

  it("continues wrapper discovery to an authorized later page", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const outsiderPage = Array.from({length: 100}, (_, index) =>
      makeEvent({
        id: `later-outsider-target-${index}`,
        pubkey: outsiderPubkey,
        created_at: 300 - index,
        kind: TARGETED_PUBLICATION_KIND,
        tags: makeTargetedPublicationForCommunity({
          targetingId: `later-outsider-target-${index}`,
          originalKind: EVENT_TIME,
          originalRef: makeAddressablePublicationRef({
            kind: EVENT_TIME,
            pubkey: outsiderPubkey,
            identifier: `later-outsider-event-${index}`,
          }),
          communityPubkey,
        }).tags,
      }),
    )

    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      const firstFilter = filters?.[0] || {}
      if (firstFilter.kinds?.[0] === TARGETED_PUBLICATION_KIND) {
        const events = firstFilter.until === undefined ? outsiderPage : [calendarTargetingEvent]
        events.forEach(onEvent)
      } else if (firstFilter.kinds?.[0] === EVENT_TIME) {
        onEvent(calendarEvent)
      }
    })

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:queryEvents"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:queryEvents", {
        descriptors: [{kind: EVENT_TIME}],
        limit: 1,
      }),
    ).resolves.toMatchObject({status: "ok", events: [calendarEvent]})

    const targetingLoads = mocks.loadCommunityEvents.mock.calls.filter(
      call => call[1]?.[0]?.kinds?.[0] === TARGETED_PUBLICATION_KIND,
    )
    expect(targetingLoads).toHaveLength(2)
    expect(targetingLoads[1][1][0]).toMatchObject({until: 200, limit: 100})
  })

  it("returns explicit external originals only from authorized targeting wrappers", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const authorizedTargeting = makeEvent({
      id: "external-target",
      pubkey: calendarWriterPubkey,
      kind: TARGETED_PUBLICATION_KIND,
      tags: makeTargetedPublicationForCommunity({
        targetingId: "external-target",
        originalKind: EVENT_TIME,
        originalRef: makeAddressablePublicationRef({
          kind: EVENT_TIME,
          pubkey: outsiderPubkey,
          identifier: "external-event",
          relay: "wss://external.example.com/",
        }),
        communityPubkey,
      }).tags,
    })
    const unauthorizedTargeting = makeEvent({
      id: "unauthorized-target",
      pubkey: outsiderPubkey,
      kind: TARGETED_PUBLICATION_KIND,
      tags: makeTargetedPublicationForCommunity({
        targetingId: "unauthorized-target",
        originalKind: EVENT_TIME,
        originalRef: makeAddressablePublicationRef({
          kind: EVENT_TIME,
          pubkey: outsiderPubkey,
          identifier: "unauthorized-event",
        }),
        communityPubkey,
      }).tags,
    })
    const externalEvent = makeEvent({
      id: "external-event-id",
      pubkey: outsiderPubkey,
      kind: EVENT_TIME,
      tags: [["d", "external-event"]],
    })
    const unauthorizedEvent = makeEvent({
      id: "unauthorized-event-id",
      pubkey: outsiderPubkey,
      kind: EVENT_TIME,
      tags: [["d", "unauthorized-event"]],
    })

    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.repository.query.mockImplementation(((filters: any[]) => {
      if (filters?.[0]?.kinds?.[0] === EVENT_TIME) return [unauthorizedEvent]
      return []
    }) as any)
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      const firstKind = filters?.[0]?.kinds?.[0]
      if (firstKind === TARGETED_PUBLICATION_KIND) {
        onEvent?.(authorizedTargeting)
        onEvent?.(unauthorizedTargeting)
      } else if (firstKind === EVENT_TIME) {
        onEvent?.(externalEvent)
        onEvent?.(unauthorizedEvent)
      }
    })

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:queryEvents"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:queryEvents", {
        descriptors: [{kind: EVENT_TIME}],
        limit: 5,
      }),
    ).resolves.toMatchObject({status: "ok", events: [externalEvent]})
    expect(mocks.loadCommunityEvents).toHaveBeenCalledWith(
      ["wss://external.example.com/"],
      expect.arrayContaining([
        {
          kinds: [EVENT_TIME],
          authors: [outsiderPubkey],
          "#d": ["external-event"],
          limit: 100,
        },
      ]),
      expect.objectContaining({authenticate: false}),
    )
    expect(mocks.authenticateCommunityRelays).toHaveBeenCalledWith(
      ["wss://relay.example.com/", "wss://external.example.com/"],
      {priorityRelays: []},
    )
    expect(mocks.loadCommunityEvents.mock.calls.flatMap(call => call[1])).not.toContainEqual(
      expect.objectContaining({"#d": ["unauthorized-event"]}),
    )
  })

  it("uses structural relay filters and locally rejects unauthorized direct descriptor events", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const directDefinition = parseCommunityDefinition(
      makeEvent({
        kind: COMMUNITY_DEFINITION_KIND,
        pubkey: communityPubkey,
        tags: [
          ["content", "Events and meetups"],
          ["k", "1"],
          ["a", `${PROFILE_LIST_KIND}:${calendarWriterPubkey}:Events and meetups`],
        ],
      }),
    )!
    const authorizedEvent = makeEvent({
      id: "authorized-direct",
      pubkey: calendarMemberPubkey,
      kind: 1,
      tags: [["h", communityPubkey]],
    })
    const unauthorizedEvent = makeEvent({
      id: "unauthorized-direct",
      pubkey: outsiderPubkey,
      kind: 1,
      tags: [["h", communityPubkey]],
    })

    mocks.activeCommunityDefinition.set(directDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.repository.query.mockImplementation(((filters: any[]) =>
      filters?.[0]?.kinds?.[0] === 1 ? [unauthorizedEvent] : []) as any)
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (filters?.[0]?.kinds?.[0] !== 1) return
      onEvent?.(unauthorizedEvent)
      onEvent?.(authorizedEvent)
    })

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:queryEvents"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:queryEvents", {
        descriptors: [{kind: 1}],
        limit: 5,
      }),
    ).resolves.toMatchObject({status: "ok", events: [authorizedEvent]})
    expect(mocks.repository.query).toHaveBeenCalledWith([
      {
        kinds: [1],
        "#h": [communityPubkey],
        authors: [communityPubkey, calendarWriterPubkey, calendarMemberPubkey],
        limit: 5,
      },
    ])
    expect(mocks.loadCommunityEvents).toHaveBeenCalledWith(
      ["wss://relay.example.com/"],
      [{kinds: [1], "#h": [communityPubkey], limit: 100}],
      expect.objectContaining({authenticate: false}),
    )
  })

  it("does not cross-authorize disjoint room and thread writers in broad or exact queries", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const profileListOwner = calendarWriterPubkey
    const roomWriter = calendarMemberPubkey
    const threadWriter = outsiderPubkey
    const mixedDefinition = parseCommunityDefinition(
      makeEvent({
        kind: COMMUNITY_DEFINITION_KIND,
        pubkey: communityPubkey,
        tags: [
          ["content", "Rooms"],
          ["k", String(THREAD), COMMUNITY_SUBTYPE_ROOM],
          ["a", `${PROFILE_LIST_KIND}:${profileListOwner}:Rooms`],
          ["content", "Threads"],
          ["k", String(THREAD), COMMUNITY_SUBTYPE_THREADS],
          ["a", `${PROFILE_LIST_KIND}:${profileListOwner}:Threads`],
        ],
      }),
    )!
    const roomWriters = makeEvent({
      id: "room-writers",
      kind: PROFILE_LIST_KIND,
      pubkey: profileListOwner,
      tags: [
        ["d", "Rooms"],
        ["p", roomWriter],
      ],
    })
    const threadWriters = makeEvent({
      id: "thread-writers",
      kind: PROFILE_LIST_KIND,
      pubkey: profileListOwner,
      tags: [
        ["d", "Threads"],
        ["p", threadWriter],
      ],
    })
    const roomByRoomWriter = makeEvent({
      id: "1".repeat(64),
      created_at: 40,
      kind: THREAD,
      pubkey: roomWriter,
      tags: [["d", "room-allowed"], ["h", communityPubkey], ["room"]],
    })
    const threadByThreadWriter = makeEvent({
      id: "2".repeat(64),
      created_at: 30,
      kind: THREAD,
      pubkey: threadWriter,
      tags: [
        ["d", "thread-allowed"],
        ["h", communityPubkey],
      ],
    })
    const roomByThreadWriter = makeEvent({
      id: "3".repeat(64),
      created_at: 60,
      kind: THREAD,
      pubkey: threadWriter,
      tags: [["d", "room-cross-authorized"], ["h", communityPubkey], ["room"]],
    })
    const threadByRoomWriter = makeEvent({
      id: "4".repeat(64),
      created_at: 50,
      kind: THREAD,
      pubkey: roomWriter,
      tags: [
        ["d", "thread-cross-authorized"],
        ["h", communityPubkey],
      ],
    })
    const allEvents = [
      roomByThreadWriter,
      threadByRoomWriter,
      roomByRoomWriter,
      threadByThreadWriter,
    ]
    const descriptors = [
      {kind: THREAD, subtype: COMMUNITY_SUBTYPE_ROOM},
      {kind: THREAD, subtype: COMMUNITY_SUBTYPE_THREADS},
    ]

    mocks.activeCommunityDefinition.set(mixedDefinition)
    mocks.activeCommunityProfileListEvents.set([roomWriters, threadWriters])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (filters?.some((filter: any) => filter.kinds?.includes(THREAD))) {
        allEvents.forEach(onEvent)
      }
    })

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:queryEvents"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:queryEvents", {
        descriptors,
        limit: 10,
      }),
    ).resolves.toMatchObject({
      status: "ok",
      events: [roomByRoomWriter, threadByThreadWriter],
    })

    await expect(
      sendBridgeRequest(bridge, extension, "community:queryEvents", {
        descriptors,
        refs: allEvents.map(event => `${event.kind}:${event.pubkey}:${event.tags[0][1]}`),
        limit: 10,
      }),
    ).resolves.toMatchObject({
      status: "ok",
      events: [roomByRoomWriter, threadByThreadWriter],
    })
  })

  it("returns descriptor calendar events from authorized writers without targeting events", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      const filter = filters?.[0] || {}

      if (
        filter.kinds?.[0] === EVENT_TIME &&
        filter.authors?.includes(calendarWriterPubkey) &&
        !filter["#d"]
      ) {
        onEvent?.(calendarEvent)
      }
    })

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:queryEvents"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:queryEvents", {
        descriptors: [{kind: EVENT_TIME}],
        limit: 5,
      }),
    ).resolves.toMatchObject({
      status: "ok",
      events: [calendarEvent],
    })
  })

  it("returns exact referenced community events from writer outboxes without targeting events", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.getPubkeyOutboxRelays.mockReturnValue(["wss://writer-outbox.example.com/"])
    mocks.load.mockImplementation(async ({relays, filters, onEvent}: any) => {
      const filter = filters?.[0] || {}

      if (
        relays.includes("wss://writer-outbox.example.com/") &&
        filter.kinds?.[0] === EVENT_TIME &&
        filter.authors?.[0] === calendarWriterPubkey &&
        filter["#d"]?.[0] === "event-1"
      ) {
        onEvent?.(calendarEvent)
      }
    })

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:queryEvents"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:queryEvents", {
        descriptors: [{kind: EVENT_TIME}],
        refs: [calendarEventRef],
        limit: 5,
      }),
    ).resolves.toMatchObject({
      status: "ok",
      events: [calendarEvent],
    })
    expect(mocks.getPubkeyOutboxRelays).toHaveBeenCalledWith([calendarWriterPubkey])
    expect(mocks.loadCommunityEvents).toHaveBeenCalledTimes(1)
    expect(mocks.loadCommunityEvents.mock.calls[0][2]).toMatchObject({
      settle: "all",
    })
  })

  it("returns fully cached exact refs without waiting for relay refresh", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.repository.query.mockImplementation(((filters: any[]) =>
      filters?.[0]?.kinds?.includes(EVENT_TIME) ? [calendarEvent] : []) as any)
    mocks.loadCommunityEventsWithStatus.mockReturnValueOnce(new Promise(() => undefined))

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:queryEvents"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:queryEvents", {
        descriptors: [{kind: EVENT_TIME}],
        refs: [calendarEventRef],
        limit: 5,
      }),
    ).resolves.toMatchObject({status: "ok", events: [calendarEvent]})
    expect(mocks.loadCommunityEventsWithStatus).toHaveBeenCalledTimes(1)
  })

  it("queries direct and trusted-provider live streams hosted by descriptor moderators", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const directOld = makeEvent({
      id: "direct-old",
      kind: 30311,
      pubkey: calendarWriterPubkey,
      created_at: 10,
      tags: [
        ["d", "direct-stream"],
        ["h", communityPubkey],
      ],
    })
    const directLive = makeEvent({
      id: "direct-live",
      kind: 30311,
      pubkey: calendarWriterPubkey,
      created_at: 20,
      tags: [
        ["d", "direct-stream"],
        ["h", communityPubkey],
        ["status", "live"],
      ],
    })
    const delegatedLive = makeEvent({
      id: "delegated-live",
      kind: 30311,
      pubkey: zapStreamProviderPubkey,
      created_at: 30,
      tags: [
        ["d", "delegated-stream"],
        ["t", `budabit-community:${communityPubkey}`],
        ["p", calendarWriterPubkey, "", "host"],
        ["status", "live"],
      ],
    })
    const writerOnlyStream = makeEvent({
      id: "writer-only",
      kind: 30311,
      pubkey: calendarMemberPubkey,
      created_at: 40,
      tags: [
        ["d", "writer-stream"],
        ["h", communityPubkey],
      ],
    })
    const invalidDelegation = makeEvent({
      id: "invalid-delegation",
      kind: 30311,
      pubkey: zapStreamProviderPubkey,
      created_at: 40,
      tags: [
        ["d", "invalid-provider-stream"],
        ["t", `budabit-community:${communityPubkey}`],
        ["p", calendarMemberPubkey, "", "host"],
      ],
    })

    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (!filters?.some((filter: any) => filter.kinds?.includes(30311))) return
      ;[directOld, directLive, delegatedLive, writerOnlyStream, invalidDelegation].forEach(onEvent)
    })

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:queryLiveStreams"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:queryLiveStreams", {
        descriptors: [{kind: EVENT_TIME}],
        limit: 5,
      }),
    ).resolves.toMatchObject({
      status: "ok",
      events: [{id: "delegated-live"}, {id: "direct-live"}],
      relays: ["wss://relay.example.com/"],
      descriptors: [{kind: EVENT_TIME}],
      contextSessionId: expect.any(String),
      contextVersion: 0,
    })
    expect(mocks.loadCommunityEvents).toHaveBeenCalledWith(
      ["wss://relay.example.com/"],
      expect.arrayContaining([
        expect.objectContaining({
          kinds: [30311],
          authors: expect.arrayContaining([calendarWriterPubkey]),
        }),
        expect.objectContaining({
          kinds: [30311],
          authors: expect.arrayContaining([zapStreamProviderPubkey]),
        }),
      ]),
      expect.objectContaining({authenticate: true}),
    )
  })

  it("returns authorized cached live streams without waiting for relay refresh", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const cachedStream = makeEvent({
      id: "cached-live",
      kind: 30311,
      pubkey: calendarWriterPubkey,
      created_at: 20,
      tags: [
        ["d", "cached-stream"],
        ["h", communityPubkey],
        ["status", "live"],
      ],
    })
    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.repository.query.mockImplementation(((filters: any[]) =>
      filters?.[0]?.kinds?.includes(30311) ? [cachedStream] : []) as any)
    mocks.loadCommunityEventsWithStatus.mockReturnValueOnce(new Promise(() => undefined))

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:queryLiveStreams"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:queryLiveStreams", {
        descriptors: [{kind: EVENT_TIME}],
        limit: 5,
      }),
    ).resolves.toMatchObject({status: "ok", events: [cachedStream]})
    expect(mocks.loadCommunityEventsWithStatus).toHaveBeenCalledTimes(1)
  })

  it("uses the lower event id when live-stream replacements share a timestamp", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const lowerId = "1".repeat(64)
    const higherId = "f".repeat(64)
    const makeReplacement = (id: string) =>
      makeEvent({
        id,
        kind: 30311,
        pubkey: calendarWriterPubkey,
        created_at: 20,
        tags: [
          ["d", "tie-stream"],
          ["h", communityPubkey],
          ["title", id === lowerId ? "Preferred" : "Discarded"],
        ],
      })

    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (!filters?.some((filter: any) => filter.kinds?.includes(30311))) return
      onEvent?.(makeReplacement(higherId))
      onEvent?.(makeReplacement(lowerId))
    })

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:queryLiveStreams"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:queryLiveStreams", {
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toMatchObject({events: [{id: lowerId}]})
  })

  it("does not resurrect an older delegated stream after the provider changes its host", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const validOld = makeEvent({
      id: "valid-old-provider-stream",
      kind: 30311,
      pubkey: zapStreamProviderPubkey,
      created_at: 10,
      tags: [
        ["d", "reassigned-stream"],
        ["t", `budabit-community:${communityPubkey}`],
        ["p", calendarWriterPubkey, "", "host"],
      ],
    })
    const invalidNew = makeEvent({
      id: "invalid-new-provider-stream",
      kind: 30311,
      pubkey: zapStreamProviderPubkey,
      created_at: 20,
      tags: [
        ["d", "reassigned-stream"],
        ["t", `budabit-community:${communityPubkey}`],
        ["p", calendarMemberPubkey, "", "host"],
      ],
    })

    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (!filters?.some((filter: any) => filter.kinds?.includes(30311))) return
      onEvent?.(validOld)
      onEvent?.(invalidNew)
    })

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:queryLiveStreams"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:queryLiveStreams", {
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toMatchObject({events: []})
  })

  it("validates nostr query payloads and deduplicates returned events", async () => {
    const {ExtensionBridge} = await import("./bridge")

    mocks.load.mockImplementation(async ({onEvent}: any) => {
      onEvent?.({id: "evt-1"})
      onEvent?.({id: "evt-1"})
      onEvent?.({id: "evt-2"})
    })

    const extension = makeExtension({
      widget: {permissions: ["nostr:query"]},
    })
    const bridge = new ExtensionBridge(extension as any)
    const source = makeSourceWindow()

    await bridge.handleMessage({
      data: {
        id: "query-ok",
        type: "request",
        action: "nostr:query",
        payload: {
          relays: ["wss://relay.example.com", "wss://relay.example.com"],
          filter: {kinds: [30301], "#d": ["widget-1"], limit: 10},
        },
      },
      source,
      origin: extension.origin,
    } as any)

    expect(mocks.load).toHaveBeenCalledWith(
      expect.objectContaining({
        relays: ["wss://relay.example.com/"],
      }),
    )
    expect(source.postMessage).toHaveBeenLastCalledWith(
      {
        id: "query-ok",
        type: "response",
        action: "nostr:query",
        payload: {status: "ok", events: [{id: "evt-1"}, {id: "evt-2"}]},
      },
      extension.origin,
    )

    await bridge.handleMessage({
      data: {
        id: "query-bad",
        type: "request",
        action: "nostr:query",
        payload: {
          relays: ["https://not-a-websocket.example.com"],
          filter: {kinds: [1], limit: 501},
        },
      },
      source,
      origin: extension.origin,
    } as any)

    expect(source.postMessage).toHaveBeenLastCalledWith(
      {
        id: "query-bad",
        type: "response",
        action: "nostr:query",
        payload: {error: "No valid relays provided"},
      },
      extension.origin,
    )
  })
})
