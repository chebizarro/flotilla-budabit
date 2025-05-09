<script lang="ts">
  import {FileView} from "@nostr-git/ui"
  import {GitBranch} from "@lucide/svelte"
  import {deriveNaddrEvent} from "@app/state"
  import {page} from "$app/stores"
  const {id, relay} = $page.params
  const relayArray = Array.isArray(relay) ? relay : [relay]
  const repo = deriveNaddrEvent(id, relayArray)

</script>

<div class="border-border bg-card rounded-lg border">
  <div class="p-4">
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <GitBranch class="text-muted-foreground h-5 w-5" />
        <select class="border-border rounded border bg-secondary px-2 py-1">
          {#each $repo.branches as branch}
            <option key={branch.name} value={branch.name}>
              {branch.name}
              {branch.isDefault && "(default)"}
            </option>
          {/each}
        </select>
      </div>
    </div>

    <div class="border-border border-t pt-4">
      <div class="space-y-2">
        <h3 class="mb-4 font-medium">Files</h3>
        <div class="space-y-2">
          {#each $repo.files as file}
            <FileView name={file.name} type={file.type} path={file.path} content={file.content} />
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>
