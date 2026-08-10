import {writable, type Readable} from "svelte/store"
import {
  abortThunk,
  pubkey,
  publishThunk,
  repository,
  retryThunk,
  tracker,
  waitForAnyRelayAck,
} from "@welshman/app"
import {randomId} from "@welshman/lib"
import type {PublishResultsByRelay} from "@welshman/net"
import {
  isSignedEvent,
  type EventTemplate,
  type HashedEvent,
  type TrustedEvent,
} from "@welshman/util"
import {recoverActiveNip46Receiver} from "@app/util/nip46"

export type PublicationPreviewPolicy = "retain-on-failure" | "rollback-on-failure" | "none"

export type PublicationPhase = "publishing" | "confirmed" | "unconfirmed" | "cancelled"

export type StartPublicationOptions = {
  event: EventTemplate
  relays: string[]
  confirmRelays?: string[]
  delay?: number
  label: string
  href?: string
  semanticKey?: string
  preview: PublicationPreviewPolicy
  validateRetry?: (event: HashedEvent) => void | Promise<void>
}

export type PublicationSnapshot = {
  readonly operationId: string
  readonly ownerPubkey: string
  readonly label: string
  readonly href?: string
  readonly semanticKey?: string
  readonly event: HashedEvent
  readonly phase: PublicationPhase
  readonly preview: PublicationPreviewPolicy
  readonly attempt: number
  readonly results: PublishResultsByRelay
  readonly error?: string
}

export type PublicationHandle = {
  operationId: string
  settled: Promise<PublicationSnapshot>
}

type PublicationThunk = ReturnType<typeof publishThunk>

type PublicationRuntime = {
  snapshot: PublicationSnapshot
  thunk: PublicationThunk
  confirmRelays: string[]
  generation: number
  committed: boolean
  unsubscribeThunk?: () => void
  unsubscribeTracker?: () => void
  resolveAttempt?: (snapshot: PublicationSnapshot) => void
  retryPromise?: Promise<PublicationSnapshot>
  cleanupTimer?: ReturnType<typeof setTimeout>
  validateRetry?: (event: HashedEvent) => void | Promise<void>
}

const CONFIRMED_HANDOFF_MS = 5_000
const operationStore = writable<Map<string, PublicationSnapshot>>(new Map())
const runtimes = new Map<string, PublicationRuntime>()

export const publicationOperations: Readable<Map<string, PublicationSnapshot>> = {
  subscribe: operationStore.subscribe,
}

const copyResults = (results: PublishResultsByRelay): PublishResultsByRelay =>
  Object.fromEntries(
    Object.entries(results).map(([relay, result]) => [relay, {...result}]),
  ) as PublishResultsByRelay

const publishSnapshot = (snapshot: PublicationSnapshot) => {
  operationStore.update(operations => {
    const next = new Map(operations)
    next.set(snapshot.operationId, snapshot)
    return next
  })
}

const removeSnapshot = (operationId: string) => {
  operationStore.update(operations => {
    if (!operations.has(operationId)) return operations

    const next = new Map(operations)
    next.delete(operationId)
    return next
  })
}

const updateSnapshot = (
  runtime: PublicationRuntime,
  patch: Partial<PublicationSnapshot>,
): PublicationSnapshot => {
  const snapshot = Object.freeze({
    ...runtime.snapshot,
    ...patch,
    results: copyResults(patch.results || runtime.snapshot.results),
  })

  runtime.snapshot = snapshot
  publishSnapshot(snapshot)
  return snapshot
}

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  return String(error || "Publication was not confirmed by any relay")
}

const getRepositoryEvent = (eventId: string) => {
  if (typeof repository.getEvent !== "function") return undefined
  return repository.getEvent(eventId)
}

const settleAttempt = (runtime: PublicationRuntime, snapshot: PublicationSnapshot) => {
  const resolve = runtime.resolveAttempt
  runtime.resolveAttempt = undefined
  resolve?.(snapshot)
}

const stopThunkSubscription = (runtime: PublicationRuntime) => {
  runtime.unsubscribeThunk?.()
  runtime.unsubscribeThunk = undefined
}

const stopTrackerSubscription = (runtime: PublicationRuntime) => {
  runtime.unsubscribeTracker?.()
  runtime.unsubscribeTracker = undefined
}

const removeRuntime = (runtime: PublicationRuntime) => {
  runtime.generation += 1
  stopThunkSubscription(runtime)
  stopTrackerSubscription(runtime)
  if (runtime.cleanupTimer) clearTimeout(runtime.cleanupTimer)
  runtime.cleanupTimer = undefined
  runtimes.delete(runtime.snapshot.operationId)
  removeSnapshot(runtime.snapshot.operationId)
}

const scheduleConfirmedCleanup = (runtime: PublicationRuntime) => {
  if (runtime.cleanupTimer) clearTimeout(runtime.cleanupTimer)

  runtime.cleanupTimer = setTimeout(() => {
    if (
      runtimes.get(runtime.snapshot.operationId) === runtime &&
      runtime.snapshot.phase === "confirmed"
    ) {
      removeRuntime(runtime)
    }
  }, CONFIRMED_HANDOFF_MS)
}

