<script lang="ts">
  import {page} from "$app/stores"
  import { subscribe } from "@welshman/net"
  import { onMount } from "svelte"
  import { setChecked } from "../notifications"
  import { 
    getListTags,
    getPubkeyTagValues,
    GIT_STATUS_CLOSED,
    GIT_STATUS_COMPLETE, 
    GIT_STATUS_DRAFT, 
    GIT_STATUS_OPEN 
  } from "@welshman/util"
  import { load, repository, userMutes } from "@welshman/app"
  import { deriveEvents } from "@welshman/store"
  import { derived } from "svelte/store"
  import { sortBy } from "@welshman/lib"
  import { GitIssueStatus } from "@src/lib/util"

  
  const {event, relays} = $props()
  const statusFilter = [{
    kinds: [
      GIT_STATUS_OPEN,
      GIT_STATUS_COMPLETE,
      GIT_STATUS_CLOSED,
      GIT_STATUS_DRAFT
    ],
    "#e": [event.id]
  }]


  const mutedPubkeys = getPubkeyTagValues(getListTags($userMutes))

  const status = derived(
    deriveEvents(repository, { filters: statusFilter }),
    ($statuses) => {
      if ($statuses.length > 0) {
        sortBy(
          e => -e.created_at,
          $statuses.filter(e => !mutedPubkeys.includes(e.pubkey))
        )
        console.log("Issue statuses found and sorted for issue:", $statuses)
        switch ($statuses[0].kind) {
          case GIT_STATUS_OPEN:
            return GitIssueStatus.OPEN
          case GIT_STATUS_CLOSED:
            return GitIssueStatus.CLOSED
          case GIT_STATUS_COMPLETE:
            return GitIssueStatus.RESOLVED
          case GIT_STATUS_DRAFT:
            return GitIssueStatus.DRAFT
        }
      } else return GitIssueStatus.OPEN
    }
  )

  onMount(() => {
    load({
      relays: relays,
      filters: statusFilter,
    })

    const sub = subscribe({
      relays: relays,
      filters: statusFilter
    })
    return () => {
      if (sub) {
        sub.close()
        setChecked($page.url.pathname)
      }
    }
  })
</script>
