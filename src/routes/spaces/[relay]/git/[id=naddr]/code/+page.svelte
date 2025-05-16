<script lang="ts">
  import {getContext, onMount} from "svelte"
  import {FileView, Tabs, TabsList, TabsTrigger} from "@nostr-git/ui"
  import {GitBranch} from "@lucide/svelte"
  import {listRepoFilesFromEvent, type FileEntry} from "@nostr-git/core"
  import {load} from "@welshman/net"
  import {nip19} from "nostr-tools"
  import {GIT_REPO_STATE} from "@src/lib/util"
  import {parseRepoStateEvent, type TrustedEvent} from "@nostr-git/shared-types"
  import {page} from "$app/stores"
  import type {Readable} from "svelte/store"
  import {nthEq} from "@welshman/lib"
  import Popover from "@src/lib/components/Popover.svelte"
  import Button from "@src/lib/components/Button.svelte"
  import {fly} from "svelte/transition"
  import Icon from "@lib/components/Icon.svelte"

  const {id, relay} = $page.params
  const eventStore = getContext<Readable<TrustedEvent>>("repo-event")

  // UI state
  let loading = true
  let error: string | null = null
  let files: FileEntry[] = []
  let branches: {name: string; isDefault: boolean}[] = []
  let selectedBranch = "master"
  let fallbackToBranches = false

  async function tryLoadRepoStateEvent() {
    try {
      loading = true
      error = null
      fallbackToBranches = false
      files = []
      branches = []

      const decoded = nip19.decode(id).data as {
        pubkey: string
        kind: number
        identifier: string
      }
      const filters = [
        {
          authors: [decoded.pubkey],
          kinds: [GIT_REPO_STATE],
          "#d": [decoded.identifier],
        },
      ]
      const [tagId, ...relays] = $eventStore.tags.find(nthEq(0, "relays")) || []
      const events = await load({relays: relays, filters})
      const event = events[0]
      if (event) {
        //files = await listRepoFilesFromEvent({repoEvent: event, branch: selectedBranch})
        try {
          const repoStateEvent = parseRepoStateEvent(event)
          branches = repoStateEvent.refs.map(branch => ({name: branch.ref, isDefault: false}))
        } catch (e) {
          branches = [{name: "master", isDefault: true}]
        }
        loading = false
        return
      } else {
        fallbackToBranches = true
        await loadBranchesFallback()
      }
    } catch (e) {
      error = (e as Error).message || "Failed to load repository event."
      loading = false
    }
  }

  async function loadBranchesFallback() {
    try {
      branches = [{name: "master", isDefault: true}]
      selectedBranch = "master"
      // No repo event, so no files
      files = []
      loading = false
    } catch (e) {
      error = (e as Error).message || "Failed to load branches."
      loading = false
    }
  }

  // Reload files when branch changes (if event loaded)
  async function onBranchChange() {
    if (!fallbackToBranches) {
      try {
        loading = true
        files = []
        const decoded = nip19.decode(id).data as {
          pubkey: string
          kind: number
          identifier: string
        }
        const filters = [
          {
            authors: [decoded.pubkey],
            kinds: [GIT_REPO_STATE],
            "#d": [decoded.identifier],
          },
        ]
        const events = await load({relays: [relay], filters})
        const event = events[0]
        if (event) {
          files = await listRepoFilesFromEvent({repoEvent: event, branch: selectedBranch})
        } else {
          files = []
        }
        loading = false
      } catch (e) {
        error = (e as Error).message || "Failed to load files for branch."
        loading = false
      }
    }
  }

  let showMenu = false

  const toggleMenu = () => {
    showMenu = !showMenu
  }

  const openMenu = () => {
    showMenu = true
  }

  onMount(() => {
    tryLoadRepoStateEvent()
  })
</script>

<div class="rounded-lg border border-border bg-card">
  <div class="p-4">
    {#if loading}
      <div class="text-muted-foreground">Loading repository files...</div>
    {:else if error}
      <div class="text-red-500">{error}</div>
    {:else if fallbackToBranches}
      <div class="mb-2 text-muted-foreground">
        No repository event found. Showing available branches.
      </div>
      <div class="mb-4 flex items-center gap-2">
        <GitBranch class="h-5 w-5 text-muted-foreground" />
        <select
          class="rounded border border-border bg-secondary px-2 py-1"
          bind:value={selectedBranch}
          disabled>
          {#each branches as branch}
            <option value={branch.name}>
              {branch.name}
              {branch.isDefault ? " (default)" : ""}
            </option>
          {/each}
        </select>
      </div>
      <div class="border-t border-border pt-4">
        <div class="text-muted-foreground">No files available for this branch.</div>
      </div>
    {:else}
      <div class="mb-4">
        <Button
          onclick={openMenu}
          class="flex items-center gap-3 text-left transition-all hover:text-base-content">
          <GitBranch class="h-5 w-5 text-muted-foreground" />
          <span>{selectedBranch}</span>
          <Icon icon="alt-arrow-down" />
        </Button>
        {#if showMenu}
          <Popover hideOnClick onClose={toggleMenu}>
            <ul transition:fly class="menu z-popover mt-2 rounded-box bg-base-100 p-2 shadow-xl">
              {#each branches as branch}
                <li>
                  <Button onclick={() => (selectedBranch = branch.name)}>
                    <span>{branch.name}</span>
                  </Button>
                </li>
              {/each}
            </ul>
          </Popover>
        {/if}
      </div>
      <div class="border-t border-border pt-4">
        {#if files.length === 0}
          <div class="text-muted-foreground">No files found in this branch.</div>
        {:else}
          <div class="space-y-2">
            {#each files as file}
              <FileView name={file.name} type={file.type} path={file.path} />
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