const commitEvent = (runtime: PublicationRuntime, event: HashedEvent) => {
  if (runtime.committed) return

  runtime.committed = true
  if (!getRepositoryEvent(event.id)) repository.publish(event as TrustedEvent)
}

const confirmOperation = (
  runtime: PublicationRuntime,
  {generation, event}: {generation?: number; event?: HashedEvent} = {},
) => {
  if (runtimes.get(runtime.snapshot.operationId) !== runtime) return
  if (generation !== undefined && runtime.generation !== generation) return
  if (!["publishing", "unconfirmed"].includes(runtime.snapshot.phase)) return

  const confirmedEvent = event || runtime.thunk.event
  commitEvent(runtime, confirmedEvent)
  stopThunkSubscription(runtime)
  stopTrackerSubscription(runtime)

  const snapshot = updateSnapshot(runtime, {
    event: confirmedEvent,
    phase: "confirmed",
    results: runtime.thunk.results,
    error: undefined,
  })

  settleAttempt(runtime, snapshot)
  scheduleConfirmedCleanup(runtime)
}

const markUnconfirmed = (runtime: PublicationRuntime, generation: number, error: unknown) => {
  if (runtimes.get(runtime.snapshot.operationId) !== runtime) return
  if (runtime.generation !== generation || runtime.snapshot.phase !== "publishing") return

  stopThunkSubscription(runtime)
  const snapshot = updateSnapshot(runtime, {
    event: runtime.thunk.event,
    phase: "unconfirmed",
    results: runtime.thunk.results,
    error: getErrorMessage(error),
  })

  settleAttempt(runtime, snapshot)
}

const hasQualifyingTrackerEvidence = (runtime: PublicationRuntime, eventId: string) => {
  const seenRelays =
    typeof tracker.getRelays === "function" ? tracker.getRelays(eventId) : new Set<string>()
  return runtime.confirmRelays.some(
    relay => seenRelays.has(relay) || tracker.hasRelay?.(eventId, relay),
  )
}

const reconcileTrackerEvidence = (
  runtime: PublicationRuntime,
  eventId = runtime.thunk.event.id,
  relay?: string,
) => {
  if (runtimes.get(runtime.snapshot.operationId) !== runtime) return
  if (!["publishing", "unconfirmed"].includes(runtime.snapshot.phase)) return
  if (runtime.thunk.event.id !== eventId) return
  if (relay && !runtime.confirmRelays.includes(relay)) return
  if (!relay && !hasQualifyingTrackerEvidence(runtime, eventId)) return

  const repositoryEvent = getRepositoryEvent(eventId)
  const ownedEvent = runtime.thunk.event
  if (!repositoryEvent && !isSignedEvent(ownedEvent)) return

  confirmOperation(runtime, {event: repositoryEvent || ownedEvent})
}

const attachTrackerSubscription = (runtime: PublicationRuntime) => {
  if (runtime.unsubscribeTracker || typeof tracker.on !== "function") return

  const onAdd = (eventId: string, relay: string) => {
    if (eventId !== runtime.thunk.event.id || !runtime.confirmRelays.includes(relay)) return
    queueMicrotask(() => reconcileTrackerEvidence(runtime, eventId, relay))
  }
  const onLoad = () => {
    queueMicrotask(() => reconcileTrackerEvidence(runtime))
  }

  tracker.on("add", onAdd)
  tracker.on("load", onLoad)
  runtime.unsubscribeTracker = () => {
    if (typeof tracker.off === "function") {
      tracker.off("add", onAdd)
      tracker.off("load", onLoad)
    }
  }

  if (hasQualifyingTrackerEvidence(runtime, runtime.thunk.event.id)) {
    queueMicrotask(() => reconcileTrackerEvidence(runtime))
  }
}

const attachThunkSubscription = (runtime: PublicationRuntime, generation: number) => {
  stopThunkSubscription(runtime)
  if (typeof runtime.thunk.subscribe !== "function") return

  runtime.unsubscribeThunk = runtime.thunk.subscribe(thunk => {
    if (runtimes.get(runtime.snapshot.operationId) !== runtime) return
    if (runtime.generation !== generation) return

    updateSnapshot(runtime, {
      event: thunk.event,
      results: thunk.results,
    })
  })
}

const beginAttempt = (runtime: PublicationRuntime) => {
  const generation = runtime.generation
  const settled = new Promise<PublicationSnapshot>(resolve => {
    runtime.resolveAttempt = resolve
  })

  attachThunkSubscription(runtime, generation)
  attachTrackerSubscription(runtime)

  void Promise.resolve()
    .then(() => waitForAnyRelayAck(runtime.thunk, runtime.confirmRelays))
    .then(
      () => confirmOperation(runtime, {generation}),
      error => markUnconfirmed(runtime, generation, error),
    )

  return settled
}

