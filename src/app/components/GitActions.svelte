<script lang="ts">
  import {load} from "@welshman/net"
  import {
    Address,
    GIT_ISSUE,
    GIT_STATUS_CLOSED,
    GIT_STATUS_COMPLETE,
    GIT_STATUS_DRAFT,
    GIT_STATUS_OPEN,
    type Filter,
    type TrustedEvent,
  } from "@welshman/util"
  import {pubkey} from "@welshman/app"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import ThunkStatusOrDeleted from "@app/components/ThunkStatusOrDeleted.svelte"
  import EventActions from "@app/components/EventActions.svelte"
  import {publishDelete, publishReaction} from "@app/commands"
  import {makeGitPath} from "@app/routes"
  import Button from "@src/lib/components/Button.svelte"
  import Link from "@src/lib/components/Link.svelte"
  import {nthEq} from "@welshman/lib"
  import {onMount, tick} from "svelte"
  import {nip19} from "nostr-tools"
  import Spinner from "@src/lib/components/Spinner.svelte"

  interface Props {
    url: any
    event: TrustedEvent
    showIssues?: boolean
    showActivity?: boolean
  }

  const {url, event, showIssues = true, showActivity}: Props = $props()

  const repoNpub = $derived(nip19.npubEncode(event.pubkey))
  const repoDtag = $derived(event.tags.find(nthEq(0, "d"))?.[1])

  const gitworkshopLink = $derived(`https://gitworkshop.dev/${repoNpub}/${repoDtag}`)

  let issues: TrustedEvent[] = []
  const issueFilter: Filter = {kinds: [GIT_ISSUE]}
  let issueCount = $state(0)

  const onReactionClick = (content: string, events: TrustedEvent[]) => {
    const reaction = events.find(e => e.pubkey === $pubkey)
    if (reaction) {
      publishDelete({relays: [url], event: reaction})
    } else {
      publishReaction({event, content, relays: [url]})
    }
  }

  let loadingIssues = $state(false)
  const loadIssuesAndStatuses = async () => {
    loadingIssues = true
    await tick()
    const address = Address.fromEvent(event)
    issueFilter["#a"] = [address.toString()]
    const [tagId, ...relays] = event.tags.find(nthEq(0, "relays")) || []

    issues = await load({
      relays: relays,
      filters: [issueFilter],
    })

    loadingIssues = false

    const statusFilter = [
      {
        kinds: [GIT_STATUS_OPEN, GIT_STATUS_COMPLETE, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT],
        "#e": issues.map(issue => issue.id),
      },
    ]

    issueCount = issues.length

    // No need to await this one, justawait pre-loading
    const statuses = load({
      relays: relays,
      filters: statusFilter,
    })
  }

  onMount(() => {
    if (showIssues) {
      loadIssuesAndStatuses()
    }
  })

  // This might be broken depending on repo owners updating their links or
  // even including one in the first place
  // const web = event.tags.find(nthEq(0, "web"))?.[1]
</script>

<div class="flex flex-wrap items-center justify-between gap-2">
  <div class="flex flex-grow flex-wrap justify-end gap-2">
    <Button class="btn btn-primary btn-sm" disabled={!gitworkshopLink}>
      <Link external class="w-full cursor-pointer" href={gitworkshopLink}>
        <span class="">Browse</span>
      </Link>
    </Button>
    {#if showIssues}
      <Button class="btn btn-secondary btn-sm">
        <Link
          class="flex h-full w-full cursor-pointer items-center"
          href={makeGitPath(url, Address.fromEvent(event).toNaddr())}>
          <Spinner loading={loadingIssues} minHeight={"min-h-6"}>
            <span class="">{"Issues(" + issueCount + ")"}</span>
          </Spinner>
        </Link>
      </Button>
    {/if}

    {#if showActivity}
      <ReactionSummary {url} {event} {onReactionClick} reactionClass="tooltip-left" />
      <ThunkStatusOrDeleted {event} />
      <EventActions {url} {event} noun="Repo" />
    {/if}
  </div>
</div>
