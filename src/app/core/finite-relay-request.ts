import {request as welshmanRequest, type RequestOptions} from "@welshman/net"
import type {Filter, TrustedEvent} from "@welshman/util"

export type FiniteRelayOutcome = "eose" | "timeout" | "closed" | "disconnect" | "aborted" | "error"

export type FiniteRelayResult = {
  relay: string
  outcome: FiniteRelayOutcome
  events: TrustedEvent[]
  queuedAt: number
  startedAt?: number
  finishedAt: number
  reason?: string
}

export type FiniteRelayRequestOptions = {
  relay: string
  filters: Filter[]
  timeoutMs: number
  signal?: AbortSignal
  priority?: number
  owner?: string
  onEvent?: (event: TrustedEvent, relay: string) => void
}

type Timer = ReturnType<typeof setTimeout>

export type FiniteRelayRequestDependencies = {
  request: (options: RequestOptions) => Promise<TrustedEvent[]>
  now?: () => number
  setTimer?: (callback: () => void, delay: number) => Timer
  clearTimer?: (timer: Timer) => void
}

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error || "Unknown request error")

export const createFiniteRelayRequester = (dependencies: FiniteRelayRequestDependencies) => {
  const now = dependencies.now || Date.now
  const setTimer = dependencies.setTimer || ((callback, delay) => setTimeout(callback, delay))
  const clearTimer = dependencies.clearTimer || (timer => clearTimeout(timer))

  return (options: FiniteRelayRequestOptions): Promise<FiniteRelayResult> => {
    const queuedAt = now()
    const eventsById = new Map<string, TrustedEvent>()
    const requestController = new AbortController()
    const signal = options.signal
      ? AbortSignal.any([options.signal, requestController.signal])
      : requestController.signal

    let outcome: FiniteRelayOutcome | undefined
    let reason: string | undefined
    let startedAt: number | undefined
    let timer: Timer | undefined
    let settled = false

    return new Promise(resolve => {
      const finish = (nextOutcome: FiniteRelayOutcome, nextReason?: string) => {
        if (settled) return
        settled = true
        outcome ||= nextOutcome
        reason ||= nextReason

        if (timer) clearTimer(timer)
        options.signal?.removeEventListener("abort", onCallerAbort)

        resolve({
          relay: options.relay,
          outcome,
          events: Array.from(eventsById.values()),
          queuedAt,
          startedAt,
          finishedAt: now(),
          ...(reason ? {reason} : {}),
        })
      }

      const abortAndFinish = (nextOutcome: "timeout" | "aborted", nextReason?: string) => {
        outcome ||= nextOutcome
        reason ||= nextReason
        requestController.abort()
        finish(outcome, reason)
      }

      function onCallerAbort() {
        abortAndFinish("aborted")
      }

      if (options.signal?.aborted) {
        finish("aborted")
        return
      }

      if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
        finish("error", "Finite relay timeout must be a positive number")
        return
      }

      if (!options.relay || options.filters.length === 0) {
        finish("error", "Finite relay requests require one relay and at least one filter")
        return
      }

      options.signal?.addEventListener("abort", onCallerAbort, {once: true})
      timer = setTimer(
        () => abortAndFinish("timeout", `Request timed out after ${options.timeoutMs}ms`),
        options.timeoutMs,
      )

      const receiveEvent = (event: TrustedEvent, relay: string) => {
        if (settled) return
        eventsById.set(event.id, event)

        try {
          options.onEvent?.(event, relay)
        } catch (error) {
          outcome = "error"
          reason = getErrorMessage(error)
          requestController.abort()
          finish(outcome, reason)
        }
      }

      let pending: Promise<TrustedEvent[]>
      try {
        pending = dependencies.request({
          relays: [options.relay],
          filters: options.filters,
          autoClose: true,
          lifetime: "finite",
          signal,
          priority: options.priority,
          owner: options.owner,
          onStart: () => {
            if (!settled && startedAt === undefined) startedAt = now()
          },
          onEvent: receiveEvent,
          onDuplicate: receiveEvent,
          onEose: () => {
            outcome ||= "eose"
          },
          onClosed: message => {
            outcome ||= "closed"
            reason ||= message
          },
          onDisconnect: () => {
            outcome ||= "disconnect"
          },
        })
      } catch (error) {
        finish("error", getErrorMessage(error))
        return
      }

      void pending.then(
        events => {
          if (settled) return
          for (const event of events) eventsById.set(event.id, event)

          if (outcome) finish(outcome, reason)
          else if (options.signal?.aborted) finish("aborted")
          else finish("error", "Finite relay request ended without a terminal outcome")
        },
        error => {
          if (settled) return
          if (outcome) finish(outcome, reason)
          else if (options.signal?.aborted) finish("aborted")
          else finish("error", getErrorMessage(error))
        },
      )
    })
  }
}

export const requestFiniteRelay = createFiniteRelayRequester({request: welshmanRequest})
