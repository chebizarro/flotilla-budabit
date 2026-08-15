<script lang="ts">
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {DELETE} from "@welshman/util"
  import Button from "@lib/components/Button.svelte"
  import Link from "@lib/components/Link.svelte"
  import {
    activeCommunityAdmissionForms,
    activeCommunityAdmissionFormReadiness,
    activeCommunityAuthorityReadiness,
    activeCommunityBootstrapStatus,
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    activeCommunityRelays,
    activeCommunitySession,
    makeCommunitySession,
    recoverCommunityBootstrap,
  } from "@app/core/community-state"
  import {FORM_RESPONSE_KIND} from "@app/core/community"
  import {
    getCommunityWriteTargetSections,
    getCommunityPublishGateState,
    type CommunityPublishGateState,
    type CommunityWriteTarget,
  } from "@app/core/community-permissions"
  import {COMMUNITY_FORM_REVIEW_KIND} from "@app/core/community-forms"
  import LogIn from "@app/components/LogIn.svelte"
  import {pushModal} from "@app/util/modal"
  import {makeCommunityPath, parseCommunityRouteParam} from "@app/util/routes"

  type Props = {
    target: CommunityWriteTarget
    alternateTargets?: readonly CommunityWriteTarget[]
    action: string
    disabled?: boolean
    submit?: boolean
    compact?: boolean
    class?: string
    href?: string
    children?: import("svelte").Snippet
  }

  const {
    target,
    alternateTargets = [],
    action,
    disabled = false,
    submit = false,
    compact = false,
    class: className = "btn btn-primary",
    href = "",
    children,
  }: Props = $props()

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(
    parsedCommunity?.pubkey || $activeCommunityDefinition?.pubkey || "",
  )
  const communityBootstrapReady = $derived(
    Boolean(
      communityPubkey &&
      $activeCommunityDefinition?.pubkey === communityPubkey &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading,
    ),
  )
  const communityBootstrapLoading = $derived(
    Boolean(communityPubkey && !communityBootstrapReady && !$activeCommunityBootstrapStatus.error),
  )
  const communityBootstrapUnavailable = $derived(
    Boolean(communityPubkey && !communityBootstrapReady && $activeCommunityBootstrapStatus.error),
  )
  const communityAuthorityReadiness = $derived(
    $activeCommunityAuthorityReadiness.communityPubkey === communityPubkey
      ? $activeCommunityAuthorityReadiness.state
      : "loading",
  )
  const communityAdmissionFormReadiness = $derived(
    $activeCommunityAdmissionFormReadiness.communityPubkey === communityPubkey
      ? $activeCommunityAdmissionFormReadiness.state
      : "loading",
  )
  const targets = $derived.by(() => {
    const selected: CommunityWriteTarget[] = []

    for (const currentTarget of [target, ...alternateTargets]) {
      if (
        !selected.some(
          existing =>
            existing.kind === currentTarget.kind &&
            existing.sectionName === currentTarget.sectionName &&
            existing.subtype === currentTarget.subtype,
        )
      ) {
        selected.push(currentTarget)
      }
    }

    return selected
  })
  const targetSections = $derived.by(() =>
    communityBootstrapReady && $activeCommunityDefinition
      ? targets.reduce(
          (sections, currentTarget) => {
            for (const section of getCommunityWriteTargetSections(
              $activeCommunityDefinition!,
              currentTarget,
            )) {
              if (!sections.some(existing => existing.name === section.name)) {
                sections.push(section)
              }
            }

            return sections
          },
          [] as ReturnType<typeof getCommunityWriteTargetSections>,
        )
      : [],
  )
  const formEntry = $derived.by(() => {
    for (const section of targetSections) {
      const form = $activeCommunityAdmissionForms[section.name]
      if (form) return {sectionName: section.name, form}
    }

    for (const currentTarget of targets) {
      const fallbackForm = $activeCommunityAdmissionForms[currentTarget.sectionName]
      if (fallbackForm) return {sectionName: currentTarget.sectionName, form: fallbackForm}
    }

    return undefined
  })
  const form = $derived(formEntry?.form)
  const targetSectionName = $derived(
    formEntry?.sectionName || targetSections[0]?.name || target.sectionName,
  )
  const accessPath = $derived(
    communityPubkey
      ? `${makeCommunityPath(communityPubkey, "access")}?section=${encodeURIComponent(targetSectionName)}`
      : "",
  )
  const responseFilters = $derived(
    communityBootstrapReady && $pubkey && form
      ? [{kinds: [FORM_RESPONSE_KIND], authors: [$pubkey], "#a": [form.address]}]
      : [],
  )
  const responseEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: responseFilters})),
  )
  const responseIds = $derived($responseEvents.map(event => event.id))
  const deleteFilters = $derived(
    $pubkey && responseIds.length ? [{kinds: [DELETE], authors: [$pubkey], "#e": responseIds}] : [],
  )
  const reviewFilters = $derived(
    responseIds.length ? [{kinds: [COMMUNITY_FORM_REVIEW_KIND], "#e": responseIds}] : [],
  )
  const deleteEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: deleteFilters})),
  )
  const reviewEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: reviewFilters})),
  )
  const gateStates = $derived.by<CommunityPublishGateState[]>(() =>
    communityBootstrapReady && $activeCommunityDefinition
      ? targets.map(currentTarget =>
          getCommunityPublishGateState({
            definition: $activeCommunityDefinition!,
            profileListEvents: $activeCommunityProfileListEvents,
            userPubkey: $pubkey,
            target: currentTarget,
            form,
            formSectionName: formEntry?.sectionName,
            responseEvents: $responseEvents,
            deleteEvents: $deleteEvents,
            reviewEvents: $reviewEvents,
            reportState: $activeCommunityReportState,
          }),
        )
      : [{...target, status: $pubkey ? "missing" : "login-required", form}],
  )
  const gateState = $derived.by<CommunityPublishGateState>(
    () =>
      gateStates.find(state => state.status === "allowed") ||
      gateStates.find(state => state.status === "pending") ||
      gateStates.find(state => state.status === "rejected") ||
      gateStates.find(state => state.status === "granted") ||
      gateStates.find(state => state.status === "missing" && state.form) ||
      gateStates[0] || {...target, status: $pubkey ? "missing" : "login-required", form},
  )
  const canWrite = $derived(
    communityAuthorityReadiness === "ready" && gateState.status === "allowed",
  )
  const hasForm = $derived(Boolean(form))
  const gateAccessLoading = $derived(
    Boolean(
      $pubkey &&
      !canWrite &&
      (communityAuthorityReadiness === "loading" ||
        (!hasForm && communityAdmissionFormReadiness === "loading")),
    ),
  )
  const gateAccessUnavailable = $derived(
    Boolean(
      $pubkey &&
      !canWrite &&
      (communityAuthorityReadiness === "unavailable" ||
        (!hasForm && communityAdmissionFormReadiness === "unavailable")),
    ),
  )
  const reason = $derived(
    !$pubkey
      ? "Log in to request publishing access."
      : gateAccessLoading
        ? `Loading ${gateState.sectionName} access before you can ${action}.`
        : gateAccessUnavailable
          ? `${gateState.sectionName} access is temporarily unavailable.`
          : gateState.status === "banned"
            ? "You are banned from publishing in this community."
            : gateState.status === "pending"
              ? `Your ${gateState.sectionName} membership request is pending.`
              : gateState.status === "rejected"
                ? `Your ${gateState.sectionName} membership request was rejected. Delete it before resubmitting.`
                : gateState.status === "granted"
                  ? `Your ${gateState.sectionName} request was granted. Waiting for community access to sync.`
                  : !hasForm
                    ? `You need ${gateState.sectionName} permission to ${action}, but no application form is available yet.`
                    : `You need ${gateState.sectionName} permission to ${action}.`,
  )
  const accessLabel = $derived(
    gateState.status === "pending"
      ? "Access pending"
      : gateState.status === "banned"
        ? "Banned"
        : gateState.status === "rejected"
          ? "Revise access"
          : gateState.status === "granted"
            ? "Syncing access"
            : hasForm
              ? "Request access"
              : "Access options",
  )
  let retryingAccess = $state(false)

  const login = () => pushModal(LogIn)
  const retryAccess = async () => {
    const session =
      $activeCommunitySession ||
      (parsedCommunity
        ? makeCommunitySession(parsedCommunity, $activeCommunityDefinition)
        : undefined)
    if (!session || retryingAccess) return

    retryingAccess = true
    try {
      await recoverCommunityBootstrap(session, {recoverAuth: true})
    } catch (error) {
      console.warn("[community-access] Failed to recover community access", error)
    } finally {
      retryingAccess = false
    }
  }

  $effect(() => {
    if (!communityBootstrapReady || $activeCommunityRelays.length === 0) return

    const filters = [...responseFilters, ...deleteFilters, ...reviewFilters]
    if (filters.length === 0) return

    const controller = new AbortController()
    request({relays: $activeCommunityRelays, autoClose: true, filters, signal: controller.signal})

    return () => controller.abort()
  })
