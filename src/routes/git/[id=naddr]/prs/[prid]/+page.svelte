<script lang="ts">
  import {page} from "$app/stores"
  import {getContext} from "svelte"
  import {fade} from "svelte/transition"
  import {parsePullRequestEvent} from "@nostr-git/core/events"
  import type {PullRequestEvent} from "@nostr-git/core/events"
  import type {Repo} from "@nostr-git/ui"
  import type {Readable} from "svelte/store"
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

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  const repoRelays = $derived.by(() => (repoRelaysStore ? $repoRelaysStore : []) as string[])
  const pullRequests = $derived.by(
    () => (pullRequestsStore ? $pullRequestsStore : []) as PullRequestEvent[],
  )
  const prEditRelays = $derived(repoRelays)
  const hasRepoAnnouncement = $derived.by(() => Boolean(repoClass.repoEvent))
  const repoRelaysUnavailable = $derived(hasRepoAnnouncement && repoRelays.length === 0)
  const LOAD_TIMEOUT_MS = 15_000
  const SCROLL_TO_TOP_THRESHOLD = 300

  let isResolving = $state(true)
  let didTimeout = $state(false)
  let resolvingPrId = $state("")
  let resolveTimeout: ReturnType<typeof setTimeout> | null = null
  let resolvedRoot = $state({requestedId: "", rootId: ""})
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
  const isHiddenRoot = $derived.by(() => hiddenRootIds.has(resolvedRootId))
  const resolvedPrEvent = $derived(prEvent)
  const pr = $derived.by(() =>
    resolvedPrEvent ? parsePullRequestEvent(resolvedPrEvent) : undefined,
  )

  const cancelResolve = () => {
    if (resolveTimeout) {
      clearTimeout(resolveTimeout)
      resolveTimeout = null
    }
  }

  const resolveCurrentPr = async () => {
    const currentPrId = prId
    if (!currentPrId || repoRelays.length === 0) return

    cancelResolve()
    isResolving = true
    didTimeout = false
    resolvingPrId = currentPrId

    resolveTimeout = setTimeout(() => {
      if (resolvingPrId !== currentPrId) return
      resolveTimeout = null
      didTimeout = true
      isResolving = false
    }, LOAD_TIMEOUT_MS)

    const result = await repoRootHistory.ensureRoot(currentPrId)
    if (prId !== currentPrId || result.status === "aborted") return
    if (result.rootId) resolvedRoot = {requestedId: currentPrId, rootId: result.rootId}
  }

  $effect(() => {
    void prId
    void repoRelays
    isResolving = true
    didTimeout = false
    resolvingPrId = ""
    resolvedRoot = {requestedId: "", rootId: ""}
    cancelResolve()
  })

  $effect(() => {
    if (resolvingPrId === prId || !isResolving || !prId || repoRelays.length === 0) return
    void resolveCurrentPr()
  })

  $effect(() => {
    if (!isResolving) return
    if (pr) {
      isResolving = false
      didTimeout = false
      cancelResolve()
    }
  })

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
  {#if isHiddenRoot}
    <div class="p-4 text-center text-muted-foreground">This pull request was hidden as spam.</div>
  {:else if pr && resolvedPrEvent}
    <PRView {pr} prEvent={resolvedPrEvent} repo={repoClass} {repoRelays} {prEditRelays} />
  {:else if repoRelaysUnavailable}
    <div class="p-4 text-center">
      <p class="font-medium">Repository Relays Unavailable</p>
      <p class="mt-1 text-sm text-muted-foreground">
        This pull request cannot be loaded until a valid repository announcement declares at least
        one relay.
      </p>
    </div>
  {:else if resolvingPrId !== prId || isResolving}
    <div class="p-4 text-center">Loading pull request...</div>
  {:else if resolvingPrId === prId && didTimeout}
    <div class="p-4 text-center text-muted-foreground">Pull request not found.</div>
  {/if}
</div>

{#if showScrollButton}
  <div in:fade class="chat__scroll-down !z-[20]">
    <Button class="btn btn-circle btn-neutral" onclick={scrollToTop}>
      <Icon icon={AltArrowUp} />
    </Button>
  </div>
{/if}
