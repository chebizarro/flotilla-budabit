import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

const routes = [
  "../../routes/c/[community]/threads/+page.svelte",
  "../../routes/c/[community]/threads/create/+page.svelte",
  "../../routes/c/[community]/threads/[thread]/+page.svelte",
]

describe("exact community thread route contract", () => {
  it("parses only the exact naddr route pointer on direct refresh", () => {
    for (const route of routes) {
      const source = readProjectFile(route)

      expect(source, route).toContain("parseExactCommunityRouteParam($page.params.community)")
      expect(source, route).not.toContain("parseCommunityRouteParam")
      expect(source, route).not.toContain("makeCommunityPath")
      expect(source, route).not.toContain("makeCommunityThreadPath")
    }
  })

  it("separates controller authority, content association, and sibling identity", () => {
    for (const route of routes) {
      const source = readProjectFile(route)

      expect(source, route).toContain("routeCommunity?.controllerPubkey")
      expect(source, route).toContain("routeCommunity?.communityId")
      expect(source, route).toContain("routeCommunity?.address")
      expect(source, route).toContain(
        "$activeExactCommunityDefinition?.pointer.address === communityAddress",
      )
    }

    const list = readProjectFile(routes[0])
    const detail = readProjectFile(routes[2])
    expect(list).toContain("`threads:feed:${communityAddress}:")
    expect(detail).toContain("`community-thread:${communityAddress}:${threadId}`")
  })

  it("uses the community id only for h-scoped content", () => {
    for (const route of routes) {
      const source = readProjectFile(route)

      expect(source, route).toContain("communityId")
      expect(source, route).not.toMatch(/makeExactCommunity\w+Path\(communityId/)
      expect(source, route).not.toContain("community={communityId}")
    }

    expect(readProjectFile(routes[1])).toMatch(
      /makeCommunityThread\(\{\s*communityPubkey: communityId,/,
    )
  })

  it("keeps navigation and modal context exact across same-controller siblings", () => {
    const list = readProjectFile(routes[0])
    const create = readProjectFile(routes[1])
    const detail = readProjectFile(routes[2])
    const item = readProjectFile("../components/ThreadItem.svelte")
    const actions = readProjectFile("../components/ThreadActions.svelte")

    for (const source of [list, create, detail]) {
      expect(source).toContain("makeExactCommunityThreadPath(routeCommunity")
      expect(source).toContain("<CommunityMenuButton community={routeCommunity?.naddr}")
    }
    expect(list).toContain("community={routeCommunity}")
    expect(list).toContain("url={communityControllerPubkey}")
    expect(detail).toContain("community={routeCommunity}")
    expect(detail).toContain("url={communityControllerPubkey}")
    expect(item).toContain("makeExactCommunityThreadPath(community, event.id)")
    expect(actions).toContain("makeExactCommunityThreadPath(community, event.id)")
    expect(actions).toContain("<EventActions")
    expect(actions).toContain("{url}")
  })

  it("recovers failed list routes only through the exact active sibling", () => {
    const retryRoutes = [
      routes[0],
      "../../routes/c/[community]/calendar/+page.svelte",
      "../../routes/c/[community]/goals/+page.svelte",
    ]

    for (const route of retryRoutes) {
      const source = readProjectFile(route)

      expect(source, route).toContain(
        "$activeExactCommunityPointer?.address !== routeCommunity.address",
      )
      expect(source, route).not.toContain(
        "session?.definition.controllerPubkey !== routeCommunity.controllerPubkey",
      )
    }
  })
})
