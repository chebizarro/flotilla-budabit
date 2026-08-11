import {AuthStateEvent, AuthStatus} from "@welshman/net"

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
  on: (event: AuthStateEvent.Status, listener: (status: AuthStatus) => void) => unknown
  off: (event: AuthStateEvent.Status, listener: (status: AuthStatus) => void) => unknown
}

const terminalAuthStatuses = new Set([
  AuthStatus.Ok,
  AuthStatus.Forbidden,
  AuthStatus.DeniedSignature,
])

export const waitForProviderRelayAuth = (
  auth: ProviderAuthState,
  timeoutMs = 10_000,
): Promise<AuthStatus> => {
  if (terminalAuthStatuses.has(auth.status)) return Promise.resolve(auth.status)

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout)
      auth.off(AuthStateEvent.Status, onStatus)
    }
    const onStatus = (status: AuthStatus) => {
      if (!terminalAuthStatuses.has(status)) return
      cleanup()
      resolve(status)
    }
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`Provider relay authentication timed out after ${timeoutMs}ms.`))
    }, timeoutMs)

    auth.on(AuthStateEvent.Status, onStatus)
    if (terminalAuthStatuses.has(auth.status)) onStatus(auth.status)
  })
}
