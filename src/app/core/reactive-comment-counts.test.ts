import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const read = (path: string) => readFileSync(path, "utf8")
const activity = read("src/app/components/EventActivity.svelte")
const activityIO = read("src/app/core/event-activity-io.ts")
const issues = read("src/routes/git/[id=naddr]/issues/+page.svelte")
const prs = read("src/routes/git/[id=naddr]/prs/+page.svelte")

describe("reactive comment counts", () => {
  it("resubscribes activity counts when reactive filters change", () => {
    expect(activity).toContain("let replies = $state<TrustedEvent[]>([])")
    expect(activity).toContain(
      "const replyStore = deriveArray(deriveEventsById({repository, filters}))",
    )
    expect(activity).toContain("return replyStore.subscribe(events => (replies = events))")
    expect(activity).not.toContain("$derived(deriveArray(deriveEventsById")
  })

  it("counts root-thread and direct-child comment references", () => {
    expect(activity).toContain('{...rootFilter, "#E": [event.id]}')
    expect(activity).toContain('{...directReplyFilter, "#e": [event.id]}')
    expect(activity).toContain('"#k": [String(event.kind)]')
    expect(activity).toContain("[rootFilterPlan, directReplyFilterPlan].map")
    expect(activityIO).toContain('const ACTIVITY_TAGS = ["#E", "#e", "#A", "#a"]')
  })

  it("uses reactive stores for Git list comment counts", () => {
    expect(issues).toContain("getContext<Readable<CommentEvent[]>>(COMMENT_EVENTS_KEY)")
    expect(issues).toContain("filterVisibleAfterDeletesAndEdits(commentEvents, $editedTargetIds)")
    expect(issues).not.toContain("repoClass.getIssueThread(issue.id)")
    expect(prs).toContain("commentEventsStore ? $commentEventsStore : []")
  })

  it("keeps Calendar activity live because its route feed does not carry comments", () => {
    const calendar = read("src/routes/c/[community]/calendar/+page.svelte")
    const card = calendar.slice(
      calendar.indexOf("<CalendarEventItem"),
      calendar.indexOf("{event} />"),
    )

    expect(card).not.toContain("activityLiveCovered")
  })
})
