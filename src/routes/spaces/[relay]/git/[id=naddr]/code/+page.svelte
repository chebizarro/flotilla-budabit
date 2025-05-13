<script lang="ts">
  import {FileView} from "@nostr-git/ui"
  import {GitBranch} from "@lucide/svelte"
  import {listRepoFilesFromEvent, type FileEntry} from "@nostr-git/core"
  import {getContext} from "svelte"
  import type {Readable} from "svelte/store"
  import type {TrustedEvent} from "@welshman/util"

  const eventStore: Readable<TrustedEvent> = getContext("repo-event")

  let branches = $state([{name: "master", isDefault: true}]) // Replace with real branch fetch
  let selectedBranch = $state("master")
  let files = $state([] as FileEntry[])

  async function fetchFiles(branch: string) {
    files = await listRepoFilesFromEvent({repoEvent: $eventStore, branch})
  }

  $effect(() => {
    fetchFiles(selectedBranch)
  })
</script>

<div class="rounded-lg border border-border bg-card">
  <div class="p-4">
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <GitBranch class="h-5 w-5 text-muted-foreground" />
        <select
          class="rounded border border-border bg-secondary px-2 py-1"
          bind:value={selectedBranch}>
          {#each branches as branch}
            <option value={branch.name}>
              {branch.name}
              {branch.isDefault ? " (default)" : ""}
            </option>
          {/each}
        </select>
      </div>
    </div>
    <div class="border-t border-border pt-4">
      <div class="space-y-2">
        <div class="space-y-2">
          {#each files as file}
            <FileView name={file.name} type={file.type} path={file.path} />
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>
