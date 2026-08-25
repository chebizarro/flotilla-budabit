import {now} from "@welshman/lib"
import {Repository} from "@welshman/net"
import {getAddress, isReplaceable, type TrustedEvent} from "@welshman/util"
import {measurePerformanceDiagnosticsWork} from "@app/core/performance-diagnostics"

export const MAX_NOTIFICATION_EVENTS = 4_000
export const MAX_NOTIFICATION_EVENT_AGE_SECONDS = 60 * 60 * 24 * 90

type RetainedEvent = {
  createdAt: number
  order: number
}

export class NotificationEventStore {
  readonly repository = new Repository()

  private readonly retainedById = new Map<string, RetainedEvent>()
  private readonly relaysById = new Map<string, Set<string>>()
  private nextOrder = 0

  constructor(
    readonly maxEvents = MAX_NOTIFICATION_EVENTS,
    readonly maxAgeSeconds = MAX_NOTIFICATION_EVENT_AGE_SECONDS,
  ) {}

  publish(event: TrustedEvent, relay: string, currentTime = now()) {
    if (!event?.id || event.created_at < currentTime - this.maxAgeSeconds) return false

    if (isReplaceable(event)) {
      const current = this.repository.getEvent(getAddress(event))
      if (current && current.id !== event.id) {
        if (current.created_at > event.created_at) return false
        this.remove(current.id)
      }
    }

    const published = this.repository.publish(event)
    if (published) {
      this.retainedById.set(event.id, {createdAt: event.created_at, order: this.nextOrder++})
    }

    if (published || this.retainedById.has(event.id)) this.addRelay(event.id, relay)
    this.prune(currentTime)
    return published
  }

  getRelays(eventId: string) {
    return Array.from(this.relaysById.get(eventId) || [])
  }

  get size() {
    return this.retainedById.size
  }

  clear() {
    for (const eventId of Array.from(this.retainedById.keys())) this.repository.removeEvent(eventId)
    this.retainedById.clear()
    this.relaysById.clear()
  }

  private addRelay(eventId: string, relay: string) {
    if (!relay) return
    const relays = this.relaysById.get(eventId) || new Set<string>()
    relays.add(relay)
    this.relaysById.set(eventId, relays)
  }

  private remove(eventId: string) {
    this.repository.removeEvent(eventId)
    this.retainedById.delete(eventId)
    this.relaysById.delete(eventId)
  }

  private prune(currentTime: number) {
    const cutoff = currentTime - this.maxAgeSeconds
    for (const [eventId, retained] of this.retainedById) {
      if (retained.createdAt < cutoff) this.remove(eventId)
    }

    while (this.retainedById.size > this.maxEvents) {
      let oldestId = ""
      let oldest: RetainedEvent | undefined
      for (const [eventId, retained] of this.retainedById) {
        if (
          !oldest ||
          retained.createdAt < oldest.createdAt ||
          (retained.createdAt === oldest.createdAt && retained.order < oldest.order)
        ) {
          oldestId = eventId
          oldest = retained
        }
      }
      if (!oldestId) break
      this.remove(oldestId)
    }
  }
}

export const notificationEvents = new NotificationEventStore()
export const notificationEventRepository = notificationEvents.repository
export const receiveNotificationEvent = (event: TrustedEvent, relay: string) =>
  notificationEvents.publish(event, relay)
const queuedNotificationEvents = new Map<string, {event: TrustedEvent; relays: Set<string>}>()
let notificationEventFlushTimer: ReturnType<typeof setTimeout> | undefined
export const cancelQueuedNotificationEvents = () => {
  if (notificationEventFlushTimer) clearTimeout(notificationEventFlushTimer)
  notificationEventFlushTimer = undefined
  queuedNotificationEvents.clear()
}

export const queueNotificationEvent = (event: TrustedEvent, relay: string) => {
  const current = queuedNotificationEvents.get(event.id)
  const relays = current?.relays || new Set<string>()
  if (relay) relays.add(relay)
  queuedNotificationEvents.set(event.id, {event, relays})
  if (notificationEventFlushTimer) return
  notificationEventFlushTimer = setTimeout(() => {
    notificationEventFlushTimer = undefined
    const queued = Array.from(queuedNotificationEvents.values())
    queuedNotificationEvents.clear()
    measurePerformanceDiagnosticsWork(
      {owner: "notifications", phase: "event-flush", detail: {events: queued.length}},
      () =>
        notificationEventRepository.batch(() => {
          for (const item of queued) {
            if (item.relays.size === 0) notificationEvents.publish(item.event, "")
            else for (const relay of item.relays) notificationEvents.publish(item.event, relay)
          }
        }),
    )
  }, 16)
}
export const getNotificationEventRelays = (eventId: string) => notificationEvents.getRelays(eventId)
