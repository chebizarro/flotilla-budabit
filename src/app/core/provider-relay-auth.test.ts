import {EventEmitter} from "node:events"
import {describe, expect, it, vi} from "vitest"
import {AuthStateEvent, AuthStatus} from "@welshman/net"
import {
  isOperationScopedProviderAuthSocket,
  waitForProviderRelayAuth,
  withOperationScopedProviderAuthSocket,
} from "./provider-relay-auth"

describe("operation-scoped provider relay authentication", () => {
  it("keeps overlapping scopes reference-counted by socket", async () => {
    const socket = {url: "wss://alerts.example.com/"}
    let releaseFirst: () => void = () => undefined
    let releaseSecond: () => void = () => undefined
    const firstBlocked = new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    const secondBlocked = new Promise<void>(resolve => {
      releaseSecond = resolve
    })
    const first = withOperationScopedProviderAuthSocket(socket, async () => {
      await firstBlocked
    })
    const second = withOperationScopedProviderAuthSocket(socket, async () => {
      await secondBlocked
    })

    expect(isOperationScopedProviderAuthSocket(socket)).toBe(true)
    releaseFirst()
    await first
    expect(isOperationScopedProviderAuthSocket(socket)).toBe(true)
    releaseSecond()
    await second
    expect(isOperationScopedProviderAuthSocket(socket)).toBe(false)
  })

  it("does not collapse concurrent scopes for different sockets", async () => {
    const firstSocket = {url: "wss://one.example.com/"}
    const secondSocket = {url: "wss://two.example.com/"}
    let release: () => void = () => undefined
    const blocked = new Promise<void>(resolve => {
      release = resolve
    })
    const first = withOperationScopedProviderAuthSocket(firstSocket, async () => {
      await blocked
    })
    await withOperationScopedProviderAuthSocket(secondSocket, async () => {
      expect(isOperationScopedProviderAuthSocket(firstSocket)).toBe(true)
      expect(isOperationScopedProviderAuthSocket(secondSocket)).toBe(true)
    })
    expect(isOperationScopedProviderAuthSocket(secondSocket)).toBe(false)
    release()
    await first
  })

  it("waits for a terminal status and removes listeners", async () => {
    const auth = Object.assign(new EventEmitter(), {status: AuthStatus.PendingSignature})
    const waiting = waitForProviderRelayAuth(auth)

    auth.status = AuthStatus.PendingResponse
    auth.emit(AuthStateEvent.Status, auth.status)
    auth.status = AuthStatus.Ok
    auth.emit(AuthStateEvent.Status, auth.status)

    await expect(waiting).resolves.toBe(AuthStatus.Ok)
    expect(auth.listenerCount(AuthStateEvent.Status)).toBe(0)
  })

  it("authenticates when the relay challenge arrives after the initial attempt", async () => {
    const auth = Object.assign(new EventEmitter(), {
      status: AuthStatus.None,
      challenge: "late-challenge",
      doAuth: vi.fn(),
    })
    auth.doAuth.mockImplementation(async () => {
      auth.status = AuthStatus.PendingResponse
      auth.emit(AuthStateEvent.Status, auth.status)
      auth.status = AuthStatus.Ok
      auth.emit(AuthStateEvent.Status, auth.status)
    })
    const sign = vi.fn()
    const waiting = waitForProviderRelayAuth(auth, 100, sign)

    auth.status = AuthStatus.Requested
    auth.emit(AuthStateEvent.Status, auth.status)

    await expect(waiting).resolves.toBe(AuthStatus.Ok)
    expect(auth.doAuth).toHaveBeenCalledOnce()
    expect(auth.listenerCount(AuthStateEvent.Status)).toBe(0)
  })

  it("bounds non-terminal authentication waits", async () => {
    const auth = Object.assign(new EventEmitter(), {status: AuthStatus.None})

    await expect(waitForProviderRelayAuth(auth, 5)).rejects.toThrow("timed out")
    expect(auth.listenerCount(AuthStateEvent.Status)).toBe(0)
  })

  it("attempts each challenge once and remains bounded", async () => {
    const auth = Object.assign(new EventEmitter(), {
      status: AuthStatus.Requested,
      challenge: "unanswered-challenge",
      doAuth: vi.fn(async () => undefined),
    })

    await expect(waitForProviderRelayAuth(auth, 5, vi.fn())).rejects.toThrow("timed out")
    expect(auth.doAuth).toHaveBeenCalledOnce()
    expect(auth.listenerCount(AuthStateEvent.Status)).toBe(0)
  })
})
