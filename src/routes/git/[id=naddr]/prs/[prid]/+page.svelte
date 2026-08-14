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
  const SCROLL_TO_TOP_THRESHOLD = 300

  let prResolution = $state<{
    requestedId: string
    status: "loading" | "complete" | "partial" | "failed" | "unavailable" | "aborted"
    rootId?: string
  }>({requestedId: "", status: "loading"})
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
    const relays = repoRelays
    void requestedRepoEvent
    void $requestedRootEventStore.get(requestedRootReference)
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
  {#if isHiddenRoot && prEvent}
    <div class="p-4 text-center text-muted-foreground">This pull request was hidden as spam.</div>
  {:else if pr && resolvedPrEvent}
    <PRView {pr} prEvent={resolvedPrEvent} repo={repoClass} {repoRelays} {prEditRelays} />
  {:else if prResolutionStatus === "loading"}
    <div class="p-4 text-center" role="status">Loading pull request...</div>
  {:else if prResolution.rootId}
    <div class="p-4 text-center" role="status">This repository item is not a pull request.</div>
  {:else}
    <div class="p-4 text-center text-muted-foreground">
      {prResolutionStatus === "complete"
        ? "Pull request not found in the current repository history."
        : "Pull request unavailable."}
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
