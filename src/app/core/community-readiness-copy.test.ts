import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

const readinessUiFiles = [
  "../../routes/c/[community]/+page.svelte",
  "../../routes/c/[community]/access/+page.svelte",
  "../../routes/c/[community]/admin/+page.svelte",
  "../../routes/c/[community]/moderation/+page.svelte",
  "../../routes/c/[community]/calendar/+page.svelte",
  "../../routes/c/[community]/calendar/[event]/+page.svelte",
  "../../routes/c/[community]/calendar/create/+page.svelte",
  "../../routes/c/[community]/threads/+page.svelte",
  "../../routes/c/[community]/threads/[thread]/+page.svelte",
  "../../routes/c/[community]/threads/create/+page.svelte",
  "../../routes/c/[community]/goals/+page.svelte",
  "../../routes/c/[community]/goals/[goal]/+page.svelte",
  "../../routes/c/[community]/goals/create/+page.svelte",
  "../../routes/c/[community]/rooms/[room]/+page.svelte",
  "../../routes/c/[community]/git/+page.svelte",
  "../../routes/c/[community]/permalinks/+page.svelte",
  "../../routes/c/[community]/widgets/+page.svelte",
  "../components/CommunityMenu.svelte",
  "../components/community/CommunityRoomCreate.svelte",
  "../components/community/PublishGate.svelte",
]

describe("community readiness copy", () => {
  it("keeps permission lifecycle wording out of user-facing community states", () => {
    for (const path of readinessUiFiles) {
      const source = readProjectFile(path)

      expect(source, path).not.toMatch(/Loading community permissions/i)
      expect(source, path).not.toMatch(/Community permissions are (?:still loading|incomplete)/i)
      expect(source, path).not.toMatch(/Loading (?:room|comment|reply|widget) permissions/i)
    }
  })

  it("uses resource-specific loading and unavailable states", () => {
    expect(readProjectFile("../../routes/c/[community]/calendar/+page.svelte")).toContain(
      "Loading Calendar...",
    )
    expect(readProjectFile("../../routes/c/[community]/threads/+page.svelte")).toContain(
      "Threads unavailable.",
    )
    expect(readProjectFile("../../routes/c/[community]/goals/+page.svelte")).toContain(
      "Goals unavailable.",
    )
    expect(readProjectFile("../../routes/c/[community]/rooms/[room]/+page.svelte")).toContain(
      "Room unavailable.",
    )
  })
})