const validateRelaySets = (relays: string[], confirmRelays: string[]) => {
  if (relays.length === 0) throw new Error("Publication requires at least one relay")
  if (confirmRelays.length === 0) {
    throw new Error("Publication requires at least one confirmation relay")
  }

  const destinations = new Set(relays)
  if (confirmRelays.some(relay => !destinations.has(relay))) {
    throw new Error("Confirmation relays must be publication destinations")
  }
}

export const startPublication = (options: StartPublicationOptions): PublicationHandle => {
  const relays = Array.from(new Set(options.relays))
  const confirmRelays = Array.from(new Set(options.confirmRelays || relays))
  validateRelaySets(relays, confirmRelays)

  const thunk = publishThunk({
    event: options.event,
    relays,
    optimistic: false,
    ...(options.delay ? {delay: options.delay} : {}),
  })
  const operationId = randomId()
  const snapshot: PublicationSnapshot = Object.freeze({
    operationId,
    ownerPubkey: thunk.pubkey,
    label: options.label,
    href: options.href,
    semanticKey: options.semanticKey,
    event: thunk.event,
    phase: "publishing",
    preview: options.preview,
    attempt: 1,
    results: copyResults(thunk.results),
  })
  const runtime: PublicationRuntime = {
    snapshot,
    thunk,
    confirmRelays,
    generation: 1,
    committed: false,
    validateRetry: options.validateRetry,
  }

  runtimes.set(operationId, runtime)
  publishSnapshot(snapshot)

  return {
    operationId,
    settled: beginAttempt(runtime),
  }
}

const requireOwnedOperation = (operationId: string) => {
  const runtime = runtimes.get(operationId)
  if (!runtime) throw new Error("Publication operation is no longer available")
  if (runtime.snapshot.phase !== "unconfirmed") {
    throw new Error("Only unconfirmed publications can be retried")
  }
  if (pubkey.get() !== runtime.snapshot.ownerPubkey) {
    throw new Error("Restore the account that created this publication")
  }
  return runtime
}

export const retryPublication = (operationId: string): Promise<PublicationSnapshot> => {
  let runtime: PublicationRuntime
  try {
    runtime = requireOwnedOperation(operationId)
  } catch (error) {
    return Promise.reject(error)
  }

  if (runtime.retryPromise) return runtime.retryPromise

  const generation = runtime.generation
  const thunk = runtime.thunk
  const retryPromise = (async () => {
    await recoverActiveNip46Receiver().catch(() => false)

    const current = requireOwnedOperation(operationId)
    if (current !== runtime || runtime.generation !== generation || runtime.thunk !== thunk) {
      throw new Error("Publication operation changed before retry")
    }

    await runtime.validateRetry?.(runtime.thunk.event)

    const validated = requireOwnedOperation(operationId)
    if (validated !== runtime || runtime.generation !== generation || runtime.thunk !== thunk) {
      throw new Error("Publication operation changed before retry")
    }

    const retriedThunk = retryThunk(thunk) as PublicationThunk
    stopThunkSubscription(runtime)
    runtime.thunk = retriedThunk
    runtime.generation += 1

    updateSnapshot(runtime, {
      event: retriedThunk.event,
      phase: "publishing",
      attempt: runtime.snapshot.attempt + 1,
      results: retriedThunk.results,
      error: undefined,
    })

    return beginAttempt(runtime)
  })().finally(() => {
    if (runtime.retryPromise === retryPromise) runtime.retryPromise = undefined
  })

  runtime.retryPromise = retryPromise
  return retryPromise
}

export const cancelPublication = (operationId: string) => {
  const runtime = runtimes.get(operationId)
  if (!runtime || runtime.snapshot.phase !== "publishing") return

  const cancelled = Object.freeze({...runtime.snapshot, phase: "cancelled" as const})
  const resolve = runtime.resolveAttempt
  runtime.resolveAttempt = undefined
  removeRuntime(runtime)
  abortThunk(runtime.thunk)
  resolve?.(cancelled)
}

export const discardPublication = (operationId: string) => {
  const runtime = runtimes.get(operationId)
  if (!runtime || runtime.snapshot.phase !== "unconfirmed") return
  removeRuntime(runtime)
}

export const clearPublicationOperations = () => {
  for (const runtime of Array.from(runtimes.values())) {
    const wasPublishing = runtime.snapshot.phase === "publishing"
    const cancelled = Object.freeze({...runtime.snapshot, phase: "cancelled" as const})
    const resolve = runtime.resolveAttempt
    runtime.resolveAttempt = undefined
    removeRuntime(runtime)
    if (wasPublishing) abortThunk(runtime.thunk)
    resolve?.(cancelled)
  }

  operationStore.set(new Map())
}

export const isPublicationPreviewVisible = (operation: PublicationSnapshot) => {
  if (operation.phase === "publishing") return operation.preview !== "none"
  if (operation.phase === "unconfirmed") return operation.preview === "retain-on-failure"
  return false
}
