<script lang="ts">
  import {Button, IssueCard} from "@nostr-git/ui"
  import {Filter, Plus} from "@lucide/svelte"
  import {deriveNaddrEvent} from "@app/state"
  import {page} from "$app/stores"
  import {GIT_ISSUE} from "@welshman/util"
  import {Address} from "@welshman/util"
  import {load} from "@welshman/net"
  import {onMount} from "svelte"
  import {setChecked} from "@src/app/notifications"
  const {id, relay} = $page.params
  const relayArray = Array.isArray(relay) ? relay : [relay]
  const repo = deriveNaddrEvent(id, relayArray)
  const issues = $state([])

  async function loadIssues() {
    issues.length = 0
    const issueFilter = {
      kinds: [GIT_ISSUE],
      "#d": [Address.fromEvent($repo).toString()],
    }
    const issue = await load({
      relays: relayArray,
      filters: [issueFilter],
    })
    if (issue.length > 0) {
      issues.push(...issue)
    }
  }

  onMount(() => {
    loadIssues()
    return () => setChecked($page.url.pathname)
  })
</script>

<div>
  <div
    class="z-10 bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 mb-4 flex items-center justify-between py-4 backdrop-blur">
    <div>
      <h2 class="text-xl font-semibold">Issues</h2>
      <p class="text-muted-foreground text-sm">Track bugs and feature requests</p>
    </div>

    <div class="flex items-center gap-2">
      <Button variant="outline" size="sm" class="gap-2">
        <Filter class="h-4 w-4" />
        Filter
      </Button>

      <Button size="sm" class="bg-git hover:bg-git-hover gap-2">
        <Plus class="h-4 w-4" />
        New Issue
      </Button>
    </div>
  </div>

  {#each issues as issue}
    <IssueCard event={issue} />
  {/each}
</div>
