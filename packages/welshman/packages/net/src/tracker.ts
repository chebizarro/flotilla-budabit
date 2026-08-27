import {Emitter, addToMapKey} from "@welshman/lib"
import {normalizeRelayUrl} from "@welshman/util"

const getRelayKey = (relay: string) => {
  try {
    return normalizeRelayUrl(relay)
  } catch {
    return undefined
  }
}

export class Tracker extends Emitter {
  relaysById = new Map<string, Set<string>>()
  idsByRelay = new Map<string, Set<string>>()

  constructor() {
    super()

    this.setMaxListeners(100)
  }

  getIds = (relay: string) => {
    const key = getRelayKey(relay)
    return (key && this.idsByRelay.get(key)) || new Set<string>()
  }

  getRelays = (eventId: string) => this.relaysById.get(eventId) || new Set<string>()

  hasRelay = (eventId: string, relay: string) => {
    const key = getRelayKey(relay)
    return Boolean(key && this.relaysById.get(eventId)?.has(key))
  }

  addRelay = (eventId: string, relay: string) => {
    const key = getRelayKey(relay)
    if (!key) return
    relay = key

    let relays = this.relaysById.get(eventId)
    let ids = this.idsByRelay.get(relay)

    if (relays?.has(relay) && ids?.has(eventId)) return

    if (!relays) {
      relays = new Set()
    }

    if (!ids) {
      ids = new Set()
    }

    relays.add(relay)
    ids.add(eventId)

    this.relaysById.set(eventId, relays)
    this.idsByRelay.set(relay, ids)

    this.emit("add", eventId, relay)
  }

  removeRelay = (eventId: string, relay: string) => {
    const key = getRelayKey(relay)
    if (!key) return
    relay = key

    const didDeleteRelay = this.relaysById.get(eventId)?.delete(relay) ?? false
    const didDeleteId = this.idsByRelay.get(relay)?.delete(eventId) ?? false

    if (this.relaysById.get(eventId)?.size === 0) this.relaysById.delete(eventId)
    if (this.idsByRelay.get(relay)?.size === 0) this.idsByRelay.delete(relay)

    if (!didDeleteRelay && !didDeleteId) return

    this.emit("remove", eventId, relay)
  }

  track = (eventId: string, relay: string) => {
    const seen = this.relaysById.has(eventId)

    this.addRelay(eventId, relay)

    return seen
  }

  copy = (eventId1: string, eventId2: string) => {
    for (const relay of this.getRelays(eventId1)) {
      this.addRelay(eventId2, relay)
    }
  }

  load = (relaysById: Tracker["relaysById"]) => {
    this.relaysById.clear()
    this.idsByRelay.clear()

    for (const [id, relays] of relaysById.entries()) {
      for (const relay of relays) {
        const key = getRelayKey(relay)
        if (!key) continue

        addToMapKey(this.relaysById, id, key)
        addToMapKey(this.idsByRelay, key, id)
      }
    }

    this.emit("load")
  }

  clear = () => {
    this.relaysById.clear()
    this.idsByRelay.clear()

    this.emit("clear")
  }
}
