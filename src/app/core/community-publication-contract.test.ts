import {existsSync, readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("strict community publication source contracts", () => {
  it("uses definition-only relays in direct community route publishers", () => {
    const routes = [
      "../../routes/c/[community]/threads/create/+page.svelte",
      "../../routes/c/[community]/threads/[thread]/+page.svelte",
      "../../routes/c/[community]/rooms/[room]/+page.svelte",
      "../../routes/c/[community]/goals/create/+page.svelte",
      "../../routes/c/[community]/calendar/create/+page.svelte",
      "../../routes/c/[community]/calendar/[event]/+page.svelte",
      "../../routes/c/[community]/permalinks/+page.svelte",
      "../../routes/c/[community]/git/+page.svelte",
    ]

    for (const route of routes) {
      const source = readProjectFile(route)

      expect(source, route).toContain("const relays = $activeExactCommunityRelays")
    }

    expect(readProjectFile("../../routes/c/[community]/+page.svelte")).toContain(
      "const relays = routeCommunityDefinition?.relays || []",
    )
  })

  it("keeps read relays separate from action relays on community social surfaces", () => {
    const routes = [
      "../../routes/c/[community]/threads/+page.svelte",
      "../../routes/c/[community]/threads/[thread]/+page.svelte",
      "../../routes/c/[community]/rooms/[room]/+page.svelte",
      "../../routes/c/[community]/goals/+page.svelte",
      "../../routes/c/[community]/goals/[goal]/+page.svelte",
      "../../routes/c/[community]/calendar/+page.svelte",
      "../../routes/c/[community]/calendar/[event]/+page.svelte",
    ]

    for (const route of routes) {
      const source = readProjectFile(route)

      expect(source, route).toContain("$activeExactCommunityRelays")
      expect(source, route).toContain("$activeExactCommunityRelays")
    }
  })

  it("keeps pending room messages outside the canonical repository", () => {
    const room = readProjectFile("../../routes/c/[community]/rooms/[room]/+page.svelte")

    expect(room).toContain("startPublication({")
    expect(room).toContain('preview: "retain-on-failure"')
    expect(room).toContain("$publicationOperations.values()")
    expect(room).not.toContain("publishThunk({")
    expect(room).not.toContain("$thunks")
  })

  it("passes explicit relay arrays through report and delete menus", () => {
    const eventMenu = readProjectFile("../components/EventMenu.svelte")
    const report = readProjectFile("../components/Report.svelte")
    const threadActions = readProjectFile("../components/ThreadActions.svelte")
    const calendarActions = readProjectFile("../components/CalendarEventActions.svelte")

    expect(eventMenu).toContain("pushModal(Report, {url, event, relays, repoAddress})")
    expect(eventMenu).toContain(
      "pushModal(EventDeleteConfirm, {url, event, noun, relays, repoAddress})",
    )
    expect(report).toContain("const publishRelays = normalizeRelays(relays)")
    expect(threadActions).toContain(
      "publishReactionDeleteOperation({reaction, relays: actionRelays})",
    )
    expect(calendarActions).toContain(
      "publishReactionDeleteOperation({reaction, targetEvent: event, relays: reactionRelayTargets})",
    )
  })

  it("does not broaden stars, badges, or widgets beyond definition relays", () => {
    const star = readProjectFile("../components/community/CommunityStarButton.svelte")
    const badges = readProjectFile("../../routes/c/[community]/badges/+page.svelte")
    const badgeAward = readProjectFile("../components/CommunityBadgeAwardForm.svelte")
    const widgets = readProjectFile("../../routes/c/[community]/widgets/+page.svelte")
    const explore = readProjectFile("../../routes/explore/+page.svelte")

    expect(star).toContain(
      "publishRelayHints === undefined ? relays : normalizeRelays(publishRelayHints)",
    )
    expect(badges).toContain("relays: badgePublishRelays")
    expect(badgeAward).toContain("relays: badgePublishRelays")
    expect(widgets).toContain("const baseRelays: string[] = []")
    expect(widgets).not.toContain("SMART_WIDGET_RELAYS")
    expect(widgets).not.toContain("Router.get().FromUser()")
    expect(explore).toContain(
      "const previewPublishRelayHints = $derived(normalizeRelays(previewDefinition?.relays || []))",
    )
    expect(explore).toContain(
      "const defaultPublishRelayHints = $derived(normalizeRelays(defaultDefinition?.relays || []))",
    )
    expect(explore).toContain("publishRelayHints={item.publishRelayHints}")
  })

  it("publishes community repositories as direct single-community announcements", () => {
    const repositories = readProjectFile("../../routes/c/[community]/git/+page.svelte")

    expect(repositories).toContain('["h", communityId, relays[0]]')
    expect(repositories).toContain("publishThunk({relays: announcementRelays, event: repoEvent})")
    expect(repositories).not.toContain("TARGETED_PUBLICATION_KIND")
    expect(repositories).not.toContain("makeTargetedPublicationForCommunity")
  })

  it("keeps pending community stars outside the canonical repository", () => {
    const star = readProjectFile("../components/community/CommunityStarButton.svelte")

    expect(star).toContain("startPublication({")
    expect(star).toContain('preview: "rollback-on-failure"')
    expect(star).toContain("$publicationOperations.values()")
    expect(star).toContain("makeCommunityStarDelete(community, star.reaction.id)")
    expect(star).not.toContain("publishThunk({")
    expect(star).not.toContain("repository.publish(")
    expect(star).not.toContain("publishDelete(")
  })

  it("uses retained operations for authored thread and comment publications", () => {
    const publishers = [
      "../../routes/c/[community]/threads/create/+page.svelte",
      "../components/RepoActivityThreadCreate.svelte",
      "../../routes/c/[community]/threads/[thread]/+page.svelte",
      "../../routes/c/[community]/goals/[goal]/+page.svelte",
      "../../routes/c/[community]/calendar/[event]/+page.svelte",
      "../components/GoalCreate.svelte",
    ]

    for (const publisher of publishers) {
      const source = readProjectFile(publisher)

      expect(source, publisher).toContain("startPublication({")
      expect(source, publisher).toContain('preview: "retain-on-failure"')
      expect(source, publisher).not.toContain("publishThunk({")
      expect(source, publisher).not.toContain("signEventForPublication(")
    }

    const calendarForm = readProjectFile("../components/CalendarEventForm.svelte")
    expect(calendarForm).toContain("startPublication({")
    expect(calendarForm).toContain("validateRetry: assertReplaceablePublicationIsCurrent")
    expect(calendarForm).toContain("optimistic: false")
  })

  it("removes dormant unscoped thread launchers", () => {
    const composeMenu = readProjectFile("../components/ComposeMenu.svelte")

    expect(composeMenu).not.toContain("ThreadCreate")
    expect(composeMenu).not.toContain("Create Thread")
    expect(existsSync(new URL("../components/ThreadCreate.svelte", import.meta.url))).toBe(false)
    expect(existsSync(new URL("../components/GitIssueItem.svelte", import.meta.url))).toBe(false)
  })

  it("projects retained authored operations into thread, goal, and calendar routes", () => {
    const routes = [
      "../../routes/c/[community]/threads/+page.svelte",
      "../../routes/c/[community]/threads/[thread]/+page.svelte",
      "../../routes/c/[community]/goals/+page.svelte",
      "../../routes/c/[community]/goals/[goal]/+page.svelte",
      "../../routes/c/[community]/calendar/+page.svelte",
      "../../routes/c/[community]/calendar/[event]/+page.svelte",
    ]

    for (const route of routes) {
      const source = readProjectFile(route)
      expect(source, route).toContain("projectAuthoredPublicationEvents({")
      expect(source, route).toContain("$publicationOperations.values()")
    }

    const channelMessage = readProjectFile("../components/ChannelMessage.svelte")
    expect(channelMessage).toContain("<PublicationStatus {operationId}")
    expect(channelMessage).toContain("operationId ? undefined : $thunks.find")
  })

  it("registers independent governance publications without repository optimism", () => {
    const communityHome = readProjectFile("../../routes/c/[community]/+page.svelte")
    const reportCard = readProjectFile("../components/community/CommunityContentReportCard.svelte")

    expect(communityHome).toContain("getModeratorInviteResponseSemanticKey(")
    expect(communityHome).toContain("validateRetry: assertReplaceablePublicationIsCurrent")
    expect(communityHome).toContain("<PublicationStatus {operationId}")
    expect(communityHome).toContain("disabled={startableModeratorInvites.length === 0}")
    expect(communityHome).toContain('preview: "none"')
    expect(communityHome).not.toContain("publishThunk({")

    expect(reportCard).toContain("getReportReviewSemanticKey(")
    expect(reportCard).toContain("candidate.ownerPubkey === currentPubkey")
    expect(reportCard).toContain("<PublicationStatus {operationId}")
    expect(reportCard).toContain("startPublication({")
    expect(reportCard).toContain('preview: "none"')
    expect(reportCard).not.toContain("waitForThunkCompletion")
    expect(reportCard).not.toContain("repository.removeEvent")
    expect(reportCard).not.toContain("repository.publish(")
    expect(reportCard).not.toContain("publishThunk({")
  })

  it("hands direct compose goal and calendar events off to canonical community feeds", () => {
    const goals = readProjectFile("../../routes/c/[community]/goals/+page.svelte")
    const goal = readProjectFile("../../routes/c/[community]/goals/[goal]/+page.svelte")
    const calendar = readProjectFile("../../routes/c/[community]/calendar/+page.svelte")
    const calendarEvent = readProjectFile(
      "../../routes/c/[community]/calendar/[event]/+page.svelte",
    )

    expect(goals).toContain('"#h": [communityId]')
    expect(goal).toContain("directGoalFilterPlan.localFilters")
    expect(goal).toContain("matchFilters(goalFilters, event)")
    expect(calendar).toContain('"#h": [communityId]')
    expect(calendar).toContain("calendarProjection.events.toSorted(")
    expect(calendarEvent).toContain("directEventFilterPlan.localFilters")
    expect(calendarEvent).toContain("matchFilters(eventFilters, event)")
  })

  it("keeps dependent publications disabled until authored roots are canonical", () => {
    const thread = readProjectFile("../../routes/c/[community]/threads/[thread]/+page.svelte")
    const goal = readProjectFile("../../routes/c/[community]/goals/[goal]/+page.svelte")
    const calendar = readProjectFile("../../routes/c/[community]/calendar/[event]/+page.svelte")

    expect(thread).toContain("!threadOperationId &&")
    expect(thread).toContain("{#if !threadOperationId}")
    expect(goal).toContain("!goalOperationId &&")
    expect(goal).toContain("disableContributions={Boolean(goalOperationId)}")
    expect(goal).toContain("{#if !goalOperationId}")
    expect(calendar).toContain("!eventOperationId &&")
    expect(calendar).toContain("{#if !eventOperationId}")
  })
})
