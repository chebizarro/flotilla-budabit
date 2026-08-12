import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")
const dense = (source: string) => source.replace(/\s+/g, "")

describe("authoritative repository loading scope", () => {
  it("uses route hints only for kind 30617 discovery", () => {
    const routeLoad = dense(readProjectFile("../../routes/git/[id=naddr]/+layout.ts"))
    const layout = dense(readProjectFile("../../routes/git/[id=naddr]/+layout.svelte"))
    const initialLoad = layout.slice(
      layout.indexOf("//Useeffectonlyfordataloading"),
      layout.indexOf("constflushPendingRepoAddressLoads"),
    )
    const announcementLoad = initialLoad.slice(
      initialLoad.indexOf("constannouncementFilters"),
      initialLoad.indexOf("constrelayListFromUrl"),
    )

    expect(routeLoad).toContain("constannouncementDiscoveryRelays=Array.from(")
    expect(routeLoad).toContain(
      "newSet([...naddrRelays,...targetOutboxRelays,...configuredFallbackRelays])",
    )
    expect(layout).toContain("getRepoScopedRelays(re,{pubkey:repoPubkey,identifier:repoName})")
    expect(announcementLoad).toContain("kinds:[GIT_REPO_ANNOUNCEMENT]")
    expect(announcementLoad).not.toContain("GIT_REPO_STATE")
    expect(initialLoad).toContain("constrelayListFromUrl=$repoRelaysStore")
    expect(initialLoad).toContain("if(relayListFromUrl.length===0)")
    expect(initialLoad).toContain("kinds:[GIT_REPO_STATE]")
  })

  it("does not pass naddr hints into child repository activity loading", () => {
    for (const path of [
      "../../routes/git/[id=naddr]/issues/+page.svelte",
      "../../routes/git/[id=naddr]/issues/[issueid]/+page.svelte",
      "../../routes/git/[id=naddr]/prs/[prid]/+page.svelte",
    ]) {
      const source = readProjectFile(path)

      expect(source).toContain("REPO_RELAYS_KEY")
      expect(source).not.toContain("naddrRelays")
    }

    const testRoute = readProjectFile("../../routes/git/[id=naddr]/test/+page.svelte")
    expect(testRoute).toContain("REPO_RELAYS_KEY")
    expect(testRoute).not.toContain("($page.data as any)?.url")
    expect(testRoute).not.toContain("wss://relay.budabit.club")
  })

  it("delegates exact detail resolution to the layout while retaining UI deadlines", () => {
    const issueDetail = dense(
      readProjectFile("../../routes/git/[id=naddr]/issues/[issueid]/+page.svelte"),
    )
    const prDetail = dense(readProjectFile("../../routes/git/[id=naddr]/prs/[prid]/+page.svelte"))
    const issueResolution = issueDetail.slice(
      issueDetail.indexOf("constISSUE_RESOLVE_TIMEOUT_MS"),
      issueDetail.indexOf("//Filterhelpersusedwhenrefreshinglabels"),
    )

    expect(issueDetail).toContain('constissueId=$derived($page.params.issueid??"")')
    expect(issueResolution).toContain("repoRootHistory.ensureRoot(currentIssueId)")
    expect(issueResolution).toContain("},ISSUE_RESOLVE_TIMEOUT_MS)")
    expect(issueDetail).not.toContain("makeLoader")
    expect(issueDetail).not.toContain("RepoCore.buildRepoSubscriptions")
    expect(issueDetail).toContain("RepositoryRelaysUnavailable")

    expect(prDetail).toContain("repoRootHistory.ensureRoot(currentPrId)")
    expect(prDetail).toContain("},LOAD_TIMEOUT_MS)")
    expect(prDetail).not.toContain("makeLoader")
    expect(prDetail).not.toContain("deriveEventsById")
    expect(prDetail).toContain("RepositoryRelaysUnavailable")
  })

  it("keeps child lists and PRView free of initial repository activity ownership", () => {
    const issueList = readProjectFile("../../routes/git/[id=naddr]/issues/+page.svelte")
    const prList = readProjectFile("../../routes/git/[id=naddr]/prs/+page.svelte")
    const prView = readProjectFile("../components/PRView.svelte")
    const initialPrView = prView.slice(
      prView.indexOf("// PR-specific status and comments"),
      prView.indexOf("const prEffectiveTipOid"),
    )

    expect(issueList).not.toContain("makeFeed")
    expect(prList).not.toContain("makeFeed")
    expect(issueList).not.toContain("// Prefetch recent issue edit events")
    expect(initialPrView).not.toContain("load({")
  })

  it("keeps issue and pull request list empty states behind a cold-start deadline", () => {
    for (const path of [
      "../../routes/git/[id=naddr]/issues/+page.svelte",
      "../../routes/git/[id=naddr]/prs/+page.svelte",
    ]) {
      const source = dense(readProjectFile(path))

      expect(source).toContain("constLIST_RESOLVE_TIMEOUT_MS=15_000")
      expect(source).toContain('status:"loading"')
      expect(source).toContain("},LIST_RESOLVE_TIMEOUT_MS)")
      expect(source.indexOf("{#ifloading}")).toBeLessThan(source.indexOf("found."))
    }
  })

  it("partitions owned repository state loads without Git relay fallback", () => {
    const layout = dense(readProjectFile("../../routes/git/[id=naddr]/+layout.svelte"))
    const ownedStateLoad = layout.slice(
      layout.indexOf("constmyRepoStateLoadScopes"),
      layout.indexOf("constbuildRepoBranchUpdate"),
    )

    expect(ownedStateLoad).toContain("getOwnedRepoStateLoadScopes(latestMyRepos,$pubkey)")
    expect(ownedStateLoad).toContain("getOwnedRepoStateLoadPlans(latestMyRepos,$pubkey)")
    expect(ownedStateLoad).toContain("for(constplanofplans)")
    expect(ownedStateLoad).toContain('"#d":plan.repoIds')
    expect(ownedStateLoad).toContain("load({relays:[plan.relay],filters:[filter]})")
    expect(ownedStateLoad).not.toContain("GIT_RELAYS")
  })

  it("uses stable per-relay live lanes without root-set dependencies", () => {
    const source = readProjectFile("../../routes/git/[id=naddr]/+layout.svelte")
    const layout = dense(source)

    expect(layout).toContain("buildRepoStableLiveFilters")
    expect(layout).toContain("buildRepoExactThreadLiveFilters(exactRootId)")
    expect(layout).toContain("registerRepoLiveOwnership(address,relay)")
    expect(layout).toContain('owner:"repo-foreground:stable"')
    expect(layout).toContain('owner:"repo-foreground:announcement"')
    expect(layout).toContain('owner:"repo-foreground:exact-thread"')
    expect(layout).not.toContain("repoLiveSubscriptionFiltersKey")
    expect(layout).not.toContain("buildRepoLiveFilters({addresses,rootIds,viewer})")
  })

  it("aborts list and repository layout finite work on route teardown", () => {
    const list = dense(readProjectFile("../../routes/git/+page.svelte"))
    const layout = dense(readProjectFile("../../routes/git/[id=naddr]/+layout.svelte"))

    expect(list).toContain("constgitPageLoadController=newAbortController()")
    expect(list).toContain("gitPageLoadController.abort()")
    expect(list).toContain("loadaswelshmanLoad,typeLoadOptions")
    expect(layout).toContain("constlayoutLoadController=newAbortController()")
    expect(layout).toContain("layoutLoadController.abort()")
    expect(layout).toContain("disposeActiveRepo(routeRepoClass)")
  })

  it("hydrates the verified repository cache before route activity starts", () => {
    const layout = dense(readProjectFile("../../routes/git/[id=naddr]/+layout.svelte"))
    const hydration = layout.slice(
      layout.indexOf("onMount(()=>{letcancelled=false"),
      layout.indexOf("constrepoStatusKinds"),
    )

    expect(hydration).toContain("accessRepositoryCache(getStore(repoAddressStore))")
    expect(hydration.indexOf("accessRepositoryCache")).toBeLessThan(
      hydration.indexOf("repoActivityHydrationReady.set(true)"),
    )
    expect(layout).toContain("receiveRepositoryCacheEvent(event,relay,getStore(repoAddressStore))")
  })

  it("does not initialize repository extensions without relay authority", () => {
    const extensionPage = readProjectFile(
      "../../routes/git/[id=naddr]/extensions/[extId]/+page.svelte",
    )

    expect(extensionPage).toContain("REPO_RELAYS_KEY")
    expect(extensionPage).toContain("hasRepoRelayAuthority")
    expect(extensionPage).toContain("Repository Relays Unavailable")
    expect(extensionPage).not.toContain("@welshman/router")
    expect(extensionPage).not.toContain("wss://relay.budabit.club/")
    expect(extensionPage).not.toContain("wss://nos.lol/")
  })
})
