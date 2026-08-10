import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("publication recovery source contracts", () => {
  it("keeps recovery globally accessible after toast dismissal", () => {
    const observer = readProjectFile("../components/PublicationRecoveryObserver.svelte")
    const list = readProjectFile("../components/PublicationRecoveryList.svelte")

    expect(observer).toContain("PublicationRecoveryList")
    expect(observer).toContain("recoverableOperations.length")
    expect(list).toContain("cancelPublication")
    expect(list).toContain("retryPublication")
    expect(list).toContain("discardPublication")
    expect(list).toContain("Discard local copy")
    expect(list).toContain("Discard retry")
  })

  it("offers discard without treating notification dismissal as discard", () => {
    const toast = readProjectFile("../components/PublicationRecoveryToast.svelte")
    const renderer = readProjectFile("../components/Toast.svelte")

    expect(toast).toContain("discardPublication(operationId)")
    expect(toast).toContain("does not retract")
    expect(renderer).toContain("popToast(item.id)")
    expect(renderer).not.toContain("discardPublication")
  })

  it("surfaces operation capacity errors at reaction and governance boundaries", () => {
    const commands = readProjectFile("./commands.ts")
    const community = readProjectFile("../../routes/c/[community]/+page.svelte")

    expect(commands).toContain("error instanceof PublicationCapacityError")
    expect(commands).toContain('pushToast({theme: "error", message: error.message})')
    expect(community).toContain("let startError: unknown")
    expect(community).toContain("if (started > 0) history.back()")
  })
})
