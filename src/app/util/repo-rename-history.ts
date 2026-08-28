const STORAGE_PREFIX = "budabit:repo-rename-history:"
const MAX_RENAME_ADDRESSES = 32
type RepoRenameStorage = Pick<Storage, "getItem" | "setItem">

const addressFor = (owner: string, identifier: string) =>
  /^[0-9a-f]{64}$/.test(owner) && identifier ? `30617:${owner}:${identifier}` : ""

const readHistory = (owner: string, storage?: RepoRenameStorage): string[][] => {
  if (!storage) return []
  try {
    const value = JSON.parse(storage.getItem(`${STORAGE_PREFIX}${owner}`) || "[]")
    return Array.isArray(value)
      ? value.filter(
          edge =>
            Array.isArray(edge) &&
            edge.length === 2 &&
            edge.every(
              address => typeof address === "string" && address.startsWith(`30617:${owner}:`),
            ),
        )
      : []
  } catch {
    return []
  }
}

export const recordRepoRename = ({
  owner,
  previousIdentifier,
  nextIdentifier,
  storage = typeof localStorage === "undefined" ? undefined : localStorage,
}: {
  owner: string
  previousIdentifier: string
  nextIdentifier: string
  storage?: RepoRenameStorage
}) => {
  const previous = addressFor(owner, previousIdentifier)
  const next = addressFor(owner, nextIdentifier)
  if (!storage || !previous || !next || previous === next) return

  const edges = readHistory(owner, storage)
  const key = `${previous}\n${next}`
  const unique = new Map(edges.map(edge => [`${edge[0]}\n${edge[1]}`, edge]))
  unique.set(key, [previous, next])
  storage.setItem(
    `${STORAGE_PREFIX}${owner}`,
    JSON.stringify(Array.from(unique.values()).slice(-MAX_RENAME_ADDRESSES)),
  )
}

export const getRepoRenameAddresses = (
  currentAddress: string,
  storage: RepoRenameStorage | undefined = typeof localStorage === "undefined"
    ? undefined
    : localStorage,
) => {
  const match = currentAddress.match(/^30617:([0-9a-f]{64}):(.+)$/)
  if (!match) return currentAddress ? [currentAddress] : []

  const connected = new Set([currentAddress])
  const edges = readHistory(match[1], storage)
  let changed = true
  while (changed && connected.size < MAX_RENAME_ADDRESSES) {
    changed = false
    for (const [left, right] of edges) {
      if (!connected.has(left) && !connected.has(right)) continue
      const before = connected.size
      connected.add(left)
      connected.add(right)
      changed ||= connected.size !== before
    }
  }
  return Array.from(connected).slice(0, MAX_RENAME_ADDRESSES)
}
