<script lang="ts">
  import {page} from "$app/stores"
  import {pubkey, publishThunk, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {makeEvent, getTagValue, type TrustedEvent} from "@welshman/util"
  import {randomId} from "@welshman/lib"
  import {GIT_REPO_ANNOUNCEMENT} from "@nostr-git/core/events"
  import Git from "@assets/icons/git.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Field from "@lib/components/Field.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityAuthorityReadiness,
    activeExactCommunityDefinition,
    activeCommunityProfileListEvents,
    activeExactCommunityRelays,
    activeCommunityReportState,
    activeExactCommunityPointer,
  } from "@app/core/community-state"
  import {TARGETED_PUBLICATION_KIND_V2, normalizeRelays} from "@app/core/community"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    filterAuthorizedCommunityTargetingEvents,
    getCommunityWriteTargetSectionName,
    getCommunityTargetWriterPubkeys,
  } from "@app/core/community-permissions"
  import {getRepoAnnouncementPublishRelays} from "@app/core/git-state"
  import {
    makeCommunityContentFilterPlan,
    makeCommunityRepositoryFilter,
    makeCommunityTargetingFilter,
    makeTargetedPublicationOriginalFilterPlan,
    makeTargetedPublicationOriginalRelayHintPlans,
  } from "@app/core/community-feeds"
  import {
    makeAddressablePublicationRef,
    makeTargetedPublicationForCommunityV2,
  } from "@app/core/community-targeting"
  import {
    buildRepoCommunityContexts,
    getRepoAddress,
    isEndorsedRepoCommunityContext,
  } from "@app/core/repo-community-context"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
  import {loadBoundedCommunityHistory} from "@app/core/requests"
  import {parseExactCommunityRouteParam} from "@app/util/routes"

  const routeCommunity = $derived(parseExactCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(routeCommunity?.controllerPubkey || "")
  const communityId = $derived(routeCommunity?.communityId || "")
  const communityAddress = $derived(routeCommunity?.address || "")
  const communityDefinition = $derived(
    $activeExactCommunityDefinition?.pointer.address === communityAddress &&
      $activeExactCommunityDefinition.controllerPubkey === communityPubkey
      ? $activeExactCommunityDefinition
      : undefined,
  )
  const communityBootstrapReady = $derived(
    Boolean(
      communityPubkey &&
      communityDefinition &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading,
    ),
  )
  const communityBootstrapLoading = $derived(
    Boolean(communityPubkey && !communityBootstrapReady && !$activeCommunityBootstrapStatus.error),
  )
  const communityBootstrapFailed = $derived(
    Boolean(communityPubkey && !communityBootstrapReady && $activeCommunityBootstrapStatus.error),
  )
  const communityAuthorityReadiness = $derived(
    $activeCommunityAuthorityReadiness.communityPubkey === communityPubkey
      ? $activeCommunityAuthorityReadiness.state
      : "loading",
  )
  const communityAuthorityLoading = $derived(
    communityBootstrapReady && communityAuthorityReadiness === "loading",
  )
  const communityAuthorityReady = $derived(
    communityBootstrapReady && communityAuthorityReadiness === "ready",
  )
  const communityAuthorityUnavailable = $derived(communityAuthorityReadiness === "unavailable")
  const repoAuthorPubkeys = $derived(
    communityAuthorityReady && communityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.repository,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const directRepoFilterPlan = $derived.by(() =>
    communityAuthorityReady
      ? makeCommunityContentFilterPlan(
          [makeCommunityRepositoryFilter(communityId)],
          repoAuthorPubkeys,
        )
      : {relayFilters: [], localFilters: []},
  )
  const legacyRepoEventsStore = $derived(
    directRepoFilterPlan.localFilters.length
      ? deriveEventsAsc(
          deriveEventsById({repository, filters: directRepoFilterPlan.localFilters as any}),
        )
      : undefined,
  )
  const communityRepoAssociationFilters = $derived(
    communityAuthorityReady && $activeExactCommunityPointer
      ? [
          makeCommunityTargetingFilter($activeExactCommunityPointer.communityId, [
            GIT_REPO_ANNOUNCEMENT,
          ]),
        ]
      : [],
  )
  const communityRepoAssociationFilterPlan = $derived(
    communityAuthorityReady
      ? makeCommunityContentFilterPlan(communityRepoAssociationFilters, repoAuthorPubkeys)
      : {relayFilters: [], localFilters: []},
  )
  const communityRepoAssociationEventsStore = $derived(
    communityRepoAssociationFilterPlan.localFilters.length
      ? deriveEventsAsc(
          deriveEventsById({
            repository,
            filters: communityRepoAssociationFilterPlan.localFilters as any,
          }),
        )
      : undefined,
  )
  const authorizedCommunityRepoAssociationEvents = $derived.by(() =>
    communityAuthorityReady &&
    communityDefinition &&
    $activeExactCommunityPointer &&
    $communityRepoAssociationEventsStore
      ? filterAuthorizedCommunityTargetingEvents({
          community: $activeExactCommunityPointer,
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          events: $communityRepoAssociationEventsStore as TrustedEvent[],
          reportState: $activeCommunityReportState,
          kinds: [GIT_REPO_ANNOUNCEMENT],
        })
      : [],
  )
  const targetedRepoFilterPlan = $derived.by(() =>
    makeTargetedPublicationOriginalFilterPlan(authorizedCommunityRepoAssociationEvents),
  )
  const targetedRepoRelayHintPlans = $derived.by(() =>
    makeTargetedPublicationOriginalRelayHintPlans(authorizedCommunityRepoAssociationEvents),
  )
  const targetedRepoEventsStore = $derived(
    targetedRepoFilterPlan.localFilters.length
      ? deriveEventsAsc(
          deriveEventsById({repository, filters: targetedRepoFilterPlan.localFilters as any}),
        )
      : undefined,
  )
  const repoReportStates = $derived.by(() =>
    $activeExactCommunityPointer && $activeCommunityReportState
      ? new Map([[$activeExactCommunityPointer.address, $activeCommunityReportState]])
      : undefined,
  )
  const repos = $derived.by(() => {
    if (!communityId || !communityAuthorityReady || !communityDefinition) return []

    const associationEvents = authorizedCommunityRepoAssociationEvents
    const candidates = [
      ...($legacyRepoEventsStore ? ($legacyRepoEventsStore as TrustedEvent[]) : []),
      ...($targetedRepoEventsStore ? ($targetedRepoEventsStore as TrustedEvent[]) : []),
    ]
    const latest = new Map<string, TrustedEvent>()

    for (const event of candidates) {
      const context = buildRepoCommunityContexts({
        repoEvent: event,
        associationEvents,
        definitions: [communityDefinition],
        profileListEvents: $activeCommunityProfileListEvents,
        reportStates: repoReportStates,
        activeCommunityPubkey: communityPubkey,
        activeCommunityAddress: $activeExactCommunityPointer?.address,
      }).find(context => context.communityAddress === $activeExactCommunityPointer?.address)
      if (!isEndorsedRepoCommunityContext(context)) continue

      const address = getRepoAddress(event)
      if (!address) continue

      const current = latest.get(address)
      if (!current || event.created_at > current.created_at) latest.set(address, event)
    }

    return Array.from(latest.values()).sort(
      (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
    )
  })
  const canCreateRepo = $derived(
    Boolean(
      $pubkey &&
      communityAuthorityReady &&
      communityDefinition &&
      canWriteCommunityTarget({
        definition: communityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.repository,
        reportState: $activeCommunityReportState,
      }),
    ),
  )
  const repoSectionName = $derived(
    getCommunityWriteTargetSectionName(
      communityAuthorityReady ? communityDefinition : undefined,
      COMMUNITY_WRITE_TARGETS.repository,
    ),
  )
  const repoAccessMessage = $derived(`Request ${repoSectionName} access to publish repositories.`)

  const createRepoAnnouncement = () => {
    if (!$pubkey || !communityId || !name.trim()) return
    if (!canCreateRepo) {
      pushToast({theme: "error", message: repoAccessMessage})
      return
    }
    const relays = $activeExactCommunityRelays
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    const repoId = slug.trim() || randomId()
    const repoTemplate = {
      content: "",
      tags: [
        ["d", repoId],
        ["h", communityId, relays[0]],
        ["name", name.trim()],
        ["description", description.trim()],
        ...(clone.trim() ? [["clone", clone.trim()]] : []),
        ["relays", ...relays],
      ],
    }
    const targetingId = randomId()
    const repoEvent = makeEvent(GIT_REPO_ANNOUNCEMENT, repoTemplate)
    const announcementRelays = getRepoAnnouncementPublishRelays({
      repoEvent,
      repoRelays: relays,
    })
    const associationRelays = normalizeRelays([...announcementRelays, ...relays])

    publishThunk({relays: announcementRelays, event: repoEvent})
    publishThunk({
      relays: associationRelays,
      event: makeEvent(
        TARGETED_PUBLICATION_KIND_V2,
        makeTargetedPublicationForCommunityV2({
          targetingId,
          originalKind: GIT_REPO_ANNOUNCEMENT,
          originalRef: makeAddressablePublicationRef({
            kind: GIT_REPO_ANNOUNCEMENT,
            pubkey: $pubkey,
            identifier: repoId,
            relay: relays[0],
          }),
          community: $activeExactCommunityPointer!,
        }),
      ),
    })

    name = ""
    slug = ""
    description = ""
    clone = ""
    pushToast({message: "Repository announcement published."})
  }

  let name = $state("")
  let slug = $state("")
  let description = $state("")
  let clone = $state("")
  let directRepoLoading = $state(false)
  let directRepoLoadSettled = $state(false)
  let directRepoHistoryIncomplete = $state(false)
  let directRepoRetryVersion = $state(0)
  let targetedRepoLoading = $state(false)
  let targetedRepoRequestDone = $state(false)
  let targetedRepoHistoryIncomplete = $state(false)
  let targetedOriginalLoading = $state(false)
  let targetedOriginalRequestDone = $state(false)
  let targetedOriginalHistoryIncomplete = $state(false)
  const retryDirectRepoHistory = () => {
    if (communityBootstrapFailed || communityAuthorityUnavailable) {
      window.location.reload()
      return
    }
    if (!directRepoLoading && !targetedRepoLoading && !targetedOriginalLoading) {
      directRepoRetryVersion += 1
    }
  }
  const reposLoading = $derived(
    !communityBootstrapFailed &&
      !communityAuthorityUnavailable &&
      (communityBootstrapLoading ||
        communityAuthorityLoading ||
        directRepoLoading ||
        targetedRepoLoading ||
        targetedOriginalLoading ||
        (!directRepoLoadSettled && directRepoFilterPlan.relayFilters.length > 0) ||
        (!targetedRepoRequestDone &&
          communityRepoAssociationFilterPlan.relayFilters.length > 0 &&
          repos.length === 0) ||
        (!targetedOriginalRequestDone && targetedRepoFilterPlan.relayFilters.length > 0)),
  )
  $effect(() => {
    void directRepoRetryVersion
    const relays = $activeExactCommunityRelays
    const relayFilters = directRepoFilterPlan.relayFilters
    const localFilters = directRepoFilterPlan.localFilters

    if (!communityBootstrapReady) {
      directRepoLoading = false
      directRepoLoadSettled = false
      directRepoHistoryIncomplete = false
      return
    }
    if (relayFilters.length === 0 || localFilters.length === 0) {
      directRepoLoading = false
      directRepoLoadSettled = true
      directRepoHistoryIncomplete = false
      return
    }
    if (relays.length === 0) {
      directRepoLoading = false
      directRepoLoadSettled = true
      directRepoHistoryIncomplete = true
      return
    }

    const controller = new AbortController()
    directRepoLoading = true
    directRepoLoadSettled = false
    directRepoHistoryIncomplete = false
    void loadBoundedCommunityHistory({
      relays,
      relayFilters,
      localFilters,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      owner: `community-repositories:${communityPubkey}`,
      signal: controller.signal,
    })
      .then(result => {
        if (controller.signal.aborted) return
        directRepoHistoryIncomplete = !result.complete
      })
      .catch(error => {
        if (controller.signal.aborted) return
        directRepoHistoryIncomplete = true
        console.warn("[community-repositories] Failed to load direct repositories", error)
      })
      .finally(() => {
        if (controller.signal.aborted) return
        directRepoLoading = false
        directRepoLoadSettled = true
      })

    return () => controller.abort()
  })

  $effect(() => {
    void directRepoRetryVersion
    const relays = $activeExactCommunityRelays
    const relayFilters = communityRepoAssociationFilterPlan.relayFilters
    const localFilters = communityRepoAssociationFilterPlan.localFilters

    if (!communityBootstrapReady) {
      targetedRepoLoading = false
      targetedRepoRequestDone = false
      targetedRepoHistoryIncomplete = false
      return
    }
    if (relayFilters.length === 0 || localFilters.length === 0) {
      targetedRepoLoading = false
      targetedRepoRequestDone = true
      targetedRepoHistoryIncomplete = false
      return
    }
    if (relays.length === 0) {
      targetedRepoLoading = false
      targetedRepoRequestDone = true
      targetedRepoHistoryIncomplete = true
      return
    }

    const controller = new AbortController()
    targetedRepoLoading = true
    targetedRepoRequestDone = false
    targetedRepoHistoryIncomplete = false
    void loadBoundedCommunityHistory({
      relays,
      relayFilters,
      localFilters,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      owner: `community-repository-targets:${communityPubkey}`,
      signal: controller.signal,
    })
      .then(result => {
        if (controller.signal.aborted) return
        targetedRepoHistoryIncomplete = !result.complete
      })
      .catch(error => {
        if (controller.signal.aborted) return
        targetedRepoHistoryIncomplete = true
        console.warn("[community-repositories] Failed to load repository targets", error)
      })
      .finally(() => {
        if (controller.signal.aborted) return
        targetedRepoLoading = false
        targetedRepoRequestDone = true
      })

    return () => controller.abort()
  })

  $effect(() => {
    void directRepoRetryVersion

    if (!communityBootstrapReady) {
      targetedOriginalLoading = false
      targetedOriginalRequestDone = false
      targetedOriginalHistoryIncomplete = false
      return
    }
    if (targetedRepoFilterPlan.relayFilters.length === 0) {
      targetedOriginalLoading = false
      targetedOriginalRequestDone = true
      targetedOriginalHistoryIncomplete = false
      return
    }

    const plans = [
      {
        relays: $activeExactCommunityRelays,
        relayFilters: targetedRepoFilterPlan.relayFilters,
        localFilters: targetedRepoFilterPlan.localFilters,
      },
      ...targetedRepoRelayHintPlans,
    ].filter(plan => plan.relays.length > 0)
    if (plans.length === 0) {
      targetedOriginalLoading = false
      targetedOriginalRequestDone = true
      targetedOriginalHistoryIncomplete = true
      return
    }

    const controller = new AbortController()
    targetedOriginalLoading = true
    targetedOriginalRequestDone = false
    targetedOriginalHistoryIncomplete = false
    void Promise.all(
      plans.map(plan =>
        loadBoundedCommunityHistory({
          ...plan,
          priority: RELAY_REQUEST_PRIORITY.interactive,
          owner: `community-repository-originals:${communityPubkey}`,
          signal: controller.signal,
        }),
      ),
    )
      .then(results => {
        if (controller.signal.aborted) return
        targetedOriginalHistoryIncomplete = results.some(result => !result.complete)
      })
      .catch(error => {
        if (controller.signal.aborted) return
        targetedOriginalHistoryIncomplete = true
        console.warn("[community-repositories] Failed to load targeted repositories", error)
      })
      .finally(() => {
        if (controller.signal.aborted) return
        targetedOriginalLoading = false
        targetedOriginalRequestDone = true
      })

    return () => controller.abort()
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center">
      <Icon icon={Git} />
    </div>
  {/snippet}
  {#snippet title()}
    <strong>Repositories</strong>
  {/snippet}
  {#snippet action()}
    <CommunityMenuButton community={routeCommunity?.naddr} />
  {/snippet}
</PageBar>

<PageContent class="content col-4 p-4">
  <form class="card2 bg-alt col-3 p-4 shadow-md" onsubmit={preventDefault(createRepoAnnouncement)}>
    <strong>Create repository announcement</strong>
    <Field>
      {#snippet label()}<p>Name</p>{/snippet}
      {#snippet input()}<input
          bind:value={name}
          class="input input-bordered w-full"
          type="text" />{/snippet}
    </Field>
    <Field>
      {#snippet label()}<p>Identifier</p>{/snippet}
      {#snippet input()}<input
          bind:value={slug}
          class="input input-bordered w-full"
          type="text" />{/snippet}
    </Field>
    <Field>
      {#snippet label()}<p>Clone URL</p>{/snippet}
      {#snippet input()}<input
          bind:value={clone}
          class="input input-bordered w-full"
          type="text" />{/snippet}
    </Field>
    <Field>
      {#snippet label()}<p>Description</p>{/snippet}
      {#snippet input()}<textarea
          bind:value={description}
          class="textarea textarea-bordered"
          rows="3"></textarea
        >{/snippet}
    </Field>
    <div class="flex justify-end">
      <PublishGate
        target={COMMUNITY_WRITE_TARGETS.repository}
        action="publish repositories"
        submit
        disabled={!name.trim()}>
        Publish repo
      </PublishGate>
    </div>
  </form>

  <div class="col-2">
    {#each repos as repo (repo.id)}
      <div class="card2 bg-alt p-4 shadow-md">
        <strong
          >{getTagValue("name", repo.tags) || getTagValue("d", repo.tags) || "Repository"}</strong>
        <p class="text-sm opacity-70">{getTagValue("description", repo.tags) || ""}</p>
        {#if getTagValue("clone", repo.tags)}
          <p class="break-all text-xs opacity-60">{getTagValue("clone", repo.tags)}</p>
        {/if}
      </div>
    {:else}
      <p class="py-8 text-center opacity-70">
        {#if reposLoading}
          <Spinner loading>Looking for repositories...</Spinner>
        {:else if communityBootstrapFailed || communityAuthorityUnavailable}
          <span class="flex flex-col items-center gap-3">
            Repositories unavailable.
            <button class="btn btn-neutral btn-sm" type="button" onclick={retryDirectRepoHistory}
              >Retry</button>
          </span>
        {:else}
          No repositories found.
        {/if}
      </p>
    {/each}
  </div>
</PageContent>
