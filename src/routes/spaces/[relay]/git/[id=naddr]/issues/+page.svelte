<script lang="ts">
  import {Button, IssueCard} from "@nostr-git/ui"
  import {Funnel, Plus, SearchX} from "@lucide/svelte"
  import {deriveNaddrEvent} from "@app/state"
  import {page} from "$app/stores"
  import {GIT_ISSUE, type TrustedEvent} from "@welshman/util"
  import {Address} from "@welshman/util"
  import {load} from "@welshman/net"
  import {onMount} from "svelte"
  import {setChecked} from "@src/app/notifications"
  import {nthEq} from "@welshman/lib"
  import {deriveProfile} from "@welshman/app"
  import Spinner from "@src/lib/components/Spinner.svelte"

  // Receive eventStore from layout via $props (Svelte 5 idiom)
  const { eventStore } = $props();

  const {id, relay} = $page.params
  const relayArray = Array.isArray(relay) ? relay : [relay]
  const repo = deriveNaddrEvent(id)
  let issues = $state([] as TrustedEvent[])
  let loading = $state(true)
  let currentPage = $state(1)
  const pageSize = 10
  const pageCount = $derived(() => Math.max(1, Math.ceil(issues.length / pageSize)))
  const paginatedIssues = $derived(() =>
    issues.slice((currentPage - 1) * pageSize, currentPage * pageSize),
  )

  async function loadIssues() {
    issues.length = 0
    const issueFilter = {
      kinds: [GIT_ISSUE],
      "#a": [Address.fromEvent($repo).toString()],
    }
    const [tagId, ...relays] = $repo.tags.find(nthEq(0, "relays")) || []

    const issue = await load({
      relays: relays,
      filters: [issueFilter],
    })
    if (issue.length > 0) {
      issues.push(...issue)
    }
  }

  async function loadIssuesWrapper() {
    loading = true
    await loadIssues()
    loading = false
  }

  onMount(() => {
    loadIssuesWrapper()
    return () => setChecked($page.url.pathname)
  })

  function prevPage() {
    if (currentPage > 1) currentPage = currentPage - 1
  }
  function nextPage() {
    if (currentPage < pageCount()) currentPage = currentPage + 1
  }
</script>

<div>
  <div
    class="z-10 sticky top-0 mb-4 flex items-center justify-between bg-background/95 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
    <div>
      <h2 class="text-xl font-semibold">Issues</h2>
      <p class="text-sm text-muted-foreground">Track bugs and feature requests</p>
    </div>

    <div class="flex items-center gap-2">
      <Button variant="outline" size="sm" class="gap-2">
        <Funnel class="h-4 w-4" />
        Filter
      </Button>

      <Button size="sm" class="gap-2 bg-git hover:bg-git-hover">
        <Plus class="h-4 w-4" />
        New Issue
      </Button>
    </div>
  </div>

  {#if loading}
    <div class="flex flex-col items-center justify-center py-12">
      <Spinner {loading}>
        {#if loading}
          Loading issues….
        {:else}
          End of message history
        {/if}
      </Spinner>
    </div>
  {:else if issues.length === 0}
    <div class="flex flex-col items-center justify-center py-12 text-gray-500">
      <SearchX class="mb-2 h-8 w-8" />
      No issues found.
    </div>
  {:else}
    <div class="flex max-h-[32rem] flex-col gap-y-4 overflow-y-auto rounded-md bg-background p-2">
      {#each paginatedIssues() as issue}
        <IssueCard event={issue} author={deriveProfile(issue.pubkey, relayArray)} />
      {/each}
    </div>
    <div class="mt-4 flex items-center justify-center gap-4">
      <button
        onclick={prevPage}
        class="rounded bg-gray-100 px-3 py-1 hover:bg-gray-200 disabled:opacity-50"
        disabled={currentPage === 1}>&larr; Prev</button>
      <span class="text-gray-600">Page {currentPage} of {pageCount()}</span>
      <button
        onclick={nextPage}
        class="rounded bg-gray-100 px-3 py-1 hover:bg-gray-200 disabled:opacity-50"
        disabled={currentPage === pageCount()}>
        Next &rarr;
      </button>
    </div>
  {/if}
</div>
