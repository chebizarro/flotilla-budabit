import {request, type RequestOptions} from "@welshman/net"
import {matchFilters, type Filter, type TrustedEvent} from "@welshman/util"
import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"

export const MAX_EXTENSION_SUBSCRIPTIONS = 10
export const MAX_EXTENSION_RELAYS_PER_SUBSCRIPTION = 8
export const MAX_EXTENSION_SUBSCRIPTIONS_PER_RELAY = 20
export const MAX_EXTENSION_EVENTS_PER_FILTER = 500

type Request = (options: RequestOptions) => Promise<TrustedEvent[]>

type LogicalSubscription = {
  id: string
  extensionId: string
  relays: string[]
  filters: Filter[]
  onEvent: (subscriptionId: string, event: TrustedEvent) => void
  onEose?: (subscriptionId: string, relay: string) => void
  eoseRelays: Set<string>
}

type PhysicalRequest = {
  liveController?: AbortController
  liveRetryTimer?: ReturnType<typeof setTimeout>
  backfillController: AbortController
  backfillTimer?: ReturnType<typeof setTimeout>
  signature: string
  subscriptionIds: Set<string>
}

type RelayGroup = {
  extensionId: string
  relay: string
  subscriptionIds: Set<string>
  active?: PhysicalRequest
  pending?: PhysicalRequest
  seenDeliveryKeys: Set<string>
  seenDeliveryOrder: string[]
}

type ExtensionSubscriptionRegistryOptions = {
  request?: Request
  makeSubscriptionId?: (extensionId: string) => string
  onError?: (relay: string, extensionId: string, error: unknown) => void
  retryDelayMs?: number
  backfillTimeoutMs?: number
}

const cloneFilter = (filter: Filter): Filter => JSON.parse(JSON.stringify(filter)) as Filter

const getFilterKey = (filter: Filter) =>
  JSON.stringify(Object.fromEntries(Object.entries(filter).sort(([a], [b]) => a.localeCompare(b))))

const normalizeRelay = (relay: string) => {
  try {
    const url = new URL(relay)
    if (url.protocol !== "wss:" && url.protocol !== "ws:") return ""
    url.hash = ""
    return url.toString()
  } catch {
    return ""
  }
}

let subscriptionSequence = 0
const MAX_SEEN_EXTENSION_EVENT_DELIVERIES =
  MAX_EXTENSION_SUBSCRIPTIONS * MAX_EXTENSION_EVENTS_PER_FILTER
const DEFAULT_EXTENSION_BACKFILL_TIMEOUT_MS = 5_000

export class ExtensionSubscriptionRegistry {
  private readonly request: Request
  private readonly makeSubscriptionId: (extensionId: string) => string
  private readonly onError: (relay: string, extensionId: string, error: unknown) => void
  private readonly retryDelayMs: number
  private readonly backfillTimeoutMs: number
  private readonly subscriptions = new Map<string, LogicalSubscription>()
  private readonly subscriptionIdsByExtension = new Map<string, Set<string>>()
  private readonly groups = new Map<string, RelayGroup>()
  private readonly logicalCountByRelay = new Map<string, number>()

  constructor(options: ExtensionSubscriptionRegistryOptions = {}) {
    this.request = options.request || request
    this.makeSubscriptionId =
      options.makeSubscriptionId ||
      (extensionId => `sub-${extensionId.slice(0, 8)}-${++subscriptionSequence}`)
    this.onError = options.onError || (() => {})
    this.retryDelayMs = options.retryDelayMs ?? 5_000
    this.backfillTimeoutMs = options.backfillTimeoutMs ?? DEFAULT_EXTENSION_BACKFILL_TIMEOUT_MS
  }

  subscribe({
    extensionId,
    relays,
    filters,
    onEvent,
    onEose,
  }: {
    extensionId: string
    relays: string[]
    filters: Filter[]
    onEvent: (subscriptionId: string, event: TrustedEvent) => void
    onEose?: (subscriptionId: string, relay: string) => void
  }): string {
    const normalizedRelays = Array.from(new Set(relays.map(normalizeRelay).filter(Boolean)))
    const extensionIds = this.subscriptionIdsByExtension.get(extensionId)

    if (!extensionId) throw new Error("Invalid extension ID")
    if (normalizedRelays.length === 0) throw new Error("No valid relays provided")
    if (normalizedRelays.length > MAX_EXTENSION_RELAYS_PER_SUBSCRIPTION) {
      throw new Error(
        `Relay limit reached (max ${MAX_EXTENSION_RELAYS_PER_SUBSCRIPTION} per subscription)`,
      )
    }
    if (filters.length === 0) throw new Error("At least one filter is required")
    if ((extensionIds?.size || 0) >= MAX_EXTENSION_SUBSCRIPTIONS) {
      throw new Error(`Subscription limit reached (max ${MAX_EXTENSION_SUBSCRIPTIONS})`)
    }
    for (const relay of normalizedRelays) {
      if ((this.logicalCountByRelay.get(relay) || 0) >= MAX_EXTENSION_SUBSCRIPTIONS_PER_RELAY) {
        throw new Error(
          `Relay subscription limit reached for ${relay} (max ${MAX_EXTENSION_SUBSCRIPTIONS_PER_RELAY})`,
        )
      }
    }

    const id = this.makeSubscriptionId(extensionId)
    if (this.subscriptions.has(id)) throw new Error(`Duplicate subscription ID: ${id}`)

    const subscription: LogicalSubscription = {
      id,
      extensionId,
      relays: normalizedRelays,
      filters: filters.map(cloneFilter),
      onEvent,
      onEose,
      eoseRelays: new Set(),
    }
    this.subscriptions.set(id, subscription)

    const ids = extensionIds || new Set<string>()
    ids.add(id)
    this.subscriptionIdsByExtension.set(extensionId, ids)

    for (const relay of normalizedRelays) {
      this.logicalCountByRelay.set(relay, (this.logicalCountByRelay.get(relay) || 0) + 1)
      const group = this.getGroup(extensionId, relay)
      group.subscriptionIds.add(id)
      this.reconcile(group)
    }

    return id
  }

