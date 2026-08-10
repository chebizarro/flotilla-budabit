import {beforeEach, describe, expect, it, vi} from "vitest"
import type {TrustedEvent} from "@welshman/util"

const mocks = vi.hoisted(() => ({query: vi.fn()}))

vi.mock("@welshman/app", () => ({
  repository: {query: mocks.query},
}))

import {assertReplaceablePublicationIsCurrent} from "./replaceable-publication"

const event: TrustedEvent = {
  id: "1".repeat(64),
  pubkey: "a".repeat(64),
  created_at: 10,
  kind: 31923,
  tags: [["d", "calendar-event"]],
  content: "",
  sig: "f".repeat(128),
}

describe("replaceable publication freshness", () => {
  beforeEach(() => mocks.query.mockReset().mockReturnValue([]))

  it("queries the exact replaceable address and permits retry without a newer value", () => {
    mocks.query.mockReturnValue([{...event, id: "0".repeat(64), created_at: 9}])

    expect(() => assertReplaceablePublicationIsCurrent(event)).not.toThrow()
    expect(mocks.query).toHaveBeenCalledWith(
      [{kinds: [event.kind], authors: [event.pubkey], "#d": ["calendar-event"]}],
      {shouldSort: false},
    )
  })

  it("blocks exact retry when a newer value exists at the address", () => {
    mocks.query.mockReturnValue([{...event, id: "2".repeat(64), created_at: 11}])

    expect(() => assertReplaceablePublicationIsCurrent(event)).toThrow(
      "A newer version of this publication already exists",
    )
  })
})
