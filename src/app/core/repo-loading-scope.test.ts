import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")
const dense = (source: string) => source.replace(/\s+/g, "")

describe("authoritative repository loading scope", () => {
  it("uses route hints only for kind 30617 discovery", () => {
    const routeLoad = dense(readProjectFile("../../routes/git/[id=naddr]/+layout.ts"))
    const layout = dense(readProjectFile("../../routes/git/[id=naddr]/RepoSession.svelte"))

    expect(routeLoad).toContain("constannouncementDiscoveryRelays=normalizeRepoRelays(")
    expect(routeLoad).not.toContain("refreshPubkeyOutboxRelays")
    expect(layout).toContain("getRepoScopedRelays(re,{pubkey:repoPubkey,identifier:repoName})")
    expect(layout).toContain('owner:"repo-foreground:announcement-refresh"')
    expect(layout).not.toContain("issuePrStatusLoad")
    expect(layout).not.toContain("flushPendingRepoAddressLoads")
    expect(layout).not.toContain("repoInitialLoads")
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

  it("delegates exact detail resolution and retry to the layout without UI deadlines", () => {
    const issueDetail = dense(
      readProjectFile("../../routes/git/[id=naddr]/issues/[issueid]/+page.svelte"),
    )
    const prDetail = dense(readProjectFile("../../routes/git/[id=naddr]/prs/[prid]/+page.svelte"))
    const issueResolution = issueDetail.slice(
      issueDetail.indexOf("letissueResolution"),
      issueDetail.indexOf("//Filterhelpersusedwhenrefreshinglabels"),
    )

    expect(issueDetail).toContain('constissueId=$derived($page.params.issueid??"")')
    expect(issueResolution).toContain(
      "repoRootHistory.ensureRoot(currentIssueId,controller.signal)",
    )
    expect(issueResolution).toContain("controller.abort()")
    expect(issueResolution).toContain("voidissueEvent")
    expect(issueResolution).toContain("issueResolutionNonce+=1")
    expect(issueDetail).not.toContain("ISSUE_RESOLVE_TIMEOUT_MS")
    expect(issueDetail).not.toContain("makeLoader")
    expect(issueDetail).not.toContain("RepoCore.buildRepoSubscriptions")
    expect(issueDetail).toContain("RepositoryRelaysUnavailable")
    expect(issueDetail).toContain(
      'hasRepoAnnouncement&&announcementStatus==="complete"&&!$repoCacheHydrationPendingStore&&!$repoCacheHydrationFailedStore&&repoBoundRelays.length===0',
    )
    expect(issueDetail).not.toContain("announcementLiveCoveragePartial")

    expect(prDetail).toContain("repoRootHistory.ensureRoot(currentPrId,controller.signal)")
    expect(prDetail).toContain("controller.abort()")
    expect(prDetail).toContain("prResolutionNonce+=1")
    expect(prDetail).not.toContain("LOAD_TIMEOUT_MS")
    expect(prDetail).not.toContain("makeLoader")
    expect(prDetail).not.toContain("deriveEvent(prId)")
    expect(prDetail).toContain("RepositoryRelaysUnavailable")
    expect(prDetail).toContain(
      'hasRepoAnnouncement&&announcementStatus==="complete"&&!$repoCacheHydrationPendingStore&&!$repoCacheHydrationFailedStore&&repoRelays.length===0',
    )
    expect(prDetail).not.toContain("announcementLiveCoveragePartial")
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

  it("derives issue and pull request list states from route-owned history", () => {
    for (const path of [
      "../../routes/git/[id=naddr]/issues/+page.svelte",
      "../../routes/git/[id=naddr]/prs/+page.svelte",
    ]) {
      const source = dense(readProjectFile(path))

      expect(source).not.toContain("LIST_RESOLVE_TIMEOUT_MS")
      expect(source).toContain("getRepoRootListPresentation")
      expect(source).toContain("$repoRootHistory")
      expect(source).toContain("$repoAnnouncementStatusStore")
      expect(source).toContain("$repoCacheHydrationFailedStore")
      expect(source).not.toContain("$repoLiveCoveragePartialStore")
      expect(source).toContain("retryRootHistory()")
      expect(source).toContain('aria-live="polite"')
    }
  })

  it("partitions owned repository state loads without Git relay fallback", () => {
    const layout = dense(readProjectFile("../../routes/git/[id=naddr]/RepoSession.svelte"))
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
    const source = readProjectFile("../../routes/git/[id=naddr]/RepoSession.svelte")
    const layout = dense(source)

    expect(layout).toContain("buildRepoStableLiveFilters")
    expect(layout).toContain(
      "exactThreadIds.flatMap(rootId=>buildRepoExactThreadLiveFilters(rootId))",
    )
    expect(layout).toContain("registerRepoLiveOwnership(address,relay)")
    expect(layout).toContain('owner:"repo-foreground:stable"')
    expect(layout).toContain('owner:"repo-foreground:announcement"')
    expect(layout).toContain('owner:"repo-foreground:exact-thread"')
    expect(layout).toContain("gapFillQueue.catch(()=>undefined).then")
    expect(layout).toContain(
      'if($repoRootHistoryState.status!=="complete"||$repoAnnouncementStatus==="loading")return',
    )
    expect(layout).toContain("subscribe:repoRootHistoryState.subscribe")
    expect(layout).toContain(
      'constliveActivityRelays=$repoAnnouncementStatus==="loading"&&repoActivityLiveByRelay.size===0?[]:activityRelays.slice(0,6)',
    )
    expect(layout).toContain(
      'constliveAnnouncementRelays=$repoAnnouncementStatus==="loading"&&repoAnnouncementLiveByRelay.size===0?[]:announcementRelays.slice(0,6)',
    )
    expect(layout).toContain("...$discoveredAnnouncementRelays")
    expect(layout).not.toContain("repoLiveSubscriptionFiltersKey")
    expect(layout).not.toContain("buildRepoLiveFilters({addresses,rootIds,viewer})")
  })

  it("groups relay failures and portals their details above repository content", () => {
    const notice = dense(readProjectFile("../components/RepoRelayFailureNotice.svelte"))
    const popover = dense(readProjectFile("../../lib/components/InlinePopover.svelte"))

    expect(notice).toContain("constfailuresByRelay=derived(failedRelayRequests")
    expect(notice).toContain("{#each$failuresByRelayasgroup(group.relay)}")
    expect(notice).toContain("{#eachgroup.requestsasrequest(request.key)}")
    expect(popover).toContain("document.body.appendChild(node)")
    expect(popover).toContain("use:portal")
  })

  it("aborts list and repository layout finite work on route teardown", () => {
    const list = dense(readProjectFile("../../routes/git/+page.svelte"))
    const listLayout = dense(readProjectFile("../../routes/git/+layout.svelte"))
    const layout = dense(readProjectFile("../../routes/git/[id=naddr]/RepoSession.svelte"))

    expect(list).toContain("constgitPageLoadController=newAbortController()")
    expect(list).toContain("gitPageLoadController.abort()")
    expect(list).toContain("loadaswelshmanLoad,typeLoadOptions")
    expect(listLayout).toContain('constisRepositoryList=$page.route.id==="/git"')
    expect(listLayout).toContain("controller.abort()")
    expect(layout).toContain("constlayoutLoadController=newAbortController()")
    expect(layout).toContain("layoutLoadController.abort()")
    expect(layout).toContain("repoRootHistoryController?.abort()")
    expect(layout).toContain("retryCacheHydration:hydrateRepoActivityCache")
    expect(layout).toContain("cacheHydrationPending:repoCacheHydrationPending")
    expect(layout).toContain('owner:"repo-foreground:announcement-refresh"')
    expect(layout).toContain("priority:RELAY_REQUEST_PRIORITY.foreground")
    expect(layout.indexOf("voidhistory.loadRecent()")).toBeLessThan(
      layout.indexOf("reconcileRepoLiveLane({lanes:repoActivityLiveByRelay"),
    )
    expect(layout).toContain(
      '$repoAnnouncementStatus==="loading"&&repoAnnouncementLiveByRelay.size===0?[]:announcementRelays.slice(0,6)',
    )
    expect(layout).not.toContain('label={issuesCount>0?`Issues(${issuesCount})`:"Issues"}')
    expect(layout).not.toContain('label={prsCount>0?`PRs(${prsCount})`:"PRs"}')
    expect(layout).toContain("disposeActiveRepo(routeRepoClass)")
  })

  it("hydrates list cache before bounded background announcement coverage", () => {
    const layout = dense(readProjectFile("../../routes/git/+layout.svelte"))
    const preload = dense(readProjectFile("./repo-list-preload.ts"))
    const page = dense(readProjectFile("../../routes/git/+page.svelte"))

    expect(layout).toContain("preloadRepositoryList({relays,signal:controller.signal")
    expect(layout).toContain("repoListHydrationReady.set(true)")
    expect(preload.indexOf("awaitdependencies.hydrateEligible()")).toBeLessThan(
      preload.indexOf("awaitdependencies.request({"),
    )
    expect(preload).toContain("limit:REPO_LIST_ANNOUNCEMENT_LIMIT")
    expect(preload).toContain("priority:RELAY_REQUEST_PRIORITY.background")
    expect(preload).toContain("owner:REPO_LIST_PRELOAD_OWNER")
    expect(preload).toContain("repositoryCache.hydrateEligibleAnnouncements()")
    expect(page).toContain("if(!$repoListHydrationReadyStore)")
  })

  it("keeps discovery search membership separate from canonical announcements", () => {
    const page = dense(readProjectFile("../../routes/git/+page.svelte"))
    const discovered = page.slice(
      page.indexOf("constmatchedDiscoveredSearchRepos"),
      page.indexOf("constcanContinueRepoDiscovery"),
    )

    expect(discovered).toContain("discoveredSearchRepoPool.filter")
    expect(discovered).not.toContain("$repoAnnouncements")
  })

  it("starts route activity without waiting for repository cache hydration", () => {
    const layout = dense(readProjectFile("../../routes/git/[id=naddr]/RepoSession.svelte"))
    const mountHydration = layout.slice(
      layout.indexOf("onMount(()=>{repoActivityHydrationReady.set(true)"),
      layout.indexOf("constrepoStatusKinds"),
    )
    const cacheHydration = layout.slice(
      layout.indexOf("consthydrateRepoActivityCache"),
      layout.indexOf("constdeferUntilRepoActivityHydrated"),
    )

    expect(cacheHydration).toContain("accessRepositoryCache(getStore(repoAddressStore))")
    expect(cacheHydration).toContain("repoCacheHydrationPending.set(true)")
    expect(cacheHydration).toContain("repoCacheHydrationFailed.set(true)")
    expect(cacheHydration).not.toContain("if(result.timedOut){repoCacheHydrationFailed.set(true)")
    expect(mountHydration.indexOf("repoActivityHydrationReady.set(true)")).toBeLessThan(
      mountHydration.indexOf("hydrateRepoActivityCache"),
    )
    expect(layout).toContain("receiveRepositoryCacheEvent(event,relay,getStore(repoAddressStore))")
    expect(layout).toContain("mapRepoRelayWork(announcementDiscoveryRelays.filter")
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
