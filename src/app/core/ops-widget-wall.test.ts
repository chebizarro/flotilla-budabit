import {describe, expect, it, vi} from "vitest"
import {DASHBOARD_WIDGET_KIND, FLEET_RELAY_URLS, type NostrWidgetEvent} from "wheelhouse"

vi.mock("@welshman/net", () => ({request: vi.fn()}))
vi.mock("./relay-policy", () => ({RELAY_REQUEST_PRIORITY: {live: 200}}))
import {
  createOpsWidgetWall,
  parseOpsWidgetPublisherAllowlist,
  type OpsWidgetRequestOptions,
} from "./ops-widget-wall"

const PUBKEY = "ab".repeat(32)

const widgetEvent = (overrides: Partial<NostrWidgetEvent> = {}): NostrWidgetEvent => ({
  id: "1".repeat(64),
  pubkey: PUBKEY,
  created_at: 100,
  kind: DASHBOARD_WIDGET_KIND,
  tags: [["d", "cpu:host-a:api:5m"]],
  content: "{}",
  sig: "2".repeat(128),
  ...overrides,
})

describe("ops widget wall", () => {
  it("normalizes and validates configured publisher pubkeys", () => {
    expect(
      parseOpsWidgetPublisherAllowlist(` ${PUBKEY.toUpperCase()},not-a-key,${PUBKEY} `),
    ).toEqual([PUBKEY])
  })

  it("uses only fleet relays and keeps a live kind-30318 subscription", async () => {
    let requestOptions: OpsWidgetRequestOptions | undefined
    const requester = vi.fn((options: OpsWidgetRequestOptions) => {
      requestOptions = options
      return Promise.resolve()
    })
    const wall = createOpsWidgetWall({
      allowedPubkeys: [PUBKEY],
      requester,
      verifyEvent: () => true,
    })
    const snapshots: Array<readonly NostrWidgetEvent[]> = []
    const unsubscribe = wall.store.subscribe(events => snapshots.push(events))

    const stop = wall.start()
    await vi.waitFor(() => expect(requester).toHaveBeenCalledOnce())

    expect(requestOptions?.relays).toEqual([...FLEET_RELAY_URLS])
    expect(requestOptions?.filters).toEqual([{kinds: [DASHBOARD_WIDGET_KIND]}])
    expect(requestOptions?.lifetime).toBe("live")
    expect(requestOptions?.autoClose).toBe(false)

    requestOptions?.onEvent(widgetEvent(), FLEET_RELAY_URLS[0])
    expect(snapshots.at(-1)).toEqual([widgetEvent()])

    stop()
    expect(requestOptions?.signal.aborted).toBe(true)
    unsubscribe()
  })

  it("rejects invalid signatures before the Wheelhouse store", async () => {
    let requestOptions: OpsWidgetRequestOptions | undefined
    const rejected = vi.fn()
    const wall = createOpsWidgetWall({
      allowedPubkeys: [PUBKEY],
      requester: options => {
        requestOptions = options
      },
      verifyEvent: () => false,
    })
    let snapshot: readonly NostrWidgetEvent[] = []
    const unsubscribe = wall.store.subscribe(events => (snapshot = events))

    const stop = wall.start({onRejected: rejected})
    await vi.waitFor(() => expect(requestOptions).toBeDefined())
    requestOptions?.onEvent(widgetEvent(), FLEET_RELAY_URLS[0])

    expect(snapshot).toEqual([])
    expect(rejected).toHaveBeenCalledWith("invalid_signature", widgetEvent())
    stop()
    unsubscribe()
  })
})
