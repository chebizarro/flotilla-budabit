import {randomId, sleep} from "@welshman/lib"
export {preventDefault, stopPropagation} from "svelte/legacy"

const INTERACTIVE_CARD_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "textarea",
  "select",
  "summary",
  "label",
  "[role='button']",
  "[role='link']",
  "[contenteditable='true']",
  "[data-stop-link]",
  "[data-stop-tap]",
].join(", ")

export const getInteractiveCardTarget = (
  target: EventTarget | null,
  currentTarget?: EventTarget | null,
): HTMLElement | null => {
  const element =
    target instanceof Element ? target : target instanceof Node ? target.parentElement : null
  const interactive = element?.closest(INTERACTIVE_CARD_SELECTOR) as HTMLElement | null

  if (!interactive || interactive === currentTarget) {
    return null
  }

  return interactive
}

export const copyToClipboard = (text: string) => {
  const {activeElement} = document
  const input = document.createElement("textarea")

  try {
    input.innerHTML = text
    document.body.appendChild(input)
    input.select()

    const result = document.execCommand("copy")

    document.body.removeChild(input)

    // Only focus if activeElement exists and has a focus method
    if (activeElement && typeof (activeElement as HTMLElement).focus === "function") {
      ;(activeElement as HTMLElement).focus()
    }

    return result
  } catch (error) {
    // Clean up input if it was added to the DOM
    if (input.parentNode) {
      document.body.removeChild(input)
    }
    console.error("Failed to copy to clipboard:", error)
    return false
  }
}

export type ScrollerOpts = {
  onScroll: () => any
  element: Element
  threshold?: number
  reverse?: boolean
  delay?: number
}

export type Scroller = {
  check: () => Promise<void>
  stop: () => void
}

export const createScroller = ({
  onScroll,
  element,
  delay = 1000,
  threshold = 2000,
  reverse = false,
}: ScrollerOpts) => {
  let done = false

  const container = element.classList.contains("scroll-container")
    ? element
    : element.closest(".scroll-container")

  const check = async () => {
    if (container) {
      // While we have empty space, fill it
      const scrollHeight = container.scrollHeight
      const viewportHeight = container.clientHeight || window.innerHeight
      const offset = Math.abs(container.scrollTop)
      const shouldLoad = reverse
        ? offset <= threshold
        : offset + viewportHeight + threshold > scrollHeight

      // Only trigger loading the first time we reach the threshold
      if (shouldLoad) {
        await onScroll()
      }
    }

    // No need to check all that often
    await sleep(delay)

    if (!done) {
      requestAnimationFrame(check)
    }
  }

  requestAnimationFrame(check)

  return {
    check,
    stop: () => {
      done = true
    },
  }
}

export const isMobile =
  typeof window !== "undefined" &&
  ("ontouchstart" in document.documentElement ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia?.("(pointer: coarse)")?.matches)

export const isAndroid = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent)

