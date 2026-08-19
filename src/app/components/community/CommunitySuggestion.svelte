<script lang="ts">
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import {parseCommunityNaddr, type CommunityDefinition} from "@app/core/community"

  type Props = {
    value: string
    definitions?: CommunityDefinition[]
  }

  const {value, definitions = []}: Props = $props()
  const pointer = $derived(parseCommunityNaddr(value))
  const definition = $derived(definitions.find(item => item.pointer.address === pointer?.address))
  const fallbackName = $derived(
    pointer ? `${pointer.naddr.slice(0, 18)}...${pointer.naddr.slice(-8)}` : "Unknown community",
  )
  const name = $derived(definition?.metadata.name || fallbackName)
  const description = $derived(
    definition?.metadata.description || pointer?.address || "Community definition",
  )
  let failedPicture = $state("")
  const picture = $derived(String(definition?.metadata.picture || "").trim())
  const showPicture = $derived(Boolean(picture && failedPicture !== picture))
</script>

<div class="flex min-w-0 max-w-full gap-3">
  <div class="center !flex h-10 w-10 shrink-0 overflow-hidden rounded-full bg-base-300">
    {#if showPicture}
      <img
        alt=""
        src={picture}
        class="h-full w-full object-cover"
        onerror={() => (failedPicture = picture)} />
    {:else}
      <Icon icon={HomeSmile} size={5} />
    {/if}
  </div>
  <div class="flex min-w-0 flex-col text-left">
    <div class="truncate text-base font-bold">{name}</div>
    <div class="truncate text-sm opacity-75">{description}</div>
  </div>
</div>
