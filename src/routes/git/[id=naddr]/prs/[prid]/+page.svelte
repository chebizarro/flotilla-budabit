<script lang="ts">
  import {page} from "$app/stores"
  import {getContext} from "svelte"
  import {fade} from "svelte/transition"
  import {parsePullRequestEvent} from "@nostr-git/core/events"
  import type {PullRequestEvent} from "@nostr-git/core/events"
  import type {Repo} from "@nostr-git/ui"
  import type {Readable} from "svelte/store"
  import {deriveEventsById} from "@welshman/store"
  import {repository} from "@welshman/app"
  import {
    REPO_KEY,
    REPO_RELAYS_KEY,
    PULL_REQUESTS_KEY,
    HIDDEN_ROOT_IDS_KEY,
    REPO_ROOT_HISTORY_KEY,
    type RepoRootHistoryContext,
  } from "@app/core/git-state"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import AltArrowUp from "@assets/icons/alt-arrow-up.svg?dataurl"
  import PRView from "@app/components/PRView.svelte"

  const repoClass = getContext<Repo>(REPO_KEY)
  const repoRelaysStore = getContext<Readable<string[]>>(REPO_RELAYS_KEY)
  const pullRequestsStore = getContext<Readable<PullRequestEvent[]>>(PULL_REQUESTS_KEY)
  const hiddenRootIdsStore = getContext<Readable<Set<string>>>(HIDDEN_ROOT_IDS_KEY)
  const repoRootHistory = getContext<RepoRootHistoryContext>(REPO_ROOT_HISTORY_KEY)
  const repoAnnouncementStatusStore = repoRootHistory.announcementStatus
  const repoCacheHydrationPendingStore = repoRootHistory.cacheHydrationPending
  const repoCacheHydrationFailedStore = repoRootHistory.cacheHydrationFailed
  const repoLiveCoveragePartialStore = repoRootHistory.liveCoveragePartial
  const repoAnnouncementLiveCoveragePartialStore = repoRootHistory.announcementLiveCoveragePartial

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  const repoRelays = $derived.by(() => (repoRelaysStore ? $repoRelaysStore : []) as string[])
  const pullRequests = $derived.by(
    () => (pullRequestsStore ? $pullRequestsStore : []) as PullRequestEvent[],
  )
  const prEditRelays = $derived(repoRelays)
  const hasRepoAnnouncement = $derived.by(() => Boolean(repoClass.repoEvent))
  const announcementStatus = $derived($repoAnnouncementStatusStore)
  const liveCoveragePartial = $derived($repoLiveCoveragePartialStore)
  const announcementLiveCoveragePartial = $derived($repoAnnouncementLiveCoveragePartialStore)
  const repoRelaysUnavailable = $derived(
    hasRepoAnnouncement &&
      announcementStatus === "complete" &&
      !$repoCacheHydrationPendingStore &&
      !$repoCacheHydrationFailedStore &&
      repoRelays.length === 0,
  )
  const SCROLL_TO_TOP_THRESHOLD = 300

  let prResolution = $state<{
    requestedId: string
    status: "loading" | "complete" | "partial" | "failed" | "unavailable" | "aborted"
    rootId?: string
  }>({requestedId: "", status: "loading"})
  let prResolutionNonce = $state(0)
  let resolvedRoot = $state({requestedId: "", rootId: ""})
  let previousPrId = ""
  let showScrollButton = $state(false)
  let pageContainerRef: HTMLElement | undefined = $state()
  let scrollParent: HTMLElement | null = $state(null)

  const prId = $derived($page.params.prid ?? "")
  const hiddenRootIds = $derived.by(() =>
    hiddenRootIdsStore ? $hiddenRootIdsStore : new Set<string>(),
  )
  const resolvedRootId = $derived(
    resolvedRoot.requestedId === prId ? resolvedRoot.rootId || prId : prId,
  )

  const prEvent = $derived.by(
    () =>
      (pullRequests || []).find((pr: PullRequestEvent) => pr.id === resolvedRootId) as
        | PullRequestEvent
        | undefined,
  )
  const requestedRepoEventStore = $derived(deriveEventsById({repository, filters: [{ids: [prId]}]}))
  const requestedRepoEvent = $derived($requestedRepoEventStore.get(prId))
  const requestedRootReference = $derived.by(
    () =>
      (requestedRepoEvent?.tags || []).find(tag => tag[0] === "e" && tag[3] === "root")?.[1] ||
      (requestedRepoEvent?.tags || []).find(tag => tag[0] === "E")?.[1] ||
      "",
  )
  const requestedRootEventStore = $derived(
    deriveEventsById({
      repository,
      filters: requestedRootReference ? [{ids: [requestedRootReference]}] : [],
    }),
  )
  const isHiddenRoot = $derived.by(() => hiddenRootIds.has(resolvedRootId))
  const resolvedPrEvent = $derived(prEvent)
  const pr = $derived.by(() =>
    resolvedPrEvent ? parsePullRequestEvent(resolvedPrEvent) : undefined,
  )

  $effect(() => {
    const currentPrId = prId
    const announcementAvailable = hasRepoAnnouncement
    const currentAnnouncementStatus = announcementStatus
    const cacheHydrationPending = $repoCacheHydrationPendingStore
    const cacheHydrationFailed = $repoCacheHydrationFailedStore
    const liveCoveragePartial = $repoLiveCoveragePartialStore
    const relays = repoRelays
    void requestedRepoEvent
    void $requestedRootEventStore.get(requestedRootReference)
    void prResolutionNonce
    if (previousPrId !== currentPrId) {
      previousPrId = currentPrId
      resolvedRoot = {requestedId: "", rootId: ""}
    }
    if (!currentPrId) {
      prResolution = {requestedId: currentPrId, status: "complete"}
      return
    }
    if (!announcementAvailable) {
      prResolution = {
        requestedId: currentPrId,
        status: cacheHydrationPending
          ? "loading"
          : currentAnnouncementStatus === "complete" && cacheHydrationFailed
            ? "failed"
            : currentAnnouncementStatus === "complete"
              ? "unavailable"
              : currentAnnouncementStatus === "aborted"
                ? "partial"
                : currentAnnouncementStatus,
      }
      return
    }
    if (relays.length === 0) {
      prResolution = {
        requestedId: currentPrId,
        status: cacheHydrationPending
          ? "loading"
          : currentAnnouncementStatus === "complete" && cacheHydrationFailed
            ? "failed"
            : currentAnnouncementStatus === "complete"
              ? "unavailable"
              : currentAnnouncementStatus === "aborted"
                ? "partial"
                : currentAnnouncementStatus,
      }
      return
    }

    prResolution = {requestedId: currentPrId, status: "loading"}
    const controller = new AbortController()
    let cancelled = false
    void repoRootHistory.ensureRoot(currentPrId, controller.signal).then(result => {
      if (cancelled || prId !== currentPrId || result.status === "aborted") return
      if (result.rootId) resolvedRoot = {requestedId: currentPrId, rootId: result.rootId}
      prResolution = {
        requestedId: currentPrId,
        status:
          result.status === "complete" &&
          (currentAnnouncementStatus !== "complete" ||
            cacheHydrationPending ||
            cacheHydrationFailed)
            ? currentAnnouncementStatus === "loading" || cacheHydrationPending
              ? "loading"
              : currentAnnouncementStatus === "partial"
                ? "partial"
                : "failed"
            : result.status,
        rootId: result.rootId,
      }
    })

    return () => {
      cancelled = true
      controller.abort()
    }
  })
  const prResolutionStatus = $derived(
    prResolution.requestedId === prId ? prResolution.status : "loading",
  )
  const retryPrResolution = async () => {
    if ($repoCacheHydrationFailedStore) await repoRootHistory.retryCacheHydration()
    if (
      announcementStatus === "partial" ||
      announcementStatus === "failed" ||
      announcementStatus === "aborted"
    ) {
      await repoRootHistory.retryAnnouncement()
    }
    prResolutionNonce += 1
  }

  $effect(() => {
    const container = pageContainerRef
    if (!container) return
    scrollParent = container.closest(".scroll-container") as HTMLElement | null
  })

  $effect(() => {
    const scrollEl = scrollParent
    if (!scrollEl) return
    const syncScrollState = () => {
      showScrollButton = scrollEl.scrollTop > SCROLL_TO_TOP_THRESHOLD
    }
    syncScrollState()
    scrollEl.addEventListener("scroll", syncScrollState, {passive: true})
    return () => scrollEl.removeEventListener("scroll", syncScrollState)
  })

  const scrollToTop = () => {
    scrollParent?.scrollTo({top: 0, behavior: "smooth"})
  }
