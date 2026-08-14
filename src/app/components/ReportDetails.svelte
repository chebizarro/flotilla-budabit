<script lang="ts">
  import {REPORT, getReplyFilters} from "@welshman/util"
  import type {Filter, TrustedEvent} from "@welshman/util"
  import {deriveEventsById} from "@welshman/store"
  import {repository} from "@welshman/app"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import Button from "@lib/components/Button.svelte"
  import ReportItem from "@app/components/ReportItem.svelte"
  import {normalizePubkey} from "@app/core/community"
  import {
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityPubkey,
    activeCommunityReportState,
  } from "@app/core/community-state"
  import {
    COMMUNITY_WRITE_TARGETS,
    getCommunityTargetWriterPubkeys,
  } from "@app/core/community-permissions"

  type Props = {
    url: string
    event: TrustedEvent
    scopeH?: string
    allowedAuthors?: string[]
  }

  const {url, event, scopeH = "", allowedAuthors = undefined}: Props = $props()
  const activeCommunityReportAuthors = $derived.by(() => {
    const scope = normalizePubkey(scopeH)
    const definition = $activeCommunityDefinition
    if (
      !scope ||
      scope !== normalizePubkey($activeCommunityPubkey || "") ||
      scope !== normalizePubkey(definition?.pubkey || "") ||
      !definition
    ) {
      return undefined
    }

    return getCommunityTargetWriterPubkeys({
      definition,
      profileListEvents: $activeCommunityProfileListEvents,
      target: COMMUNITY_WRITE_TARGETS.report,
      reportState: $activeCommunityReportState,
    })
  })
  const effectiveAllowedAuthors = $derived(activeCommunityReportAuthors ?? allowedAuthors)
  const reportFilters = $derived.by(() =>
    (getReplyFilters([event], {kinds: [REPORT]}) as Filter[]).map(filter => ({
      ...filter,
      ...(scopeH ? {"#h": [scopeH]} : {}),
      ...(effectiveAllowedAuthors ? {authors: effectiveAllowedAuthors} : {}),
    })),
  )

  const reports = $derived(deriveEventsById({repository, filters: reportFilters}))

  const back = () => history.back()

  const onDelete = () => {
    if ($reports.size === 0) {
      back()
    }
  }
</script>

<div class="column gap-4">
  <ModalHeader>
    {#snippet title()}
      <div>Report Details</div>
    {/snippet}
    {#snippet info()}
      <div>All reports for this event are shown below.</div>
    {/snippet}
  </ModalHeader>
  {#each $reports.values() as report (report.id)}
    <div class="card2 card2-sm bg-alt">
      <ReportItem {url} event={report} {onDelete} />
    </div>
  {/each}
  <Button class="btn btn-primary" onclick={back}>Got it</Button>
</div>