export const downloadText = (filename: string, text: string, type = "text/plain") => {
  const blob = new Blob([text], {type})
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")

  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // WebKit may start Blob downloads asynchronously, especially on iOS.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const isIntersecting = async (element: Element) =>
  new Promise(resolve => {
    const observer = new IntersectionObserver(xs => {
      resolve(xs.some(x => x.isIntersecting))
      observer.unobserve(element)
    })

    observer.observe(element)
  })

const eventHighlightTimeouts = new WeakMap<Element, ReturnType<typeof setTimeout>>()
type PendingEventScroll = {
  controller: AbortController
  consumers: number
  promise: Promise<boolean>
}
const pendingEventScrolls = new WeakMap<HTMLElement, Map<string, PendingEventScroll>>()

const getEventSelector = (id: string) => {
  const escaped = typeof CSS === "undefined" ? id.replace(/["\\]/g, "\\$&") : CSS.escape(id)

  return `[data-event="${escaped}"]`
}

export const getEventElement = (id: string, root: ParentNode = document) =>
  root.querySelector(getEventSelector(id)) as HTMLElement | null

const highlightEventElement = (element: HTMLElement) => {
  if (!element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1")
  element.focus({preventScroll: true})
  element.classList.remove("event-target-highlight")
  // Restart the animation when the same quote is opened repeatedly.
  void element.offsetWidth
  element.classList.add("event-target-highlight")

  const previousTimeout = eventHighlightTimeouts.get(element)
  if (previousTimeout) clearTimeout(previousTimeout)

  const timeout = setTimeout(() => {
    element.classList.remove("event-target-highlight")
    eventHighlightTimeouts.delete(element)
  }, 2000)
  eventHighlightTimeouts.set(element, timeout)
}

export const scrollToEventNow = (
  id: string,
  root: ParentNode = document,
  behavior: ScrollBehavior = "smooth",
): boolean => {
  const element = getEventElement(id, root)
  if (!element) return false

  highlightEventElement(element)
  element.scrollIntoView({behavior, block: "start"})

  return true
}

const waitForAnimationFrame = () =>
  new Promise<void>(resolve => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve())
    } else {
      setTimeout(resolve, 0)
    }
  })

const scrollToSettledEvent = (
  id: string,
  {
    root,
    behavior,
    settleFrames,
    signal,
  }: {
    root: ParentNode
    behavior: ScrollBehavior
    settleFrames: number
    signal?: AbortSignal
  },
) => {
  const element = getEventElement(id, root)
  if (!element) return Promise.resolve(false)
  if (signal?.aborted) return Promise.resolve(false)

  const pendingKey = `${behavior}:${settleFrames}`
  let pendingByOptions = pendingEventScrolls.get(element)
  let pending = pendingByOptions?.get(pendingKey)

  if (pending?.controller.signal.aborted) {
    pendingByOptions?.delete(pendingKey)
    pending = undefined
  }

  if (!pending) {
    const controller = new AbortController()
    const scroll = (async () => {
      for (let frame = 0; frame < settleFrames; frame += 1) {
        await waitForAnimationFrame()
        if (controller.signal.aborted) return false
      }

      return scrollToEventNow(id, root, behavior)
    })()
    pending = {controller, consumers: 0, promise: scroll}
    pendingByOptions ||= new Map()
    pendingByOptions.set(pendingKey, pending)
    pendingEventScrolls.set(element, pendingByOptions)

    void scroll.finally(() => {
      const current = pendingEventScrolls.get(element)
      if (!current || current.get(pendingKey) !== pending) return

      current.delete(pendingKey)
      if (current.size === 0) pendingEventScrolls.delete(element)
    })
  }

  pending.consumers += 1

  return new Promise<boolean>(resolve => {
    let settled = false

    const finish = (result: boolean) => {
      if (settled) return
      settled = true
      signal?.removeEventListener("abort", onAbort)
      pending.consumers -= 1
      if (pending.consumers === 0) pending.controller.abort()
      resolve(result)
    }
    const onAbort = () => finish(false)

    signal?.addEventListener("abort", onAbort, {once: true})
    void pending.promise.then(result => finish(signal?.aborted ? false : result))
  })
}

export const waitAndScrollToEvent = (
  id: string,
  {
    root = document,
    timeoutMs = 10_000,
    signal,
    behavior = "smooth",
    settleFrames = 2,
  }: {
    root?: ParentNode
    timeoutMs?: number
    signal?: AbortSignal
    behavior?: ScrollBehavior
    settleFrames?: number
  } = {},
): Promise<boolean> => {
  if (signal?.aborted || timeoutMs <= 0) return Promise.resolve(false)

  return new Promise<boolean>(resolve => {
    let settled = false
    const observerRoot = root instanceof Document ? root.documentElement : root
    const requestController = new AbortController()

    const finish = (result: boolean) => {
      if (settled) return
      settled = true
      observer.disconnect()
      clearTimeout(timeout)
      signal?.removeEventListener("abort", onAbort)
      requestController.abort()
      resolve(result)
    }
    const onAbort = () => finish(false)
    const tryScroll = () => {
      if (!getEventElement(id, root)) return

      observer.disconnect()
      void scrollToSettledEvent(id, {
        root,
        behavior,
        settleFrames,
        signal: requestController.signal,
      }).then(finish)
    }
    const observer = new MutationObserver(tryScroll)
    const timeout = setTimeout(() => finish(false), timeoutMs)

    signal?.addEventListener("abort", onAbort, {once: true})
    if (getEventElement(id, root)) {
      tryScroll()
    } else {
      observer.observe(observerRoot, {attributes: true, childList: true, subtree: true})
    }
  })
}

export const scrollToEvent = (id: string): Promise<boolean> => waitAndScrollToEvent(id)

export const compressFile = async (
  file: File | Blob,
  options: Record<string, any> = {},
): Promise<File> => {
  const {default: Compressor} = await import("compressorjs")

  return new Promise<File>((resolve, _reject) => {
    new Compressor(file, {
      maxWidth: 2048,
      maxHeight: 2048,
      convertSize: 10 * 1024 * 1024,
      ...options,
      success: result => resolve(result as File),
      error: e => {
        // Non-images break compressor, return the original file
        if (e.toString().includes("File or Blob")) {
          if (file instanceof Blob) {
            file = new File([file], `${randomId()}.${file.type}`, {type: file.type})
          }

          return resolve(file as File)
        }

        _reject(e)
      },
    })
  })
}
