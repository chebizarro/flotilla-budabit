<script lang="ts">
  import {pubkey} from "@welshman/app"
  import {onDestroy} from "svelte"
  import Link from "@lib/components/Link.svelte"
  import {normalizePubkey} from "@app/core/community"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
  import {
    activeExactCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    activeUserCommunityRefs,
    activeExactCommunityPointer,
  } from "@app/core/community-state"
  import {
    communityExtensionPrompt,
    clearCommunityExtensionPromptLogin,
    dismissCommunityExtensionPrompt,
    ensureCommunityExtensionPromptLogin,
    isCommunityExtensionPromptDismissed,
  } from "@app/extensions/community-extension-prompt"
  import {
    getCommunityWidgetCurationEvidenceKey,
    loadCachedCommunityCuratedWidgets,
  } from "@app/extensions/community-widget-slots"
  import {getTrustedCommunityWidgets} from "@app/extensions/community-widget-trust"
  import {effectiveExtensionSettings} from "@app/extensions/settings"
  import {logCommunityWidgetDebug} from "@app/extensions/community-widget-debug"
  import {getWidgetLineId} from "@app/extensions/widget-identity"
  import type {SmartWidgetEvent} from "@app/extensions/types"
  import {makeExactCommunityInputValue} from "@app/util/community-stars"

  type Props = {
    relayHints?: string[]
  }

  const props: Props = $props()
  void props.relayHints

  let widgets = $state<SmartWidgetEvent[]>([])
  let trustedAuthorPubkeys = $state<string[]>([])
  let loadKey = ""
  let loadRequestId = 0
  let lastLoadEvidenceKey = ""
  let sawLoggedInUser = false

  const curationEvidence = $derived.by(() => {
    const definition = $activeExactCommunityDefinition
    const matchesCommunity =
      definition &&
      $activeExactCommunityPointer &&
      definition.ownerPubkey === $activeExactCommunityPointer.ownerPubkey
    const profileListEvents = matchesCommunity ? $activeCommunityProfileListEvents : []
    const reportState = matchesCommunity ? $activeCommunityReportState : undefined

    return {
      ready: Boolean(matchesCommunity),
      key: matchesCommunity
        ? getCommunityWidgetCurationEvidenceKey({
            definitionEventId: definition.event.id,
            profileListEvents,
            reportState,
          })
        : "",
      profileListEvents,
      reportState,
    }
  })
  const isCommunityMember = $derived(
    $activeUserCommunityRefs.some(
      ref => ref.community.address === $activeExactCommunityPointer?.address,
    ),
  )
  const trustedWidgets = $derived(getTrustedCommunityWidgets(widgets, trustedAuthorPubkeys))
  const installedWidgetIds = $derived(
    new Set(Object.keys($effectiveExtensionSettings.installed?.widget || {})),
  )
  const hasInstalledTrustedWidget = $derived(
    trustedWidgets.some(widget => installedWidgetIds.has(getWidgetLineId(widget))),
  )
  const dismissed = $derived(
    Boolean(
      $activeExactCommunityPointer &&
      isCommunityExtensionPromptDismissed(
        $pubkey || "",
        $activeExactCommunityPointer,
        $communityExtensionPrompt,
      ),
    ),
  )
  const showPrompt = $derived(
    Boolean(
      $pubkey &&
      isCommunityMember &&
      !dismissed &&
      trustedWidgets.length > 0 &&
      !hasInstalledTrustedWidget,
    ),
  )
  const settingsHref = $derived(
    `/settings/extensions?community=${encodeURIComponent($activeExactCommunityPointer?.naddr || "")}&focus=trusted#community-extensions`,
  )

  const dismiss = () => {
    if ($pubkey && $activeExactCommunityPointer) {
      dismissCommunityExtensionPrompt($pubkey, $activeExactCommunityPointer)
    }
  }

  $effect(() => {
    if ($pubkey) {
      sawLoggedInUser = true
      ensureCommunityExtensionPromptLogin($pubkey)
    } else if (sawLoggedInUser) {
      sawLoggedInUser = false
      clearCommunityExtensionPromptLogin()
    }
  })

  $effect(() => {
    const input = $activeExactCommunityPointer
      ? makeExactCommunityInputValue($activeExactCommunityPointer)
      : ""
    const evidence = curationEvidence
    const key =
      $pubkey && isCommunityMember && !dismissed && input && evidence.ready
        ? `${normalizePubkey($pubkey)}:${input}:${evidence.key}`
        : ""

    if (!key) {
      widgets = []
      trustedAuthorPubkeys = []
      loadKey = ""
      loadRequestId += 1
      return
    }

    if (key === loadKey) return
    loadKey = key
    widgets = []
    trustedAuthorPubkeys = []
    const force = Boolean(lastLoadEvidenceKey && lastLoadEvidenceKey !== evidence.key)
    lastLoadEvidenceKey = evidence.key
    const requestId = ++loadRequestId

    loadCachedCommunityCuratedWidgets(input, {
      evidenceKey: evidence.key,
      force,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      profileListEvents: evidence.profileListEvents,
      reportState: evidence.reportState,
    })
      .then(result => {
        if (!result) return
        if (requestId !== loadRequestId || key !== loadKey) {
          logCommunityWidgetDebug("extensions prompt discarded stale curated widgets result", {
            communityAddress: $activeExactCommunityPointer?.address,
            key,
            currentKey: loadKey,
            requestId,
            currentRequestId: loadRequestId,
            status: result.status,
            widgetCount: result.status === "community" ? result.widgets.length : 0,
          })
          return
        }

        widgets = result.status === "community" ? result.widgets : []
        trustedAuthorPubkeys =
          result.status === "community" ? result.trustedWidgetAuthorPubkeys : []
      })
      .catch(error => {
        if (requestId !== loadRequestId || key !== loadKey) return

        console.warn("[community-extensions-prompt] Failed to load widgets", error)
        widgets = []
        trustedAuthorPubkeys = []
        loadKey = ""
      })
  })

  onDestroy(() => {
    loadRequestId += 1
  })
</script>

{#if showPrompt}
  <section class="card2 border border-primary/40 bg-primary/10 p-3 shadow-md">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="min-w-0">
        <strong>Trusted community extensions are available</strong>
        <p class="text-sm opacity-75">
          This community has {trustedWidgets.length} trusted extension{trustedWidgets.length === 1
            ? ""
            : "s"}. Install them to enhance your experience.
        </p>
      </div>
      <div class="flex shrink-0 flex-wrap gap-2">
        <Link href={settingsHref} class="btn btn-primary btn-sm">See community extensions</Link>
        <button type="button" class="btn btn-ghost btn-sm" onclick={dismiss}>Dismiss</button>
      </div>
    </div>
  </section>
{/if}
