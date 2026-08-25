import {describe, expect, it, vi} from "vitest"
import {
  scheduleNotificationBackgroundAdmission,
  scheduleNotificationBackgroundStages,
} from "./notification-background"

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

  it("stages background services and defers the next stage after input", () => {
    vi.useFakeTimers()
    const idleCallbacks: IdleRequestCallback[] = []
    const listeners = new Map<string, EventListener>()
    const stages = [vi.fn(), vi.fn(), vi.fn()]
    const target = {
      requestIdleCallback: vi.fn((callback: IdleRequestCallback) => {
        idleCallbacks.push(callback)
        return idleCallbacks.length
      }),
      cancelIdleCallback: vi.fn(),
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      addEventListener: vi.fn((type: string, listener: EventListener) =>
        listeners.set(type, listener),
      ),
      removeEventListener: vi.fn((type: string) => listeners.delete(type)),
    } as unknown as Window & {
      requestIdleCallback: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
      cancelIdleCallback: (handle: number) => void
    }

    const cancel = scheduleNotificationBackgroundStages(stages, {
      target,
      stageDelayMs: 100,
    })
    expect(stages[0]).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(100)
    expect(idleCallbacks).toHaveLength(1)
    listeners.get("pointerdown")?.(new Event("pointerdown"))
    idleCallbacks.shift()?.({didTimeout: false, timeRemaining: () => 10})
    expect(stages[1]).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    idleCallbacks.shift()?.({didTimeout: false, timeRemaining: () => 10})
    expect(stages[1]).toHaveBeenCalledTimes(1)
    cancel()
    vi.advanceTimersByTime(1_000)
    expect(stages[2]).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
