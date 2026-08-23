import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("Git list navigation lifecycle", () => {
  it("does not irreversibly stop page work during speculative navigation", () => {
    const source = read("src/routes/git/+page.svelte")

    expect(source).not.toContain("beforeNavigate")
    expect(source).toMatch(/onDestroy\(\(\) => \{\s*stopGitPageReadWork\(\)/)
  })

  it("stops layout preload only after the committed route id changes", () => {
    const source = read("src/routes/git/+layout.svelte")

    expect(source).not.toContain("beforeNavigate")
    expect(source).toContain('const isRepositoryList = $page.route.id === "/git"')
    expect(source).toMatch(/if \(!isRepositoryList\) \{\s*stopRepoListPreload\(\)/)
    expect(source).toContain("return () => {")
    expect(source).toContain("controller.abort()")
  })
})
