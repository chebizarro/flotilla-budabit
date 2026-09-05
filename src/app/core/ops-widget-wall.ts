import {request} from "@welshman/net"
import type {Filter, TrustedEvent} from "@welshman/util"
import {verifyEvent as verifyNostrEvent} from "nostr-tools"
import {
  createWidgetStore,
  DASHBOARD_WIDGET_KIND,
  FLEET_RELAY_URLS,
  type NostrWidgetEvent,
  type WidgetIngestResult,
} from "wheelhouse"
import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"

const HEX_PUBKEY = /^[0-9a-f]{64}$/i

export const parseOpsWidgetPublisherAllowlist = (value: string | undefined): string[] =>
  Array.from(
    new Set(
      String(value || "")
        .split(",")
        .map(pubkey => pubkey.trim().toLowerCase())
        .filter(pubkey => HEX_PUBKEY.test(pubkey)),
    ),
  )

export const OPS_WIDGET_RELAYS = [...FLEET_RELAY_URLS]
export const OPS_WIDGET_ALLOWED_PUBKEYS = parseOpsWidgetPublisherAllowlist(
  import.meta.env.VITE_WHEELHOUSE_ALLOWED_PUBKEYS,
)

export type OpsWidgetRequestOptions = {
  relays: string[]
  filters: Filter[]
  autoClose: false
  lifetime: "live"
  priority: number
  owner: string
  signal: AbortSignal
  onEvent: (event: TrustedEvent, relay: string) => void
  onDuplicate: (event: TrustedEvent, relay: string) => void
  onEose: (relay: string) => void
  onClosed: (reason: string, relay: string) => void
  onDisconnect: (relay: string) => void
}

type OpsWidgetRequester = (options: OpsWidgetRequestOptions) => Promise<unknown> | unknown
type OpsWidgetVerifier = (event: NostrWidgetEvent) => boolean

export type OpsWidgetWallCallbacks = {
  onEose?: (relay: string) => void
  onClosed?: (reason: string, relay: string) => void
  onRejected?: (
    reason: "invalid_signature" | Exclude<WidgetIngestResult, {accepted: true}>["reason"],
    event: NostrWidgetEvent,
  ) => void
  onError?: (error: unknown) => void
}

export const createOpsWidgetWall = ({
  allowedPubkeys = OPS_WIDGET_ALLOWED_PUBKEYS,
  requester = request as unknown as OpsWidgetRequester,
  verifyEvent = event => verifyNostrEvent(event as Parameters<typeof verifyNostrEvent>[0]),
}: {
  allowedPubkeys?: readonly string[]
  requester?: OpsWidgetRequester
  verifyEvent?: OpsWidgetVerifier
} = {}) => {
  const store = createWidgetStore({allowedPubkeys})
  let stopActiveRequest: (() => void) | undefined

  const ingest = (event: NostrWidgetEvent, callbacks: OpsWidgetWallCallbacks) => {
    if (!verifyEvent(event)) {
      callbacks.onRejected?.("invalid_signature", event)
      return
    }

    const result = store.ingest(event)
    if (!result.accepted) callbacks.onRejected?.(result.reason, event)
  }

  const start = (callbacks: OpsWidgetWallCallbacks = {}) => {
    stopActiveRequest?.()
    const controller = new AbortController()
    const receive = (event: TrustedEvent) => ingest(event as NostrWidgetEvent, callbacks)

    void Promise.resolve(
      requester({
        relays: [...OPS_WIDGET_RELAYS],
        filters: [{kinds: [DASHBOARD_WIDGET_KIND]}],
        autoClose: false,
        lifetime: "live",
        priority: RELAY_REQUEST_PRIORITY.live,
        owner: "ops-widget-wall",
        signal: controller.signal,
        onEvent: receive,
        onDuplicate: receive,
        onEose: relay => callbacks.onEose?.(relay),
        onClosed: (reason, relay) => callbacks.onClosed?.(reason, relay),
        onDisconnect: relay => callbacks.onClosed?.("relay disconnected", relay),
      }),
    ).catch(error => {
      if (!controller.signal.aborted) callbacks.onError?.(error)
    })

    const stop = () => {
      if (!controller.signal.aborted) controller.abort()
      if (stopActiveRequest === stop) stopActiveRequest = undefined
    }
    stopActiveRequest = stop
    return stop
  }

  return {
    store,
    start,
    clear: () => store.clear(),
  }
}
