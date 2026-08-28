import {describe, expect, it} from "vitest"

import {resolveRepoReadmeHref} from "./repo-readme-links"

const repoPath = "/git/naddr1repo"

describe("resolveRepoReadmeHref", () => {
  it("routes relative file links through the repository code viewer", () => {
    expect(resolveRepoReadmeHref("docs/nip-5d.md", repoPath)).toBe(
      "/git/naddr1repo/code?path=docs%2Fnip-5d.md",
    )
    expect(resolveRepoReadmeHref("./docs/my guide.md", `${repoPath}/`)).toBe(
      "/git/naddr1repo/code?path=docs%2Fmy%20guide.md",
    )
  })

  it("normalizes relative path segments and preserves file fragments", () => {
    expect(resolveRepoReadmeHref("docs/guide/../api.md#examples", repoPath)).toBe(
      "/git/naddr1repo/code?path=docs%2Fapi.md#examples",
    )
  })

  it("routes relative directory links through the repository browser", () => {
    expect(resolveRepoReadmeHref("docs/", repoPath)).toBe("/git/naddr1repo/code?dir=docs%2F")
  })

  it.each([
    "#authoring-context",
    "/settings",
    "//example.com/docs",
    "https://example.com/docs",
    "mailto:maintainer@example.com",
  ])("leaves non-repository link %s unchanged", href => {
    expect(resolveRepoReadmeHref(href, repoPath)).toBe(href)
  })
})
