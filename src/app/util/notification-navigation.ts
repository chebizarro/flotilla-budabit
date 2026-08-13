export type NotificationNavigationTarget = {
  path?: string
  eventId?: string
}

export type NotificationNavigationDependencies = {
  goto: (path: string) => Promise<unknown>
  goToEventIdPath: (eventId: string, path: string) => Promise<unknown>
  openExternal: (path: string) => void
  waitForIntentPaint: () => Promise<void>
  scrollToTop: () => Promise<void>
  retainModal: () => () => void
  clearModals: () => void
}

export const isExternalNotificationPath = (path: string) =>
  /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(path)

export const getNotificationNavigationKey = (target: NotificationNavigationTarget) =>
  `${target.path || ""}:${target.eventId || ""}`

export const navigateNotificationTarget = async (
  target: NotificationNavigationTarget,
  dependencies: NotificationNavigationDependencies,
) => {
  if (!target.path) return false

  const releaseModal = dependencies.retainModal()

  try {
    if (isExternalNotificationPath(target.path)) {
      // Keep this synchronous so browsers retain the originating user gesture.
      dependencies.openExternal(target.path)
      await dependencies.waitForIntentPaint()
    } else {
      await dependencies.waitForIntentPaint()
      if (target.eventId) {
        await dependencies.goToEventIdPath(target.eventId, target.path)
      } else {
        await dependencies.goto(target.path)
      }

      await dependencies.scrollToTop()
    }

    dependencies.clearModals()
    return true
  } finally {
    releaseModal()
  }
}
