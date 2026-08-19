import "fake-indexeddb/auto"
import {describe, expect, it} from "vitest"

import {getPRPreviewData} from "../../src/git/merge-analysis.js"

describe("git/merge-analysis: PR preview branch resolution", () => {
  const createChangedFileGit = (content: string | Uint8Array) => {
    const sourceOid = "3333333333333333333333333333333333333333"
    const targetOid = "2222222222222222222222222222222222222222"
    const baseOid = "1111111111111111111111111111111111111111"
    const before = {type: async () => "blob", oid: async () => "before-oid"}
    const after = {type: async () => "blob", oid: async () => "after-oid"}

    return {
      async resolveRef({ref}: {ref: string}) {
        if (ref === "refs/heads/feature") return sourceOid
        if (ref === "refs/heads/main") return targetOid
        throw new Error(`unexpected ref: ${ref}`)
      },
      async findMergeBase() {
        return baseOid
      },
      async log() {
        return [
          {oid: sourceOid, commit: {message: "feature", parent: [baseOid]}},
          {oid: baseOid, commit: {message: "base", parent: []}},
        ]
      },
      TREE(args: unknown) {
        return args
      },
      async walk({map}: {map: (path: string, entries: unknown[]) => Promise<unknown>}) {
        return [await map("config.env", [before, after])]
      },
      async readBlob() {
        return {blob: typeof content === "string" ? new TextEncoder().encode(content) : content}
      },
    }
  }

  it("requires source branch to exist on fork remote when sourceRemote is provided", async () => {
    const gitMock: any = {
      async resolveRef({ref}: {ref: string}) {
        if (ref === "refs/remotes/fork/feature") {
          throw new Error("not found")
        }
        if (ref === "fork/feature") {
          throw new Error("not found")
        }
        if (ref === "refs/heads/feature") {
          return "1111111111111111111111111111111111111111"
        }
        if (ref === "refs/remotes/origin/main") {
          return "2222222222222222222222222222222222222222"
        }
        throw new Error(`unexpected ref: ${ref}`)
      },
    }

    const result = await getPRPreviewData(gitMock, "/repo", "feature", "main", {
      sourceRemote: "fork",
      preferRemoteRefs: true,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain("not found on fork remote")
  })

  it("returns findings that block PR creation when a changed file contains a secret", async () => {
    const result = await getPRPreviewData(
      createChangedFileGit("REMOTE=https://contributor:planted-secret-value@example.org\n") as any,
      "/repo",
      "feature",
      "main",
    )

    expect(result.success).toBe(true)
    expect(result.secretFindings).toHaveLength(1)
    expect(result.secretFindings[0]?.path).toBe("config.env")
    expect(result.secretFindings[0]?.maskedSnippet).not.toContain("planted-secret-value")
  })

  it("still detects ASCII credentials in malformed UTF-8 text", async () => {
    const prefix = new TextEncoder().encode(
      "REMOTE=https://contributor:planted-secret-value@example.org\n",
    )
    const malformed = new Uint8Array([...prefix, 0xff])
    const result = await getPRPreviewData(
      createChangedFileGit(malformed) as any,
      "/repo",
      "feature",
      "main",
    )

    expect(result.success).toBe(true)
    expect(result.secretFindings).toHaveLength(1)
  })

  it("returns no findings so clean PR creation can proceed", async () => {
    const result = await getPRPreviewData(
      createChangedFileGit("FEATURE_ENABLED=true\n") as any,
      "/repo",
      "feature",
      "main",
    )

    expect(result.success).toBe(true)
    expect(result.secretFindings).toEqual([])
  })

  it("still resolves source from local refs when sourceRemote is not set", async () => {
    const gitMock: any = {
      async resolveRef({ref}: {ref: string}) {
        if (ref === "refs/heads/feature") {
          return "3333333333333333333333333333333333333333"
        }
        if (ref === "refs/remotes/origin/main") {
          return "3333333333333333333333333333333333333333"
        }
        throw new Error(`unexpected ref: ${ref}`)
      },
    }

    const result = await getPRPreviewData(gitMock, "/repo", "feature", "main", {
      preferRemoteRefs: true,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain("No commits to merge")
  })
})
