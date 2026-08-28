import {describe, expect, it} from "vitest"
import {getRepoRenameAddresses, recordRepoRename} from "./repo-rename-history"

const storage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

describe("repository rename history", () => {
  it("retains an exact transitive owner-scoped rename chain", () => {
    const owner = "a".repeat(64)
    const other = "b".repeat(64)
    const local = storage()
    recordRepoRename({owner, previousIdentifier: "one", nextIdentifier: "two", storage: local})
    recordRepoRename({owner, previousIdentifier: "two", nextIdentifier: "three", storage: local})
    recordRepoRename({
      owner: other,
      previousIdentifier: "one",
      nextIdentifier: "other",
      storage: local,
    })

    expect(getRepoRenameAddresses(`30617:${owner}:three`, local)).toEqual([
      `30617:${owner}:three`,
      `30617:${owner}:two`,
      `30617:${owner}:one`,
    ])
  })
})
