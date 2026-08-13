import {describe, expect, it, vi} from "vitest"
import {
  getNotificationNavigationKey,
  isExternalNotificationPath,
  navigateNotificationTarget,
  type NotificationNavigationDependencies,
} from "./notification-navigation"

const deferred = () => {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return {promise, resolve, reject}
}

const makeDependencies = (
  overrides: Partial<NotificationNavigationDependencies> = {},
): NotificationNavigationDependencies => ({
  goto: vi.fn().mockResolvedValue(undefined),
  goToEventIdPath: vi.fn().mockResolvedValue(undefined),
  openExternal: vi.fn(),
  waitForIntentPaint: vi.fn().mockResolvedValue(undefined),
  scrollToTop: vi.fn().mockResolvedValue(undefined),
  retainModal: vi.fn(() => vi.fn()),
  clearModals: vi.fn(),
  ...overrides,
})

describe("notification navigation", () => {
  it("keeps the modal open until plain route navigation completes", async () => {
    const navigation = deferred()
    const releaseModal = vi.fn()
    const dependencies = makeDependencies({
      goto: vi.fn(() => navigation.promise),
      retainModal: vi.fn(() => releaseModal),
    })

    const result = navigateNotificationTarget({path: "/settings/extensions"}, dependencies)
    await vi.waitFor(() => expect(dependencies.goto).toHaveBeenCalledWith("/settings/extensions"))

    expect(dependencies.clearModals).not.toHaveBeenCalled()
    expect(releaseModal).not.toHaveBeenCalled()

    navigation.resolve()
    await expect(result).resolves.toBe(true)
    expect(dependencies.scrollToTop).toHaveBeenCalledOnce()
    expect(dependencies.clearModals).toHaveBeenCalledOnce()
    expect(releaseModal).toHaveBeenCalledOnce()
  })

  it("keeps the modal open until event navigation completes", async () => {
    const navigation = deferred()
    const dependencies = makeDependencies({
      goToEventIdPath: vi.fn(() => navigation.promise),
    })

    const result = navigateNotificationTarget(
      {path: "/git/repo/issues/issue", eventId: "issue"},
      dependencies,
    )
    await vi.waitFor(() =>
      expect(dependencies.goToEventIdPath).toHaveBeenCalledWith("issue", "/git/repo/issues/issue"),
    )

    expect(dependencies.clearModals).not.toHaveBeenCalled()
    navigation.resolve()
    await expect(result).resolves.toBe(true)
    expect(dependencies.scrollToTop).toHaveBeenCalledOnce()
    expect(dependencies.clearModals).toHaveBeenCalledOnce()
  })

  it("keeps the modal open until the destination is scrolled to the top", async () => {
    const scroll = deferred()
    const dependencies = makeDependencies({scrollToTop: vi.fn(() => scroll.promise)})

    const result = navigateNotificationTarget({path: "/c/community/threads"}, dependencies)
    await vi.waitFor(() => expect(dependencies.scrollToTop).toHaveBeenCalledOnce())

    expect(dependencies.clearModals).not.toHaveBeenCalled()
    scroll.resolve()
    await expect(result).resolves.toBe(true)
    expect(dependencies.clearModals).toHaveBeenCalledOnce()
  })

  it("shows pending intent before dismissing after an external handoff", async () => {
    const paint = deferred()
    const dependencies = makeDependencies({waitForIntentPaint: vi.fn(() => paint.promise)})

    const result = navigateNotificationTarget({path: "https://example.com/activity"}, dependencies)

    expect(dependencies.openExternal).toHaveBeenCalledWith("https://example.com/activity")
    expect(dependencies.clearModals).not.toHaveBeenCalled()
    paint.resolve()
    await expect(result).resolves.toBe(true)
    expect(dependencies.scrollToTop).not.toHaveBeenCalled()
    expect(dependencies.clearModals).toHaveBeenCalledOnce()
  })

  it("retains the modal after failed navigation and releases its close guard", async () => {
    const failure = new Error("navigation failed")
    const releaseModal = vi.fn()
    const dependencies = makeDependencies({
      goto: vi.fn().mockRejectedValue(failure),
      retainModal: vi.fn(() => releaseModal),
    })

    await expect(
      navigateNotificationTarget({path: "/settings/extensions"}, dependencies),
    ).rejects.toBe(failure)
    expect(dependencies.clearModals).not.toHaveBeenCalled()
    expect(releaseModal).toHaveBeenCalledOnce()
  })

  it("classifies navigation targets and keys consistently", () => {
    expect(isExternalNotificationPath("https://example.com")).toBe(true)
    expect(isExternalNotificationPath("mailto:help@example.com")).toBe(true)
    expect(isExternalNotificationPath("/git/repo")).toBe(false)
    expect(getNotificationNavigationKey({path: "/chat/alice", eventId: "message"})).toBe(
      "/chat/alice:message",
    )
  })
})
