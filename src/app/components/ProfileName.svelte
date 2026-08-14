<script lang="ts">
  import {deriveBudabitProfileDisplay} from "@app/core/profile-resolver"

  type Props = {
    pubkey: string
    url?: string
    relays?: string[]
    loadProfile?: boolean
  }

  const {pubkey, url, relays = [], loadProfile = true}: Props = $props()

  const profileDisplay = $derived(
    deriveBudabitProfileDisplay(pubkey, {url, relays, load: loadProfile}),
  )
</script>

{$profileDisplay}
