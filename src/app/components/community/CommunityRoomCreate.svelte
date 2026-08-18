<script lang="ts">
  import {goto} from "$app/navigation"
  import {pubkey, publishThunk, repository, retryThunk, waitForAnyRelayAck} from "@welshman/app"
  import {makeEvent, THREAD, type TrustedEvent} from "@welshman/util"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import AltArrowRight from "@assets/icons/alt-arrow-right.svg?dataurl"
  import Hashtag from "@assets/icons/hashtag.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Field from "@lib/components/Field.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import {preventDefault} from "@lib/html"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import type {CommunityPointer} from "@app/core/community"
  import {makeCommunityRoomRoot} from "@app/core/community-rooms"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityAuthorityReadiness,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    activeExactCommunityDefinition,
    activeExactCommunityPointer,
  } from "@app/core/community-state"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunityWriteTargetSectionName,
  } from "@app/core/community-permissions"
  import {getCommunityScopedPublishRelays} from "@app/core/community-relays"
  import {signEventForPublication} from "@app/core/publication"
  import {pushToast} from "@app/util/toast"
  import {makeExactCommunityRoomPath} from "@app/util/routes"

  type Props = {
    community: CommunityPointer
  }

  const {community}: Props = $props()
  const communityLabel = $derived(
    $activeExactCommunityDefinition?.pointer.address === community.address
      ? $activeExactCommunityDefinition.metadata.name ||
          `community ${community.naddr.slice(0, 12)}...`
      : `community ${community.naddr.slice(0, 12)}...`,
  )
  const communityBootstrapReady = $derived(
    Boolean(
      $activeExactCommunityPointer?.address === community.address &&
      $activeExactCommunityDefinition?.pointer.address === community.address &&
      $activeExactCommunityDefinition.controllerPubkey === community.controllerPubkey &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading,
    ),
  )
  const communityBootstrapLoading = $derived(
    Boolean(!communityBootstrapReady && !$activeCommunityBootstrapStatus.error),
  )
  const communityAuthorityReadiness = $derived(
    $activeExactCommunityPointer?.address === community.address &&
      $activeCommunityAuthorityReadiness.communityPubkey === community.controllerPubkey
      ? $activeCommunityAuthorityReadiness.state
      : "loading",
  )
  const communityReady = $derived(
    communityBootstrapReady && communityAuthorityReadiness === "ready",
  )
  const communityRoomLoading = $derived(
    communityBootstrapLoading ||
      (communityBootstrapReady && communityAuthorityReadiness === "loading"),
  )
  const canCreateRoom = $derived(
    Boolean(
      $pubkey &&
      communityReady &&
      $activeExactCommunityDefinition &&
      canWriteCommunityTarget({
        definition: $activeExactCommunityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.roomRoot,
        reportState: $activeCommunityReportState,
      }),
    ),
  )
  const communityPublishRelays = $derived(
    getCommunityScopedPublishRelays($activeExactCommunityDefinition),
  )
  const roomRootSectionName = $derived(
    getCommunityWriteTargetSectionName(
      communityReady ? $activeExactCommunityDefinition : undefined,
      COMMUNITY_WRITE_TARGETS.roomRoot,
    ),
  )
  const roomRootAccessMessage = $derived(`Request ${roomRootSectionName} access to create rooms.`)

  const back = () => history.back()
  const failedRoomPublishThunks = new Map<string, ReturnType<typeof publishThunk>>()

  const createRoom = async () => {
    const trimmed = roomName.trim()
    if (!trimmed || loading) return
    if (!communityReady) {
      pushToast({
        theme: "error",
        message:
          communityAuthorityReadiness === "unavailable"
            ? "Rooms unavailable."
            : "Rooms are still loading.",
      })
      return
    }
    if (!canCreateRoom) {
      pushToast({theme: "error", message: roomRootAccessMessage})
      return
    }
    if (communityPublishRelays.length === 0) {
      pushToast({theme: "error", message: "Community definition must declare at least one relay."})
      return
    }

    const about = roomDescription.trim()
    const publishKey = JSON.stringify({
      communityAddress: community.address,
      name: trimmed,
      about,
      relays: [...new Set(communityPublishRelays)].sort(),
    })
    let thunk = failedRoomPublishThunks.get(publishKey)

    loading = true

    try {
      if (thunk) {
        thunk = retryThunk(thunk) as ReturnType<typeof publishThunk>
      } else {
        const event = await signEventForPublication(
          makeEvent(
            THREAD,
            makeCommunityRoomRoot({communityPubkey: community.communityId, name: trimmed, about}),
          ),
        )

        thunk = publishThunk({
          relays: communityPublishRelays,
          event,
          optimistic: false,
        })
      }

      await waitForAnyRelayAck(thunk, thunk.options.relays)
    } catch (error) {
      if (thunk) failedRoomPublishThunks.set(publishKey, thunk)
      pushToast({
        theme: "error",
        message: error instanceof Error ? error.message : "Failed to publish room.",
      })
      return
    } finally {
      loading = false
    }

    failedRoomPublishThunks.clear()
    repository.publish(thunk.event as TrustedEvent)

    pushToast({message: "Room published."})
    await goto(makeExactCommunityRoomPath(community, thunk.event.id), {replaceState: true})
  }

  let roomName = $state("")
  let roomDescription = $state("")
  let loading = $state(false)
</script>

<form class="column gap-4" onsubmit={preventDefault(createRoom)}>
  <ModalHeader>
    {#snippet title()}
      <div>Create a Room</div>
    {/snippet}
    {#snippet info()}
      <div>In <span class="text-primary">{communityLabel}</span></div>
    {/snippet}
  </ModalHeader>

  {#if communityRoomLoading}
    <p class="flex items-center justify-center py-8 text-sm opacity-70">
      <Spinner loading>Loading room creation...</Spinner>
    </p>
  {:else if canCreateRoom}
    <Field>
      {#snippet label()}
        <p>Name</p>
      {/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <Icon icon={Hashtag} />
          <input bind:value={roomName} class="grow" type="text" />
        </label>
      {/snippet}
    </Field>
    <Field>
      {#snippet label()}
        <p>Description</p>
      {/snippet}
      {#snippet input()}
        <textarea bind:value={roomDescription} class="textarea textarea-bordered" rows="4"
        ></textarea>
      {/snippet}
    </Field>
  {:else}
    <div class="rounded-box bg-base-200 p-4">
      <strong>Access required</strong>
      <p class="mt-1 text-sm opacity-70">{roomRootAccessMessage}</p>
      <div class="mt-3 flex justify-end">
        <PublishGate
          target={COMMUNITY_WRITE_TARGETS.roomRoot}
          action="create rooms"
          compact
          class="btn btn-primary" />
      </div>
    </div>
  {/if}

  <ModalFooter>
    <Button class="btn btn-link" onclick={back}>
      <Icon icon={AltArrowLeft} />
      Go back
    </Button>
    {#if canCreateRoom}
      <Button type="submit" class="btn btn-primary" disabled={!roomName.trim() || loading}>
        <Spinner {loading}>Create Room</Spinner>
        <Icon icon={AltArrowRight} />
      </Button>
    {/if}
  </ModalFooter>
</form>