</script>

<svelte:head>
  <title>{repoClass.name} - {pr?.subject || "PR"}</title>
</svelte:head>

<div bind:this={pageContainerRef} data-event={resolvedPrEvent?.id}>
  {#if liveCoveragePartial || announcementLiveCoveragePartial}
    <div
      class="mb-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
      role="status">
      {liveCoveragePartial && announcementLiveCoveragePartial
        ? "Live activity and announcement updates are capped at six relays per lane. Finite history and announcement refresh still check every relay."
        : liveCoveragePartial
          ? "Live activity updates cover the first six repository relays; finite history still checks every declared relay."
          : "Live announcement updates cover the first six discovery relays; finite announcement refresh still checks every discovery relay."}
    </div>
  {/if}
  {#if isHiddenRoot && prEvent}
    <div class="p-4 text-center text-muted-foreground">This pull request was hidden as spam.</div>
  {:else if pr && resolvedPrEvent}
    {#if prResolutionStatus !== "complete"}
      <div
        class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
        role="status"
        aria-live="polite">
        <span>
          {prResolutionStatus === "loading"
            ? "Refreshing pull request activity…"
            : prResolutionStatus === "unavailable"
              ? "Repository relays are unavailable. Showing saved pull request content."
              : prResolutionStatus === "failed"
                ? "Pull request activity refresh failed. Showing saved content."
                : "Some repository relays did not finish. Pull request activity may be incomplete."}
        </span>
        {#if prResolutionStatus === "partial" || prResolutionStatus === "failed"}
          <button
            class="rounded-md border border-border px-3 py-1 text-sm"
            onclick={retryPrResolution}>Retry</button>
        {/if}
      </div>
    {/if}
    <PRView {pr} prEvent={resolvedPrEvent} repo={repoClass} {repoRelays} {prEditRelays} />
  {:else if repoRelaysUnavailable || prResolutionStatus === "unavailable"}
    <div class="p-4 text-center">
      <p class="font-medium">Repository Relays Unavailable</p>
      <p class="mt-1 text-sm text-muted-foreground">
        This pull request cannot be loaded until a valid repository announcement declares at least
        one relay.
      </p>
    </div>
  {:else if prResolutionStatus === "loading"}
    <div class="p-4 text-center" role="status">Loading pull request...</div>
  {:else if prResolutionStatus === "partial" || prResolutionStatus === "failed"}
    <div class="flex flex-col items-center gap-3 p-4 text-center text-muted-foreground">
      <p>
        {prResolutionStatus === "failed"
          ? "This pull request could not be loaded from the repository relays."
          : "This pull request could not be checked completely because some repository relays did not finish."}
      </p>
      <button class="rounded-md border border-border px-3 py-1 text-sm" onclick={retryPrResolution}
        >Retry pull request lookup</button>
    </div>
  {:else if prResolution.rootId}
    <div class="p-4 text-center" role="status">This repository item is not a pull request.</div>
  {:else}
    <div class="p-4 text-center text-muted-foreground">
      Pull request not found in the current repository history.
    </div>
  {/if}
</div>

{#if showScrollButton}
  <div in:fade class="chat__scroll-down !z-[20]">
    <Button class="btn btn-circle btn-neutral" onclick={scrollToTop}>
      <Icon icon={AltArrowUp} />
    </Button>
  </div>
{/if}
