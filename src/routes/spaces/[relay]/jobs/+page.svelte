<script lang="ts">
  import {decodeRelay, deriveEventsForUrl, getEventsForUrl} from "@src/app/state"
  import {FREELANCE_JOB} from "@src/lib/util"
  import {COMMENT, getListTags, getPubkeyTagValues, type TrustedEvent} from "@welshman/util"
  import {onMount} from "svelte"
  import {page} from "$app/state"
  import {derived, readable, type Readable} from "svelte/store"
  import {setChecked} from "@src/app/notifications"
  import PageBar from "@src/lib/components/PageBar.svelte"
  import Icon from "@src/lib/components/Icon.svelte"
  import MenuSpaceButton from "@src/app/components/MenuSpaceButton.svelte"
  import Button from "@src/lib/components/Button.svelte"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import JobItem from "@src/app/components/JobItem.svelte"
  import {fly} from "@src/lib/transition"
  import Link from "@src/lib/components/Link.svelte"
  import {makeFeed} from "@src/app/requests"
  import PageContent from "@src/lib/components/PageContent.svelte"
  import {userMutes} from "@welshman/app"

  const url = decodeRelay(page.params.relay)
  const mutedPubkeys = getPubkeyTagValues(getListTags($userMutes))
  const jobs: TrustedEvent[] = $state([])
  const comments: TrustedEvent[] = $state([])

  let element: HTMLElement | undefined = $state()
  let loading = $state(true)
  const limit = 20

  onMount(() => {
    const {cleanup} = makeFeed({
      element: element!,
      relays: [url],
      feedFilters: [{kinds: [FREELANCE_JOB]}],
      subscriptionFilters: [
        {kinds: [FREELANCE_JOB]},
        {kinds: [COMMENT], "#K": [String(FREELANCE_JOB)]},
      ],
      initialEvents: getEventsForUrl(url, [{kinds: [FREELANCE_JOB], limit}]),
      onEvent: event => {
        if (event.kind === FREELANCE_JOB) {
          jobs.push(event)
        }

        if (event.kind === COMMENT) {
          comments.push(event)
        }
      },
      onExhausted: () => {
        loading = false
      },
    })

    return () => {
      cleanup()
      setChecked(page.url.pathname)
    }
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center">
      <Icon icon="jobs" />
    </div>
  {/snippet}
  {#snippet title()}
    <strong>Jobs</strong>
  {/snippet}
  {#snippet action()}
    <div class="row-2">
      <Button class="btn btn-primary btn-sm">
        <Link
          external
          href="https://test.satshoot.com/post-job"
          class="flex items-center gap-x-2 bg-primary">
          <Icon icon="jobs" />
          <span class="">Create Job</span>
        </Link>
      </Button>
      <MenuSpaceButton {url} />
    </div>
  {/snippet}
</PageBar>

<PageContent bind:element class="flex flex-col gap-2 p-2 pt-4">
  {#each jobs as event (event.id)}
    <div class={"job-event" + event.id} in:fly>
      <JobItem
        {url}
        {event}
        showComment={true}
        showExternal={true}
        showThreadAction={true}
        showActivity={true} />
    </div>
  {/each}
  <p class="flex h-10 items-center justify-center py-20" out:fly>
    <Spinner {loading}>
      {#if loading}
        Looking for jobs...
      {:else if jobs.length === 0}
        No Jobs found.
      {/if}
    </Spinner>
  </p>
</PageContent>
