import {describe, expect, it, vi} from "vitest"
import {scheduleNotificationBackgroundAdmission} from "./notification-background"

describe("notification background admission", () => {
  it("waits for two frames and idle time", () => {
    const frames: FrameRequestCallback[] = []
    let idle: IdleRequestCallback | undefined
    const start = vi.fn()
    const target = {
      requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback)
        return frames.length
      }),
      cancelAnimationFrame: vi.fn(),
      requestIdleCallback: vi.fn((callback: IdleRequestCallback) => {
        idle = callback
        return 3
      }),
      cancelIdleCallback: vi.fn(),
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
    } as unknown as Window & {
      requestIdleCallback: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
      cancelIdleCallback: (handle: number) => void
    }

    scheduleNotificationBackgroundAdmission(start, {target})
    frames.shift()?.(0)
    expect(start).not.toHaveBeenCalled()
    frames.shift()?.(16)
    expect(start).not.toHaveBeenCalled()
    idle?.({didTimeout: false, timeRemaining: () => 10})
    expect(start).toHaveBeenCalledTimes(1)
  })

  it("cancels queued admission", () => {
    const frames: FrameRequestCallback[] = []
    const start = vi.fn()
    const target = {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        frames.push(callback)
        return frames.length
      },
      cancelAnimationFrame: vi.fn(),
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
    } as unknown as Window

    const cancel = scheduleNotificationBackgroundAdmission(start, {target})
    cancel()
    frames.forEach(callback => callback(0))
    expect(start).not.toHaveBeenCalled()
    expect(target.cancelAnimationFrame).toHaveBeenCalled()
  })
})
