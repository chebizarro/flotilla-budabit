import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("community targeted publication routes", () => {
  const routes = {
    calendar: readProjectFile("../../routes/c/[community]/calendar/+page.svelte"),
    calendarDetail: readProjectFile("../../routes/c/[community]/calendar/[event]/+page.svelte"),
    goals: readProjectFile("../../routes/c/[community]/goals/+page.svelte"),
    goalDetail: readProjectFile("../../routes/c/[community]/goals/[goal]/+page.svelte"),
    permalinks: readProjectFile("../../routes/c/[community]/permalinks/+page.svelte"),
  }

  it("admits only authorized community wrappers before building original plans", () => {
    for (const source of Object.values(routes)) {
      expect(source).toContain("filterAuthorizedCommunityTargetingEvents({")
      expect(source).toContain("makeTargetedPublicationOriginalFilterPlan(")
      expect(source).toContain("makeTargetedPublicationOriginalRelayHintPlans(")
      expect(source).toContain("targetingFilterPlan.localFilters")
      expect(source).not.toContain("makeTargetedPublicationOriginalFilters")
    }
  })

  it("separates list relay transport from local original admission", () => {
    expect(routes.calendar).toContain("relayFilters: calendarFeedRelayFilters")
    expect(routes.calendar).toContain("directCalendarFilterPlan.localFilters")
    expect(routes.calendar).toContain("targetedOriginalFilterPlan.localFilters")
    expect(routes.goals).toContain("relayFilters: goalFeedRelayFilters")
    expect(routes.goals).toContain("directGoalFilterPlan.localFilters")
    expect(routes.goals).toContain("targetedGoalFilterPlan.localFilters")
    expect(routes.permalinks).toContain("relayFilters: permalinkRelayFilters")
    expect(routes.permalinks).toContain("directPermalinkFilterPlan.localFilters")
    expect(routes.permalinks).toContain("targetedPermalinkFilterPlan.localFilters")
  })

  it("uses aggregate calendar writers for both direct events and wrappers", () => {
    for (const source of [routes.calendar, routes.calendarDetail]) {
      expect(source).toContain("getCommunityCalendarTargetWriterPubkeys({")
      expect(source).toContain("calendarWriterPubkeys")
      expect(source).not.toContain("calendarWriterPubkeysByKind")
    }
  })

  it("passes centrally authorized wrappers into layout follow-up discovery", () => {
    const layout = readProjectFile("../../routes/c/[community]/+layout.svelte")

    expect(layout).toContain("filterAuthorizedCommunityTargetingEvents({")
    expect(layout).toContain("targetingEvents: authorizedCommunityTargetingEvents")
    expect(layout.indexOf("filterAuthorizedCommunityTargetingEvents({")).toBeLessThan(
      layout.indexOf("buildCommunityFiniteFollowUpRelayPlans({"),
    )
  })

  it("uses bounded split-filter detail history without incomplete-history warnings", () => {
    expect(routes.calendarDetail).toContain("relayFilters: eventRelayFilters")
    expect(routes.calendarDetail).toContain("localFilters: eventFilters")
    expect(routes.calendarDetail).toContain("relayFilters: replyRelayFilters")
    expect(routes.calendarDetail).toContain("matchFilters(eventFilters, event)")
    expect(routes.goalDetail).toContain("relayFilters: goalRelayFilters")
    expect(routes.goalDetail).toContain("localFilters: goalFilters")
    expect(routes.goalDetail).toContain("relayFilters: replyRelayFilters")
    expect(routes.goalDetail).toContain("matchFilters(goalFilters, event)")

    for (const source of Object.values(routes)) {
      expect(source).toContain("loadBoundedCommunityHistory({")
      expect(source).not.toContain("history is incomplete")
      expect(source).not.toContain("lookup is incomplete")
      expect(source).not.toContain("may be missing")
    }
  })

  it("keeps ACL-derived author arrays out of route-owned wire filters", () => {
    for (const source of Object.values(routes)) {
      expect(source).not.toContain("authors:")
    }
  })

  it("loads explicit external originals through bounded normalized relay-hint plans", () => {
    for (const source of Object.values(routes)) {
      expect(source).toContain("RelayHintPlans")
      expect(source).toContain("loadBoundedCommunityHistory({")
      expect(source).toMatch(
        /plans\.map\(plan =>[\s\S]*loadBoundedCommunityHistory\(\{[\s\S]*\.\.\.plan/,
      )
    }
  })
})
