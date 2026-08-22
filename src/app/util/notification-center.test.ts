// @vitest-environment jsdom

import {describe, expect, it, vi} from "vitest"

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()},
}))

describe("notification center read state", () => {
  it("uses a current persisted schema", async () => {
    const {defaultNotificationReadState, normalizeNotificationReadState} =
      await import("./notification-center")

    expect(defaultNotificationReadState()).toEqual({
      version: 3,
      readRowIdsByPubkey: {},
    })
    expect(
      normalizeNotificationReadState({
        lastReadTimestamp: 10,
        latestNotificationTimestamp: 20,
      } as any),
    ).toEqual(defaultNotificationReadState())
  })
  it("normalizes persisted row ids", async () => {
    const {normalizeNotificationReadState} = await import("./notification-center")

    expect(
      normalizeNotificationReadState({
        version: 3,
        readRowIdsByPubkey: {alice: ["one", "one", "", "two"]},
      }),
    ).toEqual({
      version: 3,
      readRowIdsByPubkey: {alice: ["one", "two"]},
    })
  })

  it("marks only the current account rows read", async () => {
    const {hasUnreadNotificationRowsState, markNotificationRowsReadState} =
      await import("./notification-center")
    const initial = {version: 3 as const, readRowIdsByPubkey: {bob: ["bob-row"]}}
    const read = markNotificationRowsReadState(initial, "alice", ["one", "two"])

    expect(read.readRowIdsByPubkey).toEqual({bob: ["bob-row"], alice: ["one", "two"]})
    expect(hasUnreadNotificationRowsState(read, "alice", ["one", "two"])).toBe(false)
    expect(hasUnreadNotificationRowsState(read, "bob", ["bob-row", "new-row"])).toBe(true)
  })

  it("detects a newly materialized row regardless of its timestamp", async () => {
    const {
      getUnreadNotificationRowIdsState,
      hasUnreadNotificationRowsState,
      markNotificationRowsReadState,
    } = await import("./notification-center")
    const read = markNotificationRowsReadState(undefined, "alice", ["newer-event"])

    expect(hasUnreadNotificationRowsState(read, "alice", ["newer-event"])).toBe(false)
    expect(hasUnreadNotificationRowsState(read, "alice", ["newer-event", "older-event"])).toBe(true)
    expect(getUnreadNotificationRowIdsState(read, "alice", ["newer-event", "older-event"])).toEqual(
      ["older-event"],
    )
  })
})
