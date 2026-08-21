import {AuthStateEvent, AuthStatus} from "@welshman/net"
import type {SignedEvent, StampedEvent} from "@welshman/util"

type ProviderAuthSocket = {url: string}

const activeSocketScopes = new WeakMap<ProviderAuthSocket, number>()

export const isOperationScopedProviderAuthSocket = (socket: ProviderAuthSocket) =>
  activeSocketScopes.has(socket)

export const withOperationScopedProviderAuthSocket = async <T>(
  socket: ProviderAuthSocket,
  run: () => Promise<T>,
) => {
  activeSocketScopes.set(socket, (activeSocketScopes.get(socket) || 0) + 1)
  try {
    return await run()
  } finally {
    const remaining = (activeSocketScopes.get(socket) || 1) - 1
    if (remaining > 0) activeSocketScopes.set(socket, remaining)
    else activeSocketScopes.delete(socket)
  }
}

type ProviderAuthState = {
  status: AuthStatus
  challenge?: string
  on: (event: AuthStateEvent.Status, listener: (status: AuthStatus) => void) => unknown
  off: (event: AuthStateEvent.Status, listener: (status: AuthStatus) => void) => unknown
  doAuth?: (sign: ProviderAuthSign) => Promise<void>
}

type ProviderAuthSign = (event: StampedEvent) => Promise<SignedEvent>

const terminalAuthStatuses = new Set([
  AuthStatus.Ok,
  AuthStatus.Forbidden,
  AuthStatus.DeniedSignature,
])

export const waitForProviderRelayAuth = (
  auth: ProviderAuthState,
  timeoutMs = 10_000,
  sign?: ProviderAuthSign,
): Promise<AuthStatus> => {
  if (terminalAuthStatuses.has(auth.status)) return Promise.resolve(auth.status)

  return new Promise((resolve, reject) => {
    let signing = false
    let settled = false
    let attemptedChallenge = ""
    let timeout: ReturnType<typeof setTimeout>
    const cleanup = () => {
      clearTimeout(timeout)
      auth.off(AuthStateEvent.Status, onStatus)
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onStatus = (status: AuthStatus) => {
      if (settled) return
      if (terminalAuthStatuses.has(status)) {
        settled = true
        cleanup()
        resolve(status)
        return
      }
      if (
        status !== AuthStatus.Requested ||
        !auth.challenge ||
        auth.challenge === attemptedChallenge ||
        !sign ||
        !auth.doAuth ||
        signing
      ) {
        return
      }

      attemptedChallenge = auth.challenge
      signing = true
      void auth
        .doAuth(sign)
        .catch(fail)
        .finally(() => {
          signing = false
          if (auth.status === AuthStatus.Requested) onStatus(auth.status)
        })
    }
    timeout = setTimeout(() => {
      fail(new Error(`Provider relay authentication timed out after ${timeoutMs}ms.`))
    }, timeoutMs)

    auth.on(AuthStateEvent.Status, onStatus)
    onStatus(auth.status)
  })
}
