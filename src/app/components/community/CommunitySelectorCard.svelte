<script lang="ts">
  import {
    normalizeRelays,
    type CommunityDefinition,
    type CommunityPointer,
  } from "@app/core/community"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import CommunityShareButton from "@app/components/community/CommunityShareButton.svelte"
  import CommunityStarButton from "@app/components/community/CommunityStarButton.svelte"

  type Props = {
    community: CommunityPointer
    definition?: CommunityDefinition
    relayHints?: string[]
    shareRelayHints?: string[]
    publishRelayHints?: string[]
    isCurrent?: boolean
    isAdmin?: boolean
    isModerator?: boolean
    isMember?: boolean
    loading?: boolean
    disabled?: boolean
    onOpen: () => void
  }

  const {
    community,
    definition,
    relayHints = [],
    shareRelayHints = relayHints,
    publishRelayHints = [],
    isCurrent = false,
    isAdmin = false,
    isModerator = false,
    isMember = false,
    loading = false,
    disabled = false,
    onOpen,
  }: Props = $props()

  const shareRelays = $derived(normalizeRelays(shareRelayHints))
  const fallbackName = $derived(`${community.naddr.slice(0, 18)}...${community.naddr.slice(-8)}`)
  const name = $derived(definition?.metadata.name || fallbackName)
  const info = $derived(
    definition?.metadata.description || "Community definition metadata unavailable.",
  )
  const showMember = $derived(isMember && !isAdmin && !isModerator)
  let failedPicture = $state("")
  const picture = $derived(String(definition?.metadata.picture || "").trim())
  const showPicture = $derived(Boolean(picture && failedPicture !== picture))
</script>

<div
  class="flex min-w-0 items-center gap-1.5 rounded-xl border border-base-300 bg-base-100 p-1.5 sm:gap-2 sm:p-2">
  <button
    type="button"
    class="flex min-w-0 flex-1 flex-col items-stretch gap-1 rounded-lg p-1 text-left transition-colors hover:bg-base-200 disabled:cursor-not-allowed disabled:opacity-70 sm:flex-row sm:items-center sm:gap-3"
    class:bg-base-200={loading}
    aria-busy={loading}
    disabled={disabled || loading}
    onclick={onOpen}>
    <div class="flex min-w-0 items-center gap-2 sm:flex-1 sm:gap-3">
      <div
        class="center !flex h-9 w-9 shrink-0 overflow-hidden rounded-full bg-base-300 sm:h-10 sm:w-10">
        {#if showPicture}
          <img
            alt=""
            src={picture}
            class="h-full w-full object-cover"
            onerror={() => (failedPicture = picture)} />
        {:else}
          <Icon icon={HomeSmile} size={6} />
        {/if}
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
          <strong class="min-w-0 truncate leading-tight">{name}</strong>
          <div class="flex min-w-0 flex-wrap items-center gap-1 sm:gap-2">
            {#if isCurrent}
              <span class="badge badge-primary badge-sm shrink-0">Last visited</span>
            {/if}
            {#if isAdmin}
              <span class="badge badge-secondary badge-sm shrink-0">Admin</span>
            {/if}
            {#if isModerator}
              <span class="badge badge-accent badge-sm shrink-0">Moderator</span>
            {/if}
            {#if showMember}
              <span class="badge badge-outline badge-sm shrink-0">Member</span>
            {/if}
          </div>
        </div>
        <p class="hidden truncate text-xs opacity-70 sm:block">{info}</p>
      </div>
      {#if loading}
        <span class="loading loading-spinner loading-xs shrink-0 opacity-60"></span>
      {/if}
    </div>
    <p class="truncate text-xs opacity-70 sm:hidden">{info}</p>
  </button>
  <CommunityShareButton
    value={community}
    definitionRelays={shareRelays}
    class="btn btn-square btn-sm shrink-0" />
  <CommunityStarButton {community} {publishRelayHints} class="btn btn-square btn-sm shrink-0" />
</div>
