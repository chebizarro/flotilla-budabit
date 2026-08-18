<script lang="ts">
  import type {CommunityPointer} from "@app/core/community"
  import {activeExactCommunityDefinition} from "@app/core/community-state"
  import {
    makeExactCommunityCalendarPath,
    makeExactCommunityGitPath,
    makeExactCommunityGoalPath,
    makeExactCommunityPath,
    makeExactCommunityRoomPath,
    makeExactCommunityThreadPath,
  } from "@app/util/routes"

  type Props = {community: CommunityPointer}
  const {community}: Props = $props()

  const name = $derived($activeExactCommunityDefinition?.metadata.name || "Community")
  const links = $derived([
    {label: "Home", href: makeExactCommunityPath(community)},
    {label: "Threads", href: makeExactCommunityThreadPath(community)},
    {label: "Rooms", href: makeExactCommunityRoomPath(community, "")},
    {label: "Calendar", href: makeExactCommunityCalendarPath(community)},
    {label: "Goals", href: makeExactCommunityGoalPath(community)},
    {label: "Git", href: makeExactCommunityGitPath(community)},
  ])
</script>

<nav class="flex min-w-0 flex-col gap-1" aria-label={`${name} community`}>
  <p class="truncate px-3 py-2 text-sm font-semibold">{name}</p>
  {#each links as link}
    <a class="btn btn-ghost justify-start" href={link.href}>{link.label}</a>
  {/each}
</nav>
