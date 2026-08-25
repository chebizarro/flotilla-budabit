import {writable} from "svelte/store"

export const notificationBackgroundEnabled = writable(false)

export const setNotificationBackgroundEnabled = (enabled: boolean) =>
  notificationBackgroundEnabled.set(enabled)

type AdmissionWindow = Window & {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
  cancelIdleCallback?: (handle: number) => void
}

export const scheduleNotificationBackgroundAdmission = (
  start: () => void,
  {
    target = window as AdmissionWindow,
    idleTimeoutMs = 4_000,
  }: {target?: AdmissionWindow; idleTimeoutMs?: number} = {},
) => {
  let cancelled = false
  let firstFrame = 0
  let secondFrame = 0
  let idleHandle = 0
  let fallbackTimer = 0

  const admit = () => {
    if (!cancelled) start()
  }
  firstFrame = target.requestAnimationFrame(() => {
    secondFrame = target.requestAnimationFrame(() => {
      if (cancelled) return
      if (target.requestIdleCallback) {
        idleHandle = target.requestIdleCallback(admit, {timeout: idleTimeoutMs})
      } else {
        fallbackTimer = target.setTimeout(admit, 0)
      }
    })
  })

  return () => {
    cancelled = true
    if (firstFrame) target.cancelAnimationFrame(firstFrame)
    if (secondFrame) target.cancelAnimationFrame(secondFrame)
    if (idleHandle) target.cancelIdleCallback?.(idleHandle)
    if (fallbackTimer) target.clearTimeout(fallbackTimer)
  }
}