</script>

{#if communityBootstrapLoading}
  <Button type="button" class={className} disabled title="Loading community access...">
    {@render children?.()}
  </Button>
{:else if communityBootstrapUnavailable || gateAccessUnavailable}
  <Button
    type="button"
    class={className}
    disabled={retryingAccess}
    title={$activeCommunityBootstrapStatus.error || reason}
    onclick={retryAccess}>
    {retryingAccess ? "Retrying..." : compact ? "Retry" : "Retry access"}
  </Button>
{:else if gateAccessLoading}
  <Button type="button" class={className} disabled title={reason}>
    {compact ? "Loading..." : "Loading access"}
  </Button>
{:else if canWrite && href && !submit && !disabled}
  <Link {href} class={className}>
    {@render children?.()}
  </Link>
{:else if canWrite}
  <Button type={submit ? "submit" : "button"} class={className} {disabled}>
    {@render children?.()}
  </Button>
{:else if gateState.status === "banned"}
  <Button type="button" class={className} disabled title={reason}>
    {compact ? "Banned" : `Cannot ${action}`}
  </Button>
{:else if accessPath && $pubkey && hasForm}
  <span title={reason}>
    <Link href={accessPath} class={`${className} ${compact ? "btn-sm" : ""}`}>
      {accessLabel}
    </Link>
  </span>
{:else if accessPath && $pubkey}
  <span title={reason}>
    <Link href={accessPath} class={`${className} ${compact ? "btn-sm" : ""}`}>
      {accessLabel}
    </Link>
  </span>
{:else if $pubkey}
  <Button type="button" class={className} disabled title={reason}>
    {hasForm ? "Request access" : "Access unavailable"}
  </Button>
{:else}
  <Button type="button" class={className} title={reason} onclick={login}>
    {compact ? "Log in" : `Log in to ${action}`}
  </Button>
{/if}
