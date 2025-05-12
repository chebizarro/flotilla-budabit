<script lang="ts">
  import {page} from "$app/state"
  import {Funnel, Plus, SearchX} from "@lucide/svelte"
  import {Button, PatchCard} from "@nostr-git/ui"
  import {setChecked} from "@src/app/notifications"
  import {deriveNaddrEvent} from "@src/app/state"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import {deriveProfile} from "@welshman/app"
  import {nthEq} from "@welshman/lib"
  import {load} from "@welshman/net"
  import {Address, GIT_PATCH, type TrustedEvent} from "@welshman/util"
  import {onMount} from "svelte"

  const {id, relay} = page.params
  const relayArray = Array.isArray(relay) ? relay : [relay]
  const repo = deriveNaddrEvent(id, relayArray)
  let patches = $state([] as TrustedEvent[])
  let loading = $state(true)
  let currentPage = $state(1)
  const pageSize = 10
  const pageCount = $derived(() => Math.max(1, Math.ceil(patches.length / pageSize)))
  const paginatedPatches = $derived(() =>
    patches.slice((currentPage - 1) * pageSize, currentPage * pageSize),
  )

  function prevPage() {
    if (currentPage > 1) currentPage = currentPage - 1
  }
  function nextPage() {
    if (currentPage < pageCount()) currentPage = currentPage + 1
  }

  async function loadPatches() {
    patches.length = 0
    const patchFilter = {
      kinds: [GIT_PATCH],
      "#a": [Address.fromEvent($repo).toString()],
    }

    const [tagId, ...relays] = $repo.tags.find(nthEq(0, "relays")) || []

    const patch = await load({
      relays: relays,
      filters: [patchFilter],
    })
    if (patch.length > 0) {
      patches.push(...patch)
    }
  }

  async function loadPatchesWrapper() {
    loading = true
    await loadPatches()
    loading = false
  }

  onMount(() => {
    loadPatchesWrapper()
    return () => setChecked(page.url.pathname)
  })
</script>

<div>
  <div
    class="z-10 sticky top-0 mb-4 flex items-center justify-between bg-background/95 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
    <div>
      <h2 class="text-xl font-semibold">Patches</h2>
      <p class="text-sm text-muted-foreground">Review and merge code changes</p>
    </div>

    <div class="flex items-center gap-2">
      <Button variant="outline" size="sm" class="gap-2">
        <Funnel class="h-4 w-4" />
        Filter
      </Button>

      <Button size="sm" class="gap-2 bg-git hover:bg-git-hover">
        <Plus class="h-4 w-4" />
        New Patch
      </Button>
    </div>
  </div>

  {#if loading}
    <div class="flex flex-col items-center justify-center py-12">
      <Spinner {loading}>
        {#if loading}
          Loading patches….
        {:else}
          End of patches history
        {/if}
      </Spinner>
    </div>
  {:else if patches.length === 0}
    <div class="flex flex-col items-center justify-center py-12 text-gray-500">
      <SearchX class="mb-2 h-8 w-8" />
      No patches found.
    </div>
  {:else}
    <div class="flex max-h-[32rem] flex-col gap-y-4 overflow-y-auto rounded-md bg-background p-2">
      {#each paginatedPatches() as patch}
        <PatchCard event={patch} owner={deriveProfile(patch.pubkey)} />
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
