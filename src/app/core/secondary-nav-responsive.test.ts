import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("secondary navigation responsive mounting", () => {
  it("mounts child effects only while the desktop media query matches", () => {
    const source = read("src/lib/components/SecondaryNav.svelte")

    expect(source).toContain("new MediaQuery(`min-width: ${minWidth}px`, false)")
    expect(source).toMatch(
      /\{#if visible\.current\}[\s\S]*\{@render children\?\.\(\)\}[\s\S]*\{\/if\}/,
    )
  })

  it("keeps community and git menus in responsive secondary navigation", () => {
    for (const path of [
      "src/routes/c/[community]/+layout.svelte",
      "src/routes/git/+layout.svelte",
    ]) {
      const source = read(path)
      expect(source).toMatch(/<SecondaryNav>[\s\S]*<CommunityMenu community=/)
    }
  })

  it("preserves the chat navigation md breakpoint", () => {
    const source = read("src/routes/chat/+layout.svelte")

    expect(source).toContain('<SecondaryNav visibleClass="md:flex" minWidth={768}>')
  })
})
