<script lang="ts">
  import {page} from "$app/stores"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {makeEvent, type Filter, type TrustedEvent} from "@welshman/util"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import Ghost from "@assets/icons/ghost-smile.svg?dataurl"
  import BillList from "@assets/icons/bill-list.svg?dataurl"
  import Hashtag from "@assets/icons/hashtag.svg?dataurl"
  import NotesMinimalistic from "@assets/icons/notes-minimalistic.svg?dataurl"
  import CalendarMinimalistic from "@assets/icons/calendar-minimalistic.svg?dataurl"
  import Git from "@assets/icons/git.svg?dataurl"
  import StarFallMinimalistic from "@assets/icons/star-fall-minimalistic.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import Confirm from "@lib/components/Confirm.svelte"
  import Link from "@lib/components/Link.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Content from "@app/components/Content.svelte"
  import CommunityExtensionsPrompt from "@app/components/community/CommunityExtensionsPrompt.svelte"
  import CommunityHomeWidgetSlot from "@app/components/community/CommunityHomeWidgetSlot.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import CommunityRoomCreate from "@app/components/community/CommunityRoomCreate.svelte"
  import CommunityShareButton from "@app/components/community/CommunityShareButton.svelte"
  import CommunityStarButton from "@app/components/community/CommunityStarButton.svelte"
  import PublicationStatus from "@app/components/PublicationStatus.svelte"
  import {fade} from "@lib/transition"
  import {normalizePubkey, normalizeRelays} from "@app/core/community"
  import {
    activeCommunitySession,
    activeCommunityAuthorityReadiness,
    activeCommunityBootstrapStatus,
    activeCommunityDefinition,
    activeCommunityPermissionStatus,
    activeCommunityProfile,
    activeCommunityProfileListEvents,
    activeCommunityPublishRelays,
    activeCommunityReportState,
    activeCommunityRelays,
    getCommunityBootstrapKey,
    getCommunityDefinitionRelayHints,
    hasCommunityHydrationCompleted,
    loadCommunityEventsWithStatus,
    makeCommunitySession,
    markCommunityHydrationCompleted,
    recoverCommunityBootstrap,
  } from "@app/core/community-state"
  import {
    makeCommunityContentFilterPlan,
    makeCommunityRoomRootsFilter,
  } from "@app/core/community-feeds"
  import {readCommunityRoomRoots} from "@app/core/community-rooms"
  import {
    getCommunityModeratorInviteProfileListRefs,
    getPendingCommunityModeratorInvites,
    makeModeratorInviteResponseProfileList,
  } from "@app/core/community-admin"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunityTargetWriterPubkeys,
  } from "@app/core/community-permissions"
  import {isCommunityPersonBanned} from "@app/core/community-reports"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
  import {loadBoundedCommunityHistory, type BoundedCommunityHistoryResult} from "@app/core/requests"
  import {publicationOperations, startPublication} from "@app/core/publication-operations"
  import {assertReplaceablePublicationIsCurrent} from "@app/core/replaceable-publication"
  import {getModeratorInviteResponseSemanticKey} from "@app/core/governance-publication-operations"
  import {
    isCommunityHomeCoreReady,
    isCommunityHomeExtensionReady,
    isCompleteCommunityModeratorEvidence,
    type CommunityModeratorEvidenceStatus,
  } from "@app/extensions/community-home-readiness"
  import {notifications} from "@app/util/notifications"
  import {hasGitNotification} from "@app/util/repo-watch-notifications"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {formatShortNpub} from "@app/util/pubkeys"
  import {makeCommunityInputValue} from "@app/util/community-stars"
  import {
    makeCommunityCalendarPath,
    makeGitCommunityPath,
    makeCommunityGoalPath,
    makeCommunityRoomPath,
    makeCommunityThreadPath,
    parseCommunityRouteParam,
  } from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityId = $derived(parsedCommunity?.pubkey || $activeCommunityDefinition?.pubkey || "")
  const shortCommunity = $derived(formatShortNpub(communityId) || "Unknown community")
  const communityName = $derived(
    $activeCommunityProfile?.display_name || $activeCommunityProfile?.name || shortCommunity,
  )
  const communityDescription = $derived(
    $activeCommunityProfile?.about || $activeCommunityDefinition?.description || "",
  )
  const communityDescriptionEvent = $derived({content: communityDescription, tags: []})
  const communityPicture = $derived($activeCommunityProfile?.picture || "")
  let failedPicture = $state("")
  let retryingCommunityBootstrap = $state(false)
  const showCommunityPicture = $derived(
    Boolean(communityPicture && failedPicture !== communityPicture),
  )
  const mainRelay = $derived(
    $activeCommunityDefinition?.relays[0] || parsedCommunity?.relays[0] || "",
  )
  const communityShareRelays = $derived(
    $activeCommunityDefinition?.pubkey === communityId
      ? getCommunityDefinitionRelayHints($activeCommunityDefinition, parsedCommunity?.relays || [])
      : parsedCommunity?.relays || [],
  )
  const communityActionRelays = $derived(
    communityShareRelays.length > 0 ? communityShareRelays : $activeCommunityRelays,
  )
  const homeWidgetRelayHints = $derived(
    $activeCommunityDefinition?.pubkey === communityId && $activeCommunityRelays.length > 0
      ? $activeCommunityRelays
      : communityShareRelays,
  )
  const threadsPath = $derived(communityId ? makeCommunityThreadPath(communityId) : "")
  const calendarPath = $derived(communityId ? makeCommunityCalendarPath(communityId) : "")
  const goalsPath = $derived(communityId ? makeCommunityGoalPath(communityId) : "")
  const gitCommunityInput = $derived(
    communityId
      ? makeCommunityInputValue({pubkey: communityId, relayHints: communityShareRelays}) ||
          communityId
      : "",
  )
  const gitPath = $derived(makeGitCommunityPath(gitCommunityInput))
  const routeCommunityDefinition = $derived(
    $activeCommunityDefinition?.pubkey === communityId ? $activeCommunityDefinition : undefined,
  )
  const communityDefinitionReady = $derived(Boolean(communityId && routeCommunityDefinition))
  const expectedCommunityBootstrapKey = $derived.by(() => {
    const session = $activeCommunitySession

    return communityId &&
      session &&
      normalizePubkey(session.communityPubkey) === normalizePubkey(communityId)
      ? getCommunityBootstrapKey(session, $pubkey || "")
      : ""
  })
  const retryCommunityBootstrap = async () => {
    const session =
      $activeCommunitySession || (parsedCommunity && makeCommunitySession(parsedCommunity))
    if (!session || retryingCommunityBootstrap) return

    retryingCommunityBootstrap = true

    try {
      await recoverCommunityBootstrap(session, {
        recoverAuth: true,
      })
    } catch (error) {
      console.warn("[community-home] Failed to retry community bootstrap", error)
    } finally {
      retryingCommunityBootstrap = false
    }
  }
  const roomAuthorPubkeys = $derived(
    routeCommunityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: routeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.roomRoot,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const communityBootstrapReady = $derived(
    Boolean(
      communityId &&
      routeCommunityDefinition &&
      expectedCommunityBootstrapKey &&
      $activeCommunityBootstrapStatus.key === expectedCommunityBootstrapKey &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading &&
      !$activeCommunityBootstrapStatus.error,
    ),
  )
  const communityAuthorityReadiness = $derived(
    $activeCommunityAuthorityReadiness.communityPubkey === communityId
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
  const communityBootstrapError = $derived(
    $activeCommunityBootstrapStatus.key === expectedCommunityBootstrapKey
      ? $activeCommunityBootstrapStatus.error || ""
      : "",
  )
  // Short settle window: hide the "Community unavailable" banner for a brief
  // moment after entering a community so a fast bootstrap or an incoming
  // cached definition never causes an error flash.
  const COMMUNITY_UNAVAILABLE_SETTLE_MS = 1_200
  let communityUnavailableSettleReady = $state(false)
  $effect(() => {
    // Reset the settle gate whenever the community changes.
    void communityId
    communityUnavailableSettleReady = false

    const timer = setTimeout(() => {
      communityUnavailableSettleReady = true
    }, COMMUNITY_UNAVAILABLE_SETTLE_MS)

    return () => clearTimeout(timer)
  })
  // Only show the unavailable banner when:
  // 1. The bootstrap reported an error
  // 2. The bootstrap is not currently retrying
  // 3. No cached definition is present in the store
  // 4. The settle gate has elapsed
  const showCommunityUnavailable = $derived(
    Boolean(
      communityBootstrapError &&
      !$activeCommunityBootstrapStatus.loading &&
      !routeCommunityDefinition &&
      communityUnavailableSettleReady,
    ),
  )
  const roomFilterPlan = $derived(
    communityDefinitionReady && communityAuthorityReady && communityId
      ? makeCommunityContentFilterPlan(
          [makeCommunityRoomRootsFilter(communityId)],
          roomAuthorPubkeys,
        )
      : {relayFilters: [], localFilters: []},
  )
  const roomFilters = $derived(roomFilterPlan.localFilters)
  const roomRelayFilters = $derived(roomFilterPlan.relayFilters)
  const roomEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: roomFilters})))
  const rooms = $derived(
    communityAuthorityReady
      ? readCommunityRoomRoots($roomEvents, communityId).filter(
          room => !isCommunityPersonBanned($activeCommunityReportState, room.event.pubkey),
        )
      : [],
  )
  const canCreateRoom = $derived(
    Boolean(
      $pubkey &&
      communityAuthorityReady &&
      $activeCommunityDefinition &&
      canWriteCommunityTarget({
        definition: $activeCommunityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.roomRoot,
        reportState: $activeCommunityReportState,
      }),
    ),
  )
  const createRoomPermissionLoading = $derived(Boolean(communityAuthorityLoading && !canCreateRoom))
  const communityHomeCoreReady = $derived(
    isCommunityHomeCoreReady({
      communityPubkey: communityId,
      definitionPubkey: routeCommunityDefinition?.pubkey || "",
      expectedBootstrapKey: expectedCommunityBootstrapKey,
      permissionReadiness: communityAuthorityReadiness,
      bootstrapStatus: $activeCommunityBootstrapStatus,
    }),
  )
  let moderatorInviteEvidenceState = $state<{
    key: string
    status: CommunityModeratorEvidenceStatus
    events: TrustedEvent[]
  }>({key: "", status: "unresolved", events: []})
  let moderatorInviteEvidenceLoadKey = ""
  let moderatorInviteEvidenceRetryKey = ""
  let moderatorInviteEvidenceRetryCount = 0
  let moderatorInviteEvidenceRetryNonce = $state(0)
  let moderatorInviteEvidenceRetryTimer: ReturnType<typeof setTimeout> | undefined
  const moderatorInviteProfileListEvents = $derived([
    ...$activeCommunityProfileListEvents,
    ...moderatorInviteEvidenceState.events,
  ])
  const pendingModeratorInvites = $derived.by(() => {
    return getPendingCommunityModeratorInvites({
      definition: routeCommunityDefinition,
      moderatorPubkey: $pubkey || undefined,
      profileListEvents: moderatorInviteProfileListEvents,
    })
  })
  const moderatorInviteOperationIds = $derived.by(() => {
    const operationIds = new Map<string, string>()

    for (const invite of pendingModeratorInvites) {
      const semanticKey = getModeratorInviteResponseSemanticKey(invite.profileList.address)
      const operation = Array.from($publicationOperations.values()).find(
        candidate =>
          candidate.ownerPubkey === $pubkey &&
          candidate.semanticKey === semanticKey &&
          (candidate.phase === "publishing" || candidate.phase === "unconfirmed"),
      )

      if (operation) operationIds.set(invite.profileList.address, operation.operationId)
    }

    return operationIds
  })
  const startableModeratorInvites = $derived(
    pendingModeratorInvites.filter(
      invite => !moderatorInviteOperationIds.has(invite.profileList.address),
    ),
  )
  const moderatorInviteProfileListRefs = $derived.by(() =>
    getCommunityModeratorInviteProfileListRefs({
      definition: routeCommunityDefinition,
      moderatorPubkey: $pubkey || undefined,
    }),
  )
  const moderatorInviteEvidenceExpectedKey = $derived.by(() => {
    const definition = routeCommunityDefinition
    const user = $pubkey || ""
    const refs = Array.from(new Set(moderatorInviteProfileListRefs.map(ref => ref.address))).sort()
    const relays = normalizeRelays($activeCommunityRelays)

    return communityHomeCoreReady && definition && user && refs.length > 0 && relays.length > 0
      ? JSON.stringify({
          bootstrapKey: expectedCommunityBootstrapKey,
          permissionKey: $activeCommunityPermissionStatus.key,
          viewer: user,
          community: communityId,
          definition: definition.event.id,
          relays,
          addresses: refs,
        })
      : ""
  })
  const showPendingModeratorInvites = $derived(
    communityAuthorityReadiness === "ready" &&
      isCompleteCommunityModeratorEvidence(
        moderatorInviteEvidenceExpectedKey,
        moderatorInviteEvidenceState,
      ) &&
      pendingModeratorInvites.length > 0,
  )
  const MODERATOR_INVITE_EVIDENCE_TIMEOUT_MS = 2_000
  const MODERATOR_INVITE_EVIDENCE_RETRY_DELAY_MS = 5_000
  const MODERATOR_INVITE_EVIDENCE_RETRY_LIMIT = 2
  const ROOM_ROOT_LOAD_TIMEOUT_MS = 8_000
  const ROOM_ROOT_EMPTY_RETRY_DELAY_MS = 2_000
  const ROOM_ROOT_EMPTY_RETRY_LIMIT = 2
  let roomRootsLoading = $state(false)
  let roomRootsLoaded = $state(false)
  let roomRootsComplete = $state(false)
  let roomRootsIncomplete = $state(false)
  let roomRootsFirstAttemptKey = $state("")
  let roomRootsFirstAttemptTerminal = $state(false)
  let roomLoadKey = ""
  let roomLoadHydrationKey = ""
  let roomLoadRetryNonce = $state(0)
  let roomLoadEmptyRetries = 0
  let roomLoadRetryTimer: ReturnType<typeof setTimeout> | undefined
  const roomCatalogReadinessKey = $derived(
    communityHomeCoreReady
      ? JSON.stringify({
          bootstrapKey: expectedCommunityBootstrapKey,
          permissionKey: $activeCommunityPermissionStatus.key,
          relays: normalizeRelays($activeCommunityRelays),
          filters: roomFilters,
          relayFilters: roomRelayFilters,
        })
      : "",
  )
  const communityHomeExtensionsReady = $derived(
    isCommunityHomeExtensionReady({
      communityPubkey: communityId,
      definitionPubkey: routeCommunityDefinition?.pubkey || "",
      expectedBootstrapKey: expectedCommunityBootstrapKey,
      permissionReadiness: communityAuthorityReadiness,
      bootstrapStatus: $activeCommunityBootstrapStatus,
      roomsPresent: rooms.length > 0,
      expectedRoomCatalogKey: roomCatalogReadinessKey,
      firstRoomCatalogKey: roomRootsFirstAttemptKey,
      firstRoomCatalogTerminal: roomRootsFirstAttemptTerminal,
    }),
  )
  const roomsWaitingForDefinition = $derived(
    Boolean(
      communityId &&
      (!communityDefinitionReady || !communityBootstrapReady) &&
      !showCommunityUnavailable,
    ),
  )
  const roomsUnavailable = $derived(
    Boolean(
      communityId &&
      ((!communityDefinitionReady && showCommunityUnavailable) || communityAuthorityUnavailable),
    ),
  )
  const roomsWaitingForRequest = $derived(
    Boolean(roomFilters.length > 0 && (roomRootsLoading || !roomRootsLoaded)),
  )
  const roomsWaitingForPermissions = $derived(
    Boolean(
      communityAuthorityLoading &&
      communityDefinitionReady &&
      rooms.length === 0 &&
      roomFilters.length === 0,
    ),
  )
  const roomsLoading = $derived(
    roomsWaitingForDefinition || roomsWaitingForRequest || roomsWaitingForPermissions,
  )
  // Skeleton delay: suppress the loading card entirely for the first
  // ~800ms after entering a community so fast/warm cache paths never
  // flash a "Looking for rooms..." spinner.
  const ROOMS_SKELETON_DELAY_MS = 800
  let roomsSkeletonDelayElapsed = $state(false)
  $effect(() => {
    // Reset whenever the community changes.
    void communityId
    roomsSkeletonDelayElapsed = false
    const timer = setTimeout(() => {
      roomsSkeletonDelayElapsed = true
    }, ROOMS_SKELETON_DELAY_MS)
    return () => clearTimeout(timer)
  })
  const roomsSettledEmpty = $derived(
    Boolean(
      communityId &&
      rooms.length === 0 &&
      roomFilters.length > 0 &&
      roomRootsLoaded &&
      roomRootsComplete &&
      !roomRootsLoading &&
      !roomsWaitingForDefinition &&
      !roomsUnavailable,
    ),
  )

  const clearRoomLoadRetry = () => {
    if (!roomLoadRetryTimer) return

    clearTimeout(roomLoadRetryTimer)
    roomLoadRetryTimer = undefined
  }

  const scheduleRoomLoadRetry = () => {
    if (roomLoadRetryTimer || roomLoadEmptyRetries >= ROOM_ROOT_EMPTY_RETRY_LIMIT) return false

    roomLoadEmptyRetries += 1
    roomRootsLoading = true
    roomRootsLoaded = false
    roomLoadRetryTimer = setTimeout(() => {
      roomLoadRetryTimer = undefined
      roomLoadKey = ""
      roomLoadRetryNonce += 1
    }, ROOM_ROOT_EMPTY_RETRY_DELAY_MS * roomLoadEmptyRetries)

    return true
  }

  const clearModeratorInviteEvidenceRetry = () => {
    if (!moderatorInviteEvidenceRetryTimer) return

    clearTimeout(moderatorInviteEvidenceRetryTimer)
    moderatorInviteEvidenceRetryTimer = undefined
  }

  const scheduleModeratorInviteEvidenceRetry = (key: string) => {
    if (
      moderatorInviteEvidenceRetryTimer ||
      moderatorInviteEvidenceRetryCount >= MODERATOR_INVITE_EVIDENCE_RETRY_LIMIT
    ) {
      return
    }

    moderatorInviteEvidenceRetryCount += 1
    moderatorInviteEvidenceRetryTimer = setTimeout(() => {
      moderatorInviteEvidenceRetryTimer = undefined
      if (moderatorInviteEvidenceExpectedKey !== key) return

      moderatorInviteEvidenceLoadKey = ""
      moderatorInviteEvidenceRetryNonce += 1
    }, MODERATOR_INVITE_EVIDENCE_RETRY_DELAY_MS * moderatorInviteEvidenceRetryCount)
  }

  const createRoom = () => {
    if (communityId) pushModal(CommunityRoomCreate, {communityPubkey: communityId})
  }

  const respondToModeratorInvite = (declined: boolean) => {
    const invites = Array.from(
      new Map(
        startableModeratorInvites.map(invite => [invite.profileList.address, invite]),
      ).values(),
    )
    if (invites.length === 0) return

    const relays = $activeCommunityPublishRelays
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community definition must declare at least one relay."})
      return
    }

    pushModal(Confirm, {
      title: declined ? "Decline moderation request" : "Accept moderation request",
      message: declined
        ? `Are you sure you decline moderator role in ${communityName} community?`
        : `Do you really accept moderator role in ${communityName} community?`,
      confirm: () => {
        let started = 0
        let startError: unknown

        for (const invite of invites) {
          const response = makeModeratorInviteResponseProfileList({
            profileList: invite.profileList,
            declined,
          })

          try {
            startPublication({
              relays,
              event: makeEvent(response.kind, response),
              label: `Moderator response for ${invite.displayName}`,
              href: $page.url.pathname,
              semanticKey: getModeratorInviteResponseSemanticKey(invite.profileList.address),
              preview: "none",
              validateRetry: assertReplaceablePublicationIsCurrent,
            })
            started += 1
          } catch (error) {
            startError ||= error
          }
        }

        if (startError) {
          pushToast({
            theme: "error",
            message:
              startError instanceof Error
                ? startError.message
                : "Failed to publish a moderator response.",
          })
        }
        if (started > 0) history.back()
      },
    })
  }

  $effect(() => {
    void moderatorInviteEvidenceRetryNonce
    const refs = Array.from(
      new Map(moderatorInviteProfileListRefs.map(ref => [ref.address, ref])).values(),
    ).sort((a, b) => a.address.localeCompare(b.address))
    const relays = normalizeRelays($activeCommunityRelays)
    const key = moderatorInviteEvidenceExpectedKey

    if (!key) {
      clearModeratorInviteEvidenceRetry()
      moderatorInviteEvidenceLoadKey = ""
      moderatorInviteEvidenceRetryKey = ""
      moderatorInviteEvidenceRetryCount = 0
      moderatorInviteEvidenceState = {key: "", status: "unresolved", events: []}
      return
    }

    if (moderatorInviteEvidenceRetryKey !== key) {
      clearModeratorInviteEvidenceRetry()
      moderatorInviteEvidenceRetryKey = key
      moderatorInviteEvidenceRetryCount = 0
    }

    const requestKey = `${key}:${moderatorInviteEvidenceRetryNonce}`
    if (moderatorInviteEvidenceLoadKey === requestKey) return

    moderatorInviteEvidenceLoadKey = requestKey
    moderatorInviteEvidenceState = {key, status: "loading", events: []}
    const controller = new AbortController()

    const filters = refs.map(
      ref =>
        ({
          kinds: [ref.kind],
          authors: [ref.pubkey],
          "#d": [ref.identifier],
          limit: 1,
        }) satisfies Filter,
    )

    loadCommunityEventsWithStatus(relays, filters, {
      authenticate: true,
      priorityAuthRelays: relays,
      timeout: MODERATOR_INVITE_EVIDENCE_TIMEOUT_MS,
      settle: "all",
      signal: controller.signal,
    })
      .then(result => {
        if (
          controller.signal.aborted ||
          moderatorInviteEvidenceLoadKey !== requestKey ||
          moderatorInviteEvidenceExpectedKey !== key
        ) {
          return
        }

        moderatorInviteEvidenceState = {
          key,
          status: result.complete ? "complete" : "unresolved",
          events: result.events,
        }
        if (!result.complete) scheduleModeratorInviteEvidenceRetry(key)
      })
      .catch(error => {
        if (controller.signal.aborted || moderatorInviteEvidenceLoadKey !== requestKey) return

        moderatorInviteEvidenceState = {key, status: "unresolved", events: []}
        scheduleModeratorInviteEvidenceRetry(key)
        console.warn("[community-home] Failed to hydrate moderator invite evidence", error)
      })

    return () => {
      clearModeratorInviteEvidenceRetry()
      controller.abort()
    }
  })

  $effect(() => {
    const key = roomCatalogReadinessKey

    if (!key) {
      roomRootsLoading = false
      roomRootsComplete = false
      roomRootsIncomplete = false
      roomRootsFirstAttemptKey = ""
      roomRootsFirstAttemptTerminal = false
      roomLoadKey = ""
      roomLoadHydrationKey = ""
      roomLoadEmptyRetries = 0
      roomRootsLoaded = false
      clearRoomLoadRetry()
      return
    }

    const catalog = JSON.parse(key) as {
      relays: string[]
      filters: Filter[]
      relayFilters: Filter[]
    }
    const relays = catalog.relays
    const filters = catalog.filters
    const relayFilters = catalog.relayFilters

    if (roomLoadHydrationKey !== key) {
      roomLoadHydrationKey = key
      roomLoadEmptyRetries = 0
      roomRootsFirstAttemptKey = key
      roomRootsFirstAttemptTerminal = false
      clearRoomLoadRetry()
      roomLoadRetryNonce = 0
    }

    if (relays.length === 0 || filters.length === 0 || relayFilters.length === 0) {
      roomLoadKey = key
      roomRootsLoading = false
      roomRootsLoaded = true
      roomRootsComplete = filters.length === 0
      roomRootsIncomplete = !roomRootsComplete
      roomRootsFirstAttemptTerminal = true
      clearRoomLoadRetry()
      return
    }

    const requestKey = `${key}:${roomLoadRetryNonce}`

    if (roomLoadKey === requestKey) return
    if (hasCommunityHydrationCompleted(key)) {
      roomLoadKey = requestKey
      roomRootsLoading = false
      roomRootsLoaded = true
      roomRootsComplete = true
      roomRootsIncomplete = false
      roomRootsFirstAttemptTerminal = true
      clearRoomLoadRetry()
      return
    }

    const controller = new AbortController()
    let disposed = false

    roomLoadKey = requestKey
    roomRootsLoading = true
    roomRootsLoaded = false
    roomRootsIncomplete = false

    const finishRoomLoad = (result: BoundedCommunityHistoryResult) => {
      if (disposed || roomLoadKey !== requestKey) return

      roomRootsFirstAttemptTerminal = true

      const loadedRooms = readCommunityRoomRoots(result.events, communityId).filter(
        room => !isCommunityPersonBanned($activeCommunityReportState, room.event.pubkey),
      )
      const hasLoadedRooms = loadedRooms.length > 0 || rooms.length > 0

      if (hasLoadedRooms) {
        roomRootsComplete = result.complete
        roomRootsIncomplete = !roomRootsComplete
        if (roomRootsComplete) markCommunityHydrationCompleted(key)
        clearRoomLoadRetry()
        roomRootsLoading = false
        roomRootsLoaded = true
        return
      }

      const shouldRetryEmpty = roomLoadEmptyRetries === 0 || !result.complete
      if (shouldRetryEmpty && scheduleRoomLoadRetry()) return

      roomRootsComplete = result.complete
      roomRootsIncomplete = !roomRootsComplete
      if (roomRootsComplete) markCommunityHydrationCompleted(key)
      roomRootsLoading = false
      roomRootsLoaded = true
    }

    loadBoundedCommunityHistory({
      relays,
      relayFilters,
      localFilters: filters,
      priority: RELAY_REQUEST_PRIORITY.community,
      owner: `community-home-rooms:${communityId}`,
      timeoutMs: ROOM_ROOT_LOAD_TIMEOUT_MS,
      signal: controller.signal,
    })
      .then(finishRoomLoad)
      .catch(error => {
        if (!controller.signal.aborted) console.warn("[community-home] Failed to load rooms", error)
        finishRoomLoad({events: [], complete: false, timedOut: false, saturated: false})
      })

    return () => {
      disposed = true
      clearRoomLoadRetry()
      controller.abort()
    }
  })
