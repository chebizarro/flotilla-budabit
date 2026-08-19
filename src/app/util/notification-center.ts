import {synced} from "@welshman/store"
import {kv} from "@app/core/storage"

export type NotificationReadState = {
  version: 2
  lastReadTimestamp: number
  latestNotificationTimestamp: number
}

export const defaultNotificationReadState = (): NotificationReadState => ({
  version: 2,
  lastReadTimestamp: 0,
  latestNotificationTimestamp: 0,
})

export const normalizeNotificationTimestamp = (timestamp: unknown) => {
  const value = Number(timestamp || 0)
  if (!Number.isFinite(value) || value <= 0) return 0

  return value > 10_000_000_000 ? Math.round(value / 1000) : Math.round(value)
}

export const normalizeNotificationReadState = (
  state: Partial<NotificationReadState> | undefined,
): NotificationReadState =>
  state?.version === 2
    ? {
        version: 2,
        lastReadTimestamp: normalizeNotificationTimestamp(state.lastReadTimestamp),
        latestNotificationTimestamp: normalizeNotificationTimestamp(
          state.latestNotificationTimestamp,
        ),
      }
    : defaultNotificationReadState()

export const rememberLatestNotificationTimestampState = (
  state: Partial<NotificationReadState> | undefined,
  timestamp: unknown,
): NotificationReadState => {
  const current = normalizeNotificationReadState(state)
  const latestNotificationTimestamp = Math.max(
    current.latestNotificationTimestamp,
    normalizeNotificationTimestamp(timestamp),
  )

  return {...current, latestNotificationTimestamp}
}

export const markNotificationsReadState = (
  state: Partial<NotificationReadState> | undefined,
  timestamp?: unknown,
): NotificationReadState => {
  const current = rememberLatestNotificationTimestampState(state, timestamp)
  const readTimestamp =
    normalizeNotificationTimestamp(timestamp) || current.latestNotificationTimestamp

  return {
    version: 2,
    latestNotificationTimestamp: current.latestNotificationTimestamp,
    lastReadTimestamp: Math.max(current.lastReadTimestamp, readTimestamp),
  }
}

export const hasUnreadNotificationsState = (state: Partial<NotificationReadState> | undefined) => {
  const current = normalizeNotificationReadState(state)

  return current.latestNotificationTimestamp > current.lastReadTimestamp
}

export const notificationReadState = synced<NotificationReadState>({
  key: "notificationCenter.readState",
  defaultValue: defaultNotificationReadState(),
  storage: kv,
})

export const rememberLatestNotificationTimestamp = (timestamp: unknown) =>
  notificationReadState.update(state => rememberLatestNotificationTimestampState(state, timestamp))

export const markNotificationsRead = (timestamp?: unknown) =>
  notificationReadState.update(state => markNotificationsReadState(state, timestamp))

export const clearNotificationReadState = () =>
  notificationReadState.set(defaultNotificationReadState())
