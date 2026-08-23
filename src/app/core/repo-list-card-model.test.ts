import {describe, expect, it} from "vitest"
import type {RepoAnnouncementEvent} from "@nostr-git/core/events"
import {createRepoListCardProjector} from "./repo-list-card-model"

const event = (id: string, identifier: string): RepoAnnouncementEvent =>
  ({
    id,
    pubkey: "a".repeat(64),
    kind: 30617,
    created_at: 1,
    content: "",
    sig: "b".repeat(128),
    tags: [
      ["d", identifier],
      ["relays", "wss://relay.example"],
      ["maintainers", "c".repeat(64)],
    ],
  }) as RepoAnnouncementEvent

describe("repository list card projection", () => {
  it("projects stable announcement data once per event revision", () => {
    const project = createRepoListCardProjector()
    const firstCard = {first: event("1", "repo"), title: "Repository"}
    const first = project(firstCard)
    const second = project({...firstCard})

    expect(second).toBe(first)
    expect(first).toMatchObject({
      announcementId: "1",
      address: `30617:${"a".repeat(64)}:repo`,
      owner: "a".repeat(64),
      maintainers: ["c".repeat(64)],
      stableKey: `30617:${"a".repeat(64)}:repo:`,
    })
  })

  it("bounds retained announcement projections", () => {
    const project = createRepoListCardProjector(1)
    const firstCard = {first: event("1", "first")}
    const first = project(firstCard)

    project({first: event("2", "second")})

    expect(project(firstCard)).not.toBe(first)
  })
})
