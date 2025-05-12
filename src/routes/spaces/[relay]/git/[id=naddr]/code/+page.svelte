<script lang="ts">
  import { FileView } from "@nostr-git/ui";
  import { GitBranch } from "@lucide/svelte";
  import { listRepoFiles } from "@nostr-git/core";
  let { params } = $props();
  let { host, owner, repo } = params;

  let branches = $state([{ name: 'main', isDefault: true }]); // Replace with real branch fetch
  let selectedBranch = $state('main');
  let files = $state([]);

  async function fetchFiles(branch: string) {
    files = await listRepoFiles({ host, owner, repo, branch });
  }

  $effect(() => {
    fetchFiles(selectedBranch);
  });
</script>

<div class="border-border bg-card rounded-lg border">
  <div class="p-4">
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <GitBranch class="text-muted-foreground h-5 w-5" />
        <select
          class="border-border rounded border bg-secondary px-2 py-1"
          bind:value={selectedBranch}
        >
          {#each branches as branch}
            <option value={branch.name}>
              {branch.name}
              {branch.isDefault ? ' (default)' : ''}
            </option>
          {/each}
        </select>
      </div>
    </div>
    <div class="border-border border-t pt-4">
      <div class="space-y-2">
        <h3 class="mb-4 font-medium">Files</h3>
        <div class="space-y-2">
          {#each files as file}
            <FileView name={file.name} type={file.type} path={file.path} />
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>