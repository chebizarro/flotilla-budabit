<script lang="ts">
  import {page} from "$app/state"
  import {Filter, Plus} from "@lucide/svelte"
  import {Button, PatchCard} from "@nostr-git/ui"
  import {setChecked} from "@src/app/notifications"
  import {deriveNaddrEvent} from "@src/app/state"
  import {load} from "@welshman/net"
  import {Address, GIT_PATCH} from "@welshman/util"
  import {onMount} from "svelte"

  const {id, relay} = page.params
  const relayArray = Array.isArray(relay) ? relay : [relay]
  const repo = deriveNaddrEvent(id, relayArray)
  const patches = $state([])

  async function loadPatches() {
    patches.length = 0
    const patchFilter = {
      kinds: [GIT_PATCH],
      "#a": [Address.fromEvent($repo).toString()],
    }
    const patch = await load({
      relays: relayArray,
      filters: [patchFilter],
    })
    if (patch.length > 0) {
      patches.push(...patch)
    }
  }

  onMount(() => {
    loadPatches()
    return () => setChecked(page.url.pathname)
  })
</script>

<div>
  <div class="mb-4 flex items-center justify-between">
    <div>
      <h2 class="text-xl font-semibold">Patches</h2>
      <p class="text-muted-foreground text-sm">Review and merge code changes</p>
    </div>

    <div class="flex items-center gap-2">
      <Button variant="outline" size="sm" class="gap-2">
        <Filter class="h-4 w-4" />
        Filter
      </Button>

      <Button size="sm" class="bg-git hover:bg-git-hover gap-2">
        <Plus class="h-4 w-4" />
        New Patch
      </Button>
    </div>
  </div>

  {#each patches as patch}
    <PatchCard event={patch} />
  {/each}
</div>
