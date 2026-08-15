type RefreshEntry<T> = {
  value?: T
  refreshedAt?: number
  pending?: Promise<T>
}

export class BoundedRefreshCache<T> {
  private readonly entries = new Map<string, RefreshEntry<T>>()

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
    private readonly isFreshValue: (value: T) => boolean = () => true,
  ) {}

  get size() {
    return this.entries.size
  }

  getLatest(key: string): T | undefined {
    return this.entries.get(key)?.value
  }

  refresh(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key)
    if (existing?.pending) return existing.pending
    if (
      existing?.value !== undefined &&
      existing.refreshedAt !== undefined &&
      this.now() - existing.refreshedAt < this.ttlMs
    ) {
      this.touch(key, existing)
      return Promise.resolve(existing.value)
    }

    const entry = existing || {}
    const pending = load()
      .then(value => {
        entry.value = value
        entry.refreshedAt = this.isFreshValue(value) ? this.now() : undefined
        return value
      })
      .finally(() => {
        if (entry.pending === pending) entry.pending = undefined
      })
    entry.pending = pending
    this.touch(key, entry)
    this.prune()
    return pending
  }

  private touch(key: string, entry: RefreshEntry<T>) {
    this.entries.delete(key)
    this.entries.set(key, entry)
  }

  private prune() {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) return
      this.entries.delete(oldest)
    }
  }
}
