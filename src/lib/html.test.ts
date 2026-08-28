// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {scrollToEventNow, waitAndScrollToEvent} from "./html"

describe("event scrolling", () => {
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    document.body.innerHTML = ""
    scrollIntoView.mockReset()
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("scrolls and highlights an existing event without replacing inline styles", () => {
    const element = document.createElement("div")
    let highlightedWhenScrolled = false
    element.dataset.event = "a".repeat(64)
    element.style.color = "red"
    scrollIntoView.mockImplementation(() => {
      highlightedWhenScrolled = element.classList.contains("event-target-highlight")
    })
    document.body.appendChild(element)

    expect(scrollToEventNow(element.dataset.event)).toBe(true)
    expect(scrollIntoView).toHaveBeenCalledWith({behavior: "smooth", block: "start"})
    expect(highlightedWhenScrolled).toBe(true)
    expect(element.classList.contains("event-target-highlight")).toBe(true)
    expect(document.activeElement).toBe(element)
    expect(element.style.color).toBe("red")
  })

  it("waits for an asynchronously rendered event", async () => {
    const id = "b".repeat(64)
    const result = waitAndScrollToEvent(id, {timeoutMs: 1_000})
    const element = document.createElement("div")
    element.dataset.event = id
    document.body.appendChild(element)

    await expect(result).resolves.toBe(true)
    expect(scrollIntoView).toHaveBeenCalledOnce()
  })

  it("scopes event lookup to the requested scroll container", () => {
    const id = "e".repeat(64)
    const outside = document.createElement("div")
    const root = document.createElement("div")
    const inside = document.createElement("div")
    const outsideScroll = vi.fn()
    const insideScroll = vi.fn()
    outside.dataset.event = id
    inside.dataset.event = id
    Object.defineProperty(outside, "scrollIntoView", {configurable: true, value: outsideScroll})
    Object.defineProperty(inside, "scrollIntoView", {configurable: true, value: insideScroll})
    root.appendChild(inside)
    document.body.append(outside, root)

    expect(scrollToEventNow(id, root, "auto")).toBe(true)
    expect(insideScroll).toHaveBeenCalledWith({behavior: "auto", block: "start"})
    expect(outsideScroll).not.toHaveBeenCalled()
  })

  it("coalesces reveal requests while message geometry settles", async () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback)
        return frames.length
      }),
    )
    const element = document.createElement("div")
    element.dataset.event = "f".repeat(64)
    document.body.appendChild(element)

    const first = waitAndScrollToEvent(element.dataset.event, {behavior: "auto"})
    const second = waitAndScrollToEvent(element.dataset.event, {behavior: "auto"})
    expect(scrollIntoView).not.toHaveBeenCalled()

    frames.shift()?.(0)
    await Promise.resolve()
    frames.shift()?.(16)

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(scrollIntoView).toHaveBeenCalledOnce()
    expect(scrollIntoView).toHaveBeenCalledWith({behavior: "auto", block: "start"})
  })

  it("lets one coalesced caller abort without cancelling another", async () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback)
        return frames.length
      }),
    )
    const element = document.createElement("div")
    element.dataset.event = "1".repeat(64)
    document.body.appendChild(element)
    const firstController = new AbortController()
    const secondController = new AbortController()

    const first = waitAndScrollToEvent(element.dataset.event, {
      behavior: "auto",
      signal: firstController.signal,
    })
    const second = waitAndScrollToEvent(element.dataset.event, {
      behavior: "auto",
      signal: secondController.signal,
    })
    firstController.abort()
    frames.shift()?.(0)
    await Promise.resolve()
    frames.shift()?.(16)

    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(true)
    expect(scrollIntoView).toHaveBeenCalledOnce()
  })

  it("does not scroll after a request times out during layout settling", async () => {
    vi.useFakeTimers()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback)
        return frames.length
      }),
    )
    const element = document.createElement("div")
    element.dataset.event = "2".repeat(64)
    document.body.appendChild(element)

    const result = waitAndScrollToEvent(element.dataset.event, {timeoutMs: 10})
    await vi.advanceTimersByTimeAsync(10)
    await expect(result).resolves.toBe(false)

    frames.shift()?.(0)
    await Promise.resolve()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it("starts a fresh reveal after an aborted pending request", async () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback)
        return frames.length
      }),
    )
    const element = document.createElement("div")
    element.dataset.event = "3".repeat(64)
    document.body.appendChild(element)
    const controller = new AbortController()

    const aborted = waitAndScrollToEvent(element.dataset.event, {signal: controller.signal})
    controller.abort()
    await expect(aborted).resolves.toBe(false)

    const retry = waitAndScrollToEvent(element.dataset.event)
    frames.shift()?.(0)
    await Promise.resolve()
    frames.shift()?.(0)
    await Promise.resolve()
    frames.shift()?.(16)

    await expect(retry).resolves.toBe(true)
    expect(scrollIntoView).toHaveBeenCalledOnce()
  })

  it("returns false when the target does not render before the timeout", async () => {
    vi.useFakeTimers()
    const result = waitAndScrollToEvent("c".repeat(64), {timeoutMs: 100})

    await vi.advanceTimersByTimeAsync(100)

    await expect(result).resolves.toBe(false)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it("stops waiting when aborted", async () => {
    const controller = new AbortController()
    const result = waitAndScrollToEvent("d".repeat(64), {signal: controller.signal})

    controller.abort()

    await expect(result).resolves.toBe(false)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
