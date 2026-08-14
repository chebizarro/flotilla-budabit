<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {getTagValue} from "@welshman/util"
  import Link from "@lib/components/Link.svelte"
  import CalendarEventActions from "@app/components/CalendarEventActions.svelte"
  import CalendarEventHeader from "@app/components/CalendarEventHeader.svelte"
  import PublicationStatus from "@app/components/PublicationStatus.svelte"
  import ModeratedContent from "@app/components/community/ModeratedContent.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import RoomLink from "@app/components/RoomLink.svelte"
  import {activeCommunityReportState} from "@app/core/community-state"
  import {
    getCommunityCensorReason,
    getCommunityReportEventAddress,
  } from "@app/core/community-reports"
  import {makeCalendarPath} from "@app/util/routes"

  type Props = {
    url: string
    event: TrustedEvent
    relays?: string[]
    publishRelays?: string[]
    reactionRelays?: string[]
    scopeH?: string
    communitySectionName?: string
    readOnly?: boolean
    allowedAuthors?: string[]
    reactionAllowedAuthors?: string[]
    reportAllowedAuthors?: string[]
    showRoom?: boolean
    activityLiveCovered?: boolean
    operationId?: string
  }

  const {
    url,
    event,
    relays = [],
    publishRelays = undefined,
    reactionRelays = undefined,
    scopeH = "",
    communitySectionName = "",
    readOnly = false,
    allowedAuthors,
    reactionAllowedAuthors,
    reportAllowedAuthors,
    showRoom = false,
    activityLiveCovered = false,
    operationId = undefined,
  }: Props = $props()

  const h = getTagValue("h", event.tags)
  const eventRouteParam = getTagValue("d", event.tags) || event.id
  const censorReason = $derived.by(() =>
    communitySectionName
      ? getCommunityCensorReason({
          reportState: $activeCommunityReportState,
          eventId: event.id,
          eventAddress: getCommunityReportEventAddress(event),
          pubkey: event.pubkey,
          sectionName: communitySectionName,
        })
      : undefined,
  )
</script>

<div data-event={event.id}>
  <Link
    class="col-3 card2 bg-alt w-full cursor-pointer shadow-md"
    href={makeCalendarPath(url, eventRouteParam)}>
    {#if censorReason}
      <ModeratedContent reason={censorReason} />
    {:else}
      <CalendarEventHeader {event} />
      {#if operationId}
        <PublicationStatus {operationId} class="text-sm" />
      {/if}
      <div class="flex w-full flex-col items-end justify-between gap-2 sm:flex-row">
        <span class="whitespace-nowrap py-1 text-sm opacity-75">
          Posted by <ProfileLink pubkey={event.pubkey} {relays} />
          {#if h && showRoom}
            in <RoomLink {url} {h} />
          {/if}
        </span>
        {#if !operationId}
          <CalendarEventActions
            showActivity
            {url}
            {relays}
            {publishRelays}
            {reactionRelays}
            {scopeH}
            {communitySectionName}
            {readOnly}
            {allowedAuthors}
            {reactionAllowedAuthors}
            {reportAllowedAuthors}
            {activityLiveCovered}
            {event} />
        {/if}
      </div>
    {/if}
  </Link>
</div>