  unsubscribe(extensionId: string, subscriptionId: string): boolean {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription || subscription.extensionId !== extensionId) return false

    this.subscriptions.delete(subscriptionId)
    const extensionIds = this.subscriptionIdsByExtension.get(extensionId)
    extensionIds?.delete(subscriptionId)
    if (extensionIds?.size === 0) this.subscriptionIdsByExtension.delete(extensionId)

    for (const relay of subscription.relays) {
      const count = Math.max(0, (this.logicalCountByRelay.get(relay) || 0) - 1)
      if (count === 0) this.logicalCountByRelay.delete(relay)
      else this.logicalCountByRelay.set(relay, count)

      const key = this.getGroupKey(extensionId, relay)
      const group = this.groups.get(key)
      if (!group) continue
      group.subscriptionIds.delete(subscriptionId)
      if (group.subscriptionIds.size === 0) {
        if (group.pending) this.abortPhysicalRequest(group.pending)
        if (group.active) this.abortPhysicalRequest(group.active)
        this.groups.delete(key)
      } else {
        this.reconcile(group)
      }
    }

    return true
  }

  cleanupExtension(extensionId: string): void {
    for (const id of Array.from(this.subscriptionIdsByExtension.get(extensionId) || [])) {
      this.unsubscribe(extensionId, id)
    }
  }

  close(): void {
    for (const group of this.groups.values()) {
      if (group.pending) this.abortPhysicalRequest(group.pending)
      if (group.active) this.abortPhysicalRequest(group.active)
    }
    this.subscriptions.clear()
    this.subscriptionIdsByExtension.clear()
    this.groups.clear()
    this.logicalCountByRelay.clear()
  }

  getSnapshot() {
    return {
      logicalSubscriptions: this.subscriptions.size,
      groups: Array.from(this.groups.values()).map(group => ({
        extensionId: group.extensionId,
        relay: group.relay,
        logicalSubscriptions: group.subscriptionIds.size,
        active: Boolean(group.active),
        pending: Boolean(group.pending),
      })),
    }
  }

  private getGroupKey(extensionId: string, relay: string) {
    return `${extensionId}\u0000${relay}`
  }

  private getGroup(extensionId: string, relay: string) {
    const key = this.getGroupKey(extensionId, relay)
    let group = this.groups.get(key)
    if (!group) {
      group = {
        extensionId,
        relay,
        subscriptionIds: new Set(),
        seenDeliveryKeys: new Set(),
        seenDeliveryOrder: [],
      }
      this.groups.set(key, group)
    }
    return group
  }

  private getPhysicalFilters(group: RelayGroup) {
    const filtersByKey = new Map<string, Filter>()
    for (const id of group.subscriptionIds) {
      const subscription = this.subscriptions.get(id)
      if (!subscription) continue
      for (const filter of subscription.filters) filtersByKey.set(getFilterKey(filter), filter)
    }
    return Array.from(filtersByKey.values())
  }

  private reconcile(group: RelayGroup) {
    const filters = this.getPhysicalFilters(group)
    const filterKeys = filters.map(getFilterKey)
    // Membership is part of the generation. An identical late subscriber must
    // receive its own stored history rather than only joining an existing tail.
    const signature = `${filterKeys.slice().sort().join("|")}\u0000${Array.from(
      group.subscriptionIds,
    )
      .sort()
      .join("|")}`
    if (group.active?.signature === signature && !group.pending) return
    if (group.pending?.signature === signature) return

    if (group.pending) this.abortPhysicalRequest(group.pending)
    const candidate: PhysicalRequest = {
      liveController: new AbortController(),
      backfillController: new AbortController(),
      signature,
      subscriptionIds: new Set(group.subscriptionIds),
    }
    group.pending = candidate

    const promote = (eose: boolean) => {
      if (group.pending === candidate) {
        const previous = group.active
        group.active = candidate
        group.pending = undefined
        if (previous) this.abortPhysicalRequest(previous)
      } else if (group.active !== candidate) {
        return
      }

      if (eose) this.dispatchEose(group, candidate)
    }

    const handleError = (controller: AbortController, error: unknown) => {
      if (!controller.signal.aborted) this.onError(group.relay, group.extensionId, error)
    }

    const isCurrentCandidate = () => group.pending === candidate || group.active === candidate

    const completeEose = () => {
      promote(true)
      candidate.backfillController.abort()
    }

    const startBackfillDeadline = () => {
      if (
        candidate.backfillTimer ||
        candidate.backfillController.signal.aborted ||
        !isCurrentCandidate()
      ) {
        return
      }

      candidate.backfillTimer = setTimeout(() => {
        candidate.backfillTimer = undefined
        candidate.backfillController.abort()
        promote(false)
      }, this.backfillTimeoutMs)
    }

    // A bounded, normal-priority request prevents initial history from being
    // starved by the background live-request budget.
    void this.request({
      relays: [group.relay],
      filters,
      lifetime: "finite",
      autoClose: true,
      priority: RELAY_REQUEST_PRIORITY.default,
      owner: `extension:${group.extensionId}`,
      signal: candidate.backfillController.signal,
      onStart: startBackfillDeadline,
      onEose: completeEose,
      onEvent: event => this.dispatch(group, event),
      onDuplicate: event => this.dispatch(group, event),
    })
      .catch(error => handleError(candidate.backfillController, error))
      .finally(() => {
        if (candidate.backfillTimer) clearTimeout(candidate.backfillTimer)
        candidate.backfillTimer = undefined
        if (!candidate.backfillController.signal.aborted) promote(false)
      })

    const startLive = () => {
      candidate.liveRetryTimer = undefined
      if (
        !isCurrentCandidate() ||
        this.groups.get(this.getGroupKey(group.extensionId, group.relay)) !== group
      ) {
        return
      }

      const controller = new AbortController()
      candidate.liveController = controller

      // The ongoing tail has an independent lifecycle. A failed tail retries
      // without cancelling a queued or in-progress finite backfill.
      void this.request({
        relays: [group.relay],
        filters,
        lifetime: "live",
        priority: RELAY_REQUEST_PRIORITY.background,
        owner: `extension:${group.extensionId}`,
        signal: controller.signal,
        onEose: completeEose,
        onEvent: event => this.dispatch(group, event),
        onDuplicate: event => this.dispatch(group, event),
      })
        .catch(error => handleError(controller, error))
        .finally(() => {
          if (candidate.liveController !== controller) return
          candidate.liveController = undefined
          if (
            !controller.signal.aborted &&
            isCurrentCandidate() &&
            this.groups.get(this.getGroupKey(group.extensionId, group.relay)) === group &&
            group.subscriptionIds.size > 0
          ) {
            candidate.liveRetryTimer = setTimeout(startLive, this.retryDelayMs)
          }
        })
    }

    startLive()
  }

  private abortPhysicalRequest(request: PhysicalRequest) {
    if (request.backfillTimer) clearTimeout(request.backfillTimer)
    if (request.liveRetryTimer) clearTimeout(request.liveRetryTimer)
    request.backfillTimer = undefined
    request.liveRetryTimer = undefined
    request.backfillController.abort()
    request.liveController?.abort()
    request.liveController = undefined
  }

  private dispatchEose(group: RelayGroup, request: PhysicalRequest) {
    for (const id of request.subscriptionIds) {
      const subscription = this.subscriptions.get(id)
      if (
        !subscription ||
        !group.subscriptionIds.has(id) ||
        subscription.eoseRelays.has(group.relay)
      ) {
        continue
      }

      subscription.eoseRelays.add(group.relay)
      subscription.onEose?.(subscription.id, group.relay)
    }
  }

  private dispatch(group: RelayGroup, event: TrustedEvent) {
    for (const id of group.subscriptionIds) {
      const subscription = this.subscriptions.get(id)
      if (subscription && matchFilters(subscription.filters, event)) {
        const deliveryKey = event.id ? `${event.id}\u0000${id}` : ""
        if (deliveryKey && group.seenDeliveryKeys.has(deliveryKey)) continue
        if (deliveryKey) {
          group.seenDeliveryKeys.add(deliveryKey)
          group.seenDeliveryOrder.push(deliveryKey)
          if (group.seenDeliveryOrder.length > MAX_SEEN_EXTENSION_EVENT_DELIVERIES) {
            const oldest = group.seenDeliveryOrder.shift()
            if (oldest) group.seenDeliveryKeys.delete(oldest)
          }
        }
        subscription.onEvent(id, event)
      }
    }
  }
}

export const extensionSubscriptionRegistry = new ExtensionSubscriptionRegistry()

if (import.meta.hot) {
  import.meta.hot.dispose(() => extensionSubscriptionRegistry.close())
}