</script>

<PageBar showTopMenuWidgets={communityHomeExtensionsReady}>
  {#snippet icon()}
    <div class="center">
      <Icon icon={HomeSmile} />
    </div>
  {/snippet}
  {#snippet title()}
    <strong>Home</strong>
  {/snippet}
  {#snippet action()}
    <CommunityMenuButton community={communityId} />
  {/snippet}
</PageBar>

<PageContent class="flex flex-col gap-2 p-2 pt-4">
  <div class="card2 bg-alt relative flex flex-col items-center gap-4 text-left">
    {#if communityId}
      <div class="flex w-full justify-end gap-2">
        {#if $activeCommunityDefinition?.pubkey === communityId}
          <CommunityShareButton communityPubkey={communityId} relayHints={communityShareRelays} />
        {/if}
        <CommunityStarButton
          communityPubkey={communityId}
          relayHints={communityActionRelays}
          publishRelayHints={$activeCommunityPublishRelays} />
      </div>
    {/if}
    <div class="relative flex gap-4">
      <div class="relative">
        <div class="avatar relative">
          <div
            class="center !flex h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-solid border-base-300 bg-base-300 sm:h-20 sm:w-20">
            {#if showCommunityPicture}
              <img
                alt=""
                src={communityPicture}
                class="h-full w-full object-cover"
                onerror={() => (failedPicture = communityPicture)} />
            {:else}
              <Icon icon={Ghost} size={6} />
            {/if}
          </div>
        </div>
      </div>
      <div class="flex min-w-0 flex-col justify-center gap-1">
        <h1 class="ellipsize whitespace-nowrap text-2xl font-bold">{communityName}</h1>
        <p class="ellipsize text-sm opacity-75">{mainRelay || shortCommunity}</p>
      </div>
    </div>
    {#if communityDescription}
      <div class="w-full min-w-0 max-w-3xl break-words text-center md:text-xl">
        <Content event={communityDescriptionEvent} showEntire />
      </div>
    {/if}
    {#if $activeCommunityDefinition?.tos}
      <div class="flex flex-wrap justify-center gap-3">
        {#if $activeCommunityDefinition?.tos}
          <Link
            href={$activeCommunityDefinition.tos.relay || "#"}
            class="badge badge-neutral flex gap-2">
            <Icon icon={BillList} size={4} />
            Terms
          </Link>
        {/if}
      </div>
    {/if}
  </div>

  {#if showCommunityUnavailable}
    <section class="card2 border-warning bg-warning/10 p-4 shadow-md">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="min-w-0">
          <h2 class="text-lg font-semibold text-warning">Community unavailable</h2>
          <p class="mt-1 text-sm opacity-75">
            The community definition did not load. This can happen after a stale mobile connection
            or when relay auth is required.
          </p>
        </div>
        <Button
          class="btn btn-warning shrink-0 justify-center"
          disabled={retryingCommunityBootstrap}
          onclick={retryCommunityBootstrap}>
          {#if retryingCommunityBootstrap}
            <span class="loading loading-spinner loading-xs"></span>
          {/if}
          Retry
        </Button>
      </div>
    </section>
  {/if}

  {#if showPendingModeratorInvites}
    <section class="card2 border-warning bg-warning/10 p-4 shadow-md">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0">
          <h2 class="text-lg font-semibold text-warning">
            You have been requested to moderate this group
          </h2>
          <p class="mt-1 text-sm opacity-75">
            Accepting publishes empty moderator lists owned by your key, making the role active and
            helping the community load faster for everyone.
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            {#each pendingModeratorInvites as invite (`${invite.profileList.address}:${invite.sectionName}`)}
              <span class="badge badge-warning">{invite.displayName}</span>
            {/each}
          </div>
          {#each Array.from(new Set(moderatorInviteOperationIds.values())) as operationId (operationId)}
            <PublicationStatus {operationId} class="mt-3" />
          {/each}
        </div>
        <div class="grid shrink-0 grid-cols-1 gap-2 sm:w-40">
          <Button
            class="btn btn-warning justify-center"
            disabled={startableModeratorInvites.length === 0}
            onclick={() => respondToModeratorInvite(false)}>
            Accept
          </Button>
          <Button
            class="btn btn-ghost justify-center"
            disabled={startableModeratorInvites.length === 0}
            onclick={() => respondToModeratorInvite(true)}>
            Decline
          </Button>
        </div>
      </div>
    </section>
  {/if}

  {#if communityId && communityHomeExtensionsReady}
    {#key roomCatalogReadinessKey}
      <CommunityExtensionsPrompt communityPubkey={communityId} relayHints={homeWidgetRelayHints} />

      <CommunityHomeWidgetSlot
        communityPubkey={communityId}
        relayHints={homeWidgetRelayHints}
        slotType="community-home-before-quicklinks" />
    {/key}
  {/if}

  <div class="grid gap-2 max-sm:grid-cols-2 sm:grid-cols-3">
    <Link
      href={gitPath}
      class="btn border-none bg-[#0284c7] text-white hover:bg-[#0369a1] md:text-lg">
      <div class="relative flex items-center gap-2">
        <Icon icon={Git} />
        Git
        {#if hasGitNotification($notifications)}
          <div
            class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-primary-content"
            transition:fade>
          </div>
        {/if}
      </div>
    </Link>
    {#if threadsPath}
      <Link
        href={threadsPath}
        class="btn border-none bg-[#4f46e5] text-white hover:bg-[#4338ca] md:text-lg">
        <div class="relative flex items-center gap-2">
          <Icon icon={NotesMinimalistic} size={6} />
          Threads
          {#if $notifications.has(threadsPath)}
            <div class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-white" transition:fade>
            </div>
          {/if}
        </div>
      </Link>
    {/if}
    {#if calendarPath}
      <Link
        href={calendarPath}
        class="btn border-none bg-[#c2410c] text-white hover:bg-[#9a3412] md:text-lg">
        <div class="relative flex items-center gap-2">
          <Icon icon={CalendarMinimalistic} size={6} />
          Calendar
          {#if $notifications.has(calendarPath)}
            <div class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-white" transition:fade>
            </div>
          {/if}
        </div>
      </Link>
    {/if}
    {#if goalsPath}
      <Link
        href={goalsPath}
        class="btn border-none bg-[#a16207] text-white hover:bg-[#854d0e] md:text-lg">
        <div class="relative flex items-center gap-2">
          <Icon icon={StarFallMinimalistic} />
          Goals
          {#if $notifications.has(goalsPath)}
            <div class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-white" transition:fade>
            </div>
          {/if}
        </div>
      </Link>
    {/if}
    {#each rooms as room (room.id)}
      {@const roomPath = makeCommunityRoomPath(communityId, room.id)}
      <Link href={roomPath} class="btn btn-neutral relative">
        <div class="flex min-w-0 items-center gap-2 overflow-hidden text-nowrap md:text-lg">
          <Icon icon={Hashtag} />
          <span class="ellipsize">{room.name}</span>
        </div>
        {#if $notifications.has(roomPath)}
          <div class="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" transition:fade></div>
        {/if}
      </Link>
    {/each}
    {#if communityId && rooms.length === 0 && (roomsSkeletonDelayElapsed || !roomsLoading)}
      <div class="card2 bg-alt col-span-full flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h3 class="flex items-center gap-2 text-lg font-semibold">
            <Icon icon={Hashtag} />
            {roomsWaitingForPermissions
              ? "Loading Rooms..."
              : roomsLoading
                ? "Looking for rooms..."
                : roomsUnavailable
                  ? "Rooms unavailable"
                  : "No rooms found"}
          </h3>
          <p class="text-sm opacity-70">
            {roomsWaitingForPermissions
              ? "Loading community rooms."
              : roomsLoading
                ? "Loading community rooms."
                : roomsUnavailable
                  ? "Rooms could not be loaded."
                  : createRoomPermissionLoading
                    ? "Loading room actions."
                    : canCreateRoom && roomsSettledEmpty
                      ? "Create the first room for this community."
                      : "No rooms have been published yet."}
          </p>
        </div>
        {#if roomsUnavailable}
          <Button
            class="btn btn-neutral shrink-0 justify-center"
            disabled={retryingCommunityBootstrap}
            onclick={retryCommunityBootstrap}>
            {retryingCommunityBootstrap ? "Retrying..." : "Retry"}
          </Button>
        {:else if canCreateRoom && roomsSettledEmpty}
          <button class="btn btn-primary" type="button" onclick={createRoom}> Create Room </button>
        {/if}
      </div>
    {/if}
  </div>

  {#if communityId && communityHomeExtensionsReady}
    {#key roomCatalogReadinessKey}
      <CommunityHomeWidgetSlot
        communityPubkey={communityId}
        relayHints={homeWidgetRelayHints}
        slotType="community-home-after-quicklinks" />
    {/key}
  {/if}
</PageContent>
