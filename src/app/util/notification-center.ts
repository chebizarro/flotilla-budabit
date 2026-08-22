import {synced} from "@welshman/store"
import {derived} from "svelte/store"
import {kv} from "@app/core/storage"
import {modal} from "@app/util/modal"

export const NOTIFICATION_CENTER_MODAL_KIND = "notification-center"

export type NotificationReadState = {
  version: 3
  readRowIdsByPubkey: Record<string, string[]>
}

export const defaultNotificationReadState = (): NotificationReadState => ({
  version: 3,
  readRowIdsByPubkey: {},
})

const MAX_READ_NOTIFICATION_ROWS = 5_000

const normalizeRowIds = (rowIds: unknown) =>
  Array.from(
    new Set(
      (Array.isArray(rowIds) ? rowIds : [])
        .map(rowId => String(rowId || "").trim())
        .filter(Boolean),
    ),
  ).slice(0, MAX_READ_NOTIFICATION_ROWS)

export const normalizeNotificationReadState = (
  state: Partial<NotificationReadState> | undefined,
): NotificationReadState =>
  state?.version === 3
    ? {
        version: 3,
        readRowIdsByPubkey: Object.fromEntries(
          Object.entries(state.readRowIdsByPubkey || {}).flatMap(([pubkey, rowIds]) => {
            const normalizedPubkey = pubkey.trim()
            return normalizedPubkey ? [[normalizedPubkey, normalizeRowIds(rowIds)]] : []
          }),
        ),
      }
    : defaultNotificationReadState()

export const markNotificationRowsReadState = (
  state: Partial<NotificationReadState> | undefined,
  pubkey: string | undefined,
  rowIds: Iterable<string>,
): NotificationReadState => {
  const current = normalizeNotificationReadState(state)
  const account = String(pubkey || "").trim()
  if (!account) return current

  return {
    version: 3,
    readRowIdsByPubkey: {
      ...current.readRowIdsByPubkey,
      [account]: normalizeRowIds([
        ...Array.from(rowIds),
        ...(current.readRowIdsByPubkey[account] || []),
      ]),
    },
  }
}

export const hasUnreadNotificationRowsState = (
  state: Partial<NotificationReadState> | undefined,
  pubkey: string | undefined,
  rowIds: Iterable<string>,
) => {
  const current = normalizeNotificationReadState(state)
  const account = String(pubkey || "").trim()
  if (!account) return false
  const readRowIds = new Set(current.readRowIdsByPubkey[account] || [])

  return Array.from(rowIds).some(rowId => Boolean(rowId) && !readRowIds.has(rowId))
}

export const getUnreadNotificationRowIdsState = (
  state: Partial<NotificationReadState> | undefined,
  pubkey: string | undefined,
  rowIds: Iterable<string>,
) => {
  const current = normalizeNotificationReadState(state)
  const account = String(pubkey || "").trim()
  if (!account) return []
  const readRowIds = new Set(current.readRowIdsByPubkey[account] || [])

  return Array.from(rowIds).filter(rowId => Boolean(rowId) && !readRowIds.has(rowId))
}

export const notificationCenterOpen = derived(
  modal,
  $modal => $modal?.options.kind === NOTIFICATION_CENTER_MODAL_KIND,
)

export const notificationReadState = synced<NotificationReadState>({
  key: "notificationCenter.readState",
  defaultValue: defaultNotificationReadState(),
  storage: kv,
})

export const markNotificationRowsRead = (pubkey: string | undefined, rowIds: Iterable<string>) =>
  notificationReadState.update(state => markNotificationRowsReadState(state, pubkey, rowIds))

export const clearNotificationReadState = () =>
  notificationReadState.set(defaultNotificationReadState())
