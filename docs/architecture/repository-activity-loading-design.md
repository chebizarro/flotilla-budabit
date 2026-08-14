# Repository Activity Loading Design

## Status

- Approved replacement for the abandoned `repo-subscription-redesign-experiment`.
- The experiment remains useful only as evidence for the original problem statement and regression cases.
- This design deliberately does not reuse its repository coordinator, demand scheduler, live supervisor, feed-controller changes, or dedicated query-state cache.

## Problem

Repository lists and repository activity frequently behave like cold network queries:

- Issue and pull-request roots can appear 10 to 30 seconds after navigation.
- A previously visited repository is cold after a hard reload.
- Empty lists are presented without proof that authoritative relay history completed.
- Layout and child routes issue overlapping history work.
- Most finite work outlives its route because it has no route cancellation signal.
- Root discovery rebuilds growing live filters, causing subscription churn and relay pressure.
- Failed or incomplete finite requests are commonly indistinguishable from successful empty EOSE.
- Late IndexedDB hydration can replace newer in-memory state.
- Repository UI objects can retain route-owned stores after navigation.

These are ownership, lifecycle, persistence, and presentation problems. They do not establish a need for a new global repository state machine or changes to Welshman's transport contracts.

## Goals

- Render verified cached or in-memory repository data immediately.
- Refresh independently without hiding stale content.
- Give repository list and detail routes explicit ownership of their network work.
- Keep live filters small and stable as roots are discovered.
- Load a bounded recent root page first and older pages only on demand.
- Distinguish EOSE, timeout, disconnect, `CLOSED`, abort, and local failure for completion-sensitive finite work.
- Make all route-owned finite and live work cancellable.
- Persist recent and watched repository activity within deterministic bounds.
- Preserve the canonical Welshman `repository` and `tracker` as the only UI event source.
- Respect announcement-derived repository relay authority.
- Keep lower-level changes behind an evidence-based necessity gate.

## Non-Goals

- No global coordinator keyed by repository address.
- No route demand registry or scheduler priority mutation.
- No reserved scheduler lane or active request preemption.
- No changes to Welshman `load`, `request`, feeds, scheduler, pool, repository, or tracker in the planned implementation.
- No second canonical in-memory event repository.
- No permanent root-ID live subscription for every discovered issue or pull request.
- No eager full-history backfill on repository entry.
- No authoritative-empty claim for history that has not been exhausted.
- No migration of community relay loading onto repository-specific abstractions.

## Existing Foundations

The implementation uses current primitives as-is:

- `@welshman/app` supplies the singleton canonical `repository` and relay-provenance `tracker`.
- `@welshman/store` supplies repository-derived Svelte stores.
- `@welshman/net` `request` supplies per-relay callbacks, cancellation, finite/live lifetimes, priority, ownership labels, filter chunking, and scheduler admission.
- `load` remains available for opportunistic hydration where partial results are acceptable.
- The existing scheduler already orders queued jobs by priority and releases queued or active jobs on abort.
- `RepoLiveOwnershipRegistry` coordinates foreground detail coverage with background watched-repository coverage.
- IndexedDB and the `idb` package are already application dependencies.

## Ownership Model

### Application Root

The root owns process-lifetime storage and background watched-repository notification work. It does not own active repository route history.

### Repository List Layout

`/git/+layout.svelte` owns list-wide preload work while `/git` is mounted:

- Hydrate eligible cached announcements.
- Start bounded announcement refresh and live coverage.
- Abort preload work when leaving `/git`.

Tab-specific personal, community, starred, and search requests may remain page-owned, but all receive one page-lifetime cancellation signal. Duplicate personal announcement ownership between root synchronization and the page must be removed.

### Repository Detail Layout

`/git/[id=naddr]/+layout.svelte` is the sole owner of repository activity transport while that repository is mounted:

- Hydrate cached events.
- Resolve and refresh the exact kind-30617 announcement.
- Derive activity relays only from a valid matching announcement.
- Start stable live lanes.
- Load a bounded recent roots page.
- Run finite compatibility gap-fill for loaded roots.
- Expose narrow context actions for older roots, exact roots, and retries.
- Abort all owned work and dispose route-owned UI state on destruction.

Child pages consume canonical projections. They may express demand through layout actions, but do not create independent repository-wide feeds or subscriptions.

## Data Flow

```text
bounded repository cache
  -> independent signature verification
  -> Welshman repository + tracker

announcement discovery relays
  -> exact announcement request/live refresh
  -> matching signed announcement
  -> authoritative repository activity relays

repository activity relays
  -> stable coordinate-scoped live lanes
  -> bounded recent root pages
  -> finite root compatibility gap-fill
  -> exact deep-link resolution
  -> Welshman repository + tracker

Welshman repository-derived stores
  -> repository layout contexts
  -> overview / activity / issues / PRs / detail routes
```

Network helpers do not retain a second copy of domain events. Accepted events flow into the existing canonical repository, and UI projections continue to derive from it.

## Finite Request Contract

Completion-sensitive repository work uses a small application-level wrapper around `request`, once per relay:

```ts
type FiniteRelayOutcome = "eose" | "timeout" | "closed" | "disconnect" | "aborted" | "error"

type FiniteRelayResult = {
  relay: string
  outcome: FiniteRelayOutcome
  events: TrustedEvent[]
  queuedAt: number
  startedAt?: number
  finishedAt: number
  reason?: string
}
```

The wrapper composes a caller signal with a deadline and records `onStart`, `onEose`, `onClosed`, and `onDisconnect`. It does not change Welshman's return type or batching behavior.

Use this wrapper when empty-state authority, pagination, retries, or diagnostics depend on terminal cause. Continue using `load` for best-effort hydration where an event array is sufficient.

Entering a foreground route does not promote existing queued background work. It aborts obsolete preload work and starts a new interactive request. This uses the scheduler's existing cancellation and priority behavior and avoids mutable cross-feature demand identities.

## Stable Live Coverage

Live and finite history may be admitted in either order. To avoid a history-to-live gap, each relay's first live request performs a bounded replay for repository-scoped filters until that request reaches EOSE. Broad viewer-only filters remain live-only, and reconnects after the first EOSE use the normal timestamp overlap. Each relay has independent ownership and a route-scoped controller.

### Coordinate Lane

Modern repository activity carries a repository `a` tag:

```ts
{
  kinds: [
    GIT_ISSUE,
    GIT_PULL_REQUEST,
    GIT_PULL_REQUEST_UPDATE,
    GIT_LABEL,
    GIT_COVER_LETTER,
    ...statusKinds,
  ],
  "#a": repositoryAddresses,
  since: liveBoundary,
}
```

### Comment Lane

Budabit Git comments include repository coordinates as `q` tags:

```ts
{
  kinds: [COMMENT],
  "#q": repositoryAddresses,
  since: liveBoundary,
}
```

The filters are separate because fields within one NIP-01 filter are ANDed, while filters within a request are ORed.

### Metadata Lane

Repository state and announcement replacements use stable owner/identifier filters. Announcement replacements are read from discovery relays; repository state is read from activity relays.

### Retry And Reconnect

Unexpected disconnect or `CLOSED` schedules bounded per-relay retry with jitter. A replacement starts at `lastReceivedAt - overlapSeconds`. Abort from route teardown is terminal and schedules no retry.

This is a disposable per-relay loop owned by one route generation, not a reusable global live supervisor.

## Legacy Compatibility

Older or third-party comments, reports, and deletes may lack repository-coordinate tags. The selected compatibility policy is:

- Stable address and `q` live lanes for current events.
- Finite root-ID gap-fill on repository entry, repository re-entry, and browser foreground resume.
- Exact live root coverage only for the currently open thread when required.
- No permanent live filter growth for every loaded root.

For each newly loaded root chunk, finite compatibility filters cover:

- Comments by `#E` and `#e`.
- Pull-request updates by root reference.
- Labels and cover letters by `#e`.
- Statuses and reports by `#e`.
- Repository-tagged delete evidence.

Projection code must still validate root membership. A matching coordinate or `q` tag is a discovery claim, not authorization.

## Recent History And Pagination

Repository entry requests one bounded recent issue/PR page per authoritative relay. Older history loads only when the user requests more or opens an older deep link.

Pagination state is per relay because relay histories and result caps differ. A global cursor can skip data present on only one relay.

Timestamp boundaries are inclusive:

- Deduplicate by event ID.
- Requery the oldest timestamp represented in a full page.
- If a boundary remains full without progress, increase its limit up to the relay policy maximum.
- If the boundary still cannot be exhausted, mark that relay partial rather than advancing past potentially unseen same-second events.

The existing feed controller's `created_at - 1` cursor is therefore not used for repository root pagination.

## Deep-Link Resolution

Issue and PR detail routes call a layout-provided `ensureRoot(id)` action:

1. Read the canonical repository synchronously.
2. If absent, request the exact ID from activity relays.
3. Verify that the root belongs to an accepted repository address.
4. Resolve a PR-update reference to its root where applicable.
5. Run finite root compatibility gap-fill.
6. Return an explicit complete, partial, failed, unavailable, or aborted result.

This preserves child-route demand while keeping physical network ownership in the layout.

## Cache

Repository activity uses a bounded application sidecar cache. It does not use another in-memory event repository and does not modify the generic Welshman repository API.

### Eligibility

- Recently visited repositories: bounded LRU and maximum age.
- Watched repositories: retained independently within a hard watched-repository limit.

### Records

The first version stores only data needed to hydrate canonical state and enforce bounds:

```ts
type CachedRepositoryEvent = {
  key: string
  repositoryAddress: string
  event: TrustedEvent
  relays: string[]
  eventClass: "authority" | "root" | "activity" | "delete"
  cachedAt: number
  lastAccessedAt: number
  bytes: number
}

type CachedRepository = {
  address: string
  watched: boolean
  lastAccessedAt: number
  eventCount: number
  bytes: number
}
```

No persisted per-dataset request state machine is introduced initially. Empty authority comes from current finite EOSE results, not cache metadata.

### Verification

Configured trusted relays can bypass ordinary ingress signature verification. Durable cache writes and cache hydration therefore independently verify a plain serialized event cryptographically. An event accepted only because of relay trust remains memory-only.

### Initial Bounds

- 16 recent repositories.
- 30-day recent eligibility.
- At most 50 watched repositories.
- 2,000 events or 4 MiB per repository.
- 8,000 events or 16 MiB globally.
- At most six relay provenance entries per event.
- Reject oversized individual records.

Route cache hydration yields to network startup after 250 ms. On the Playwright reference
environment, cached recent and watched issue detail must become visible within 3,000 ms of starting
an offline navigation; the final validation suite enforces that end-to-end budget.

Pruning removes IndexedDB records only. It must never remove events from an active canonical repository.

### Existing Storage Safety

The generic event and tracker adapters must hydrate additively. A delayed IndexedDB open must not call destructive `repository.load()` or `tracker.load()` after newer network/cache events have arrived. This is an application adapter correction independent of repository activity caching.

## Presentation Semantics

The UI distinguishes:

- Cached or in-memory content available immediately.
- Refreshing while content remains visible.
- No content yet while recent history is loading.
- Recent page complete.
- Partial or failed recent refresh with retry.
- No items in loaded history.
- Fully exhausted repository history.
- Client-side filters hiding loaded content.
- Repository relay authority unavailable.

`No issues found` or `No PRs found` is authoritative only after requested history is exhausted with complete EOSE evidence. A completed recent page is not proof that older items do not exist.

## Relay Safety

- Use only announcement-derived activity relays for repository activity.
- Route hints remain announcement-discovery inputs only.
- Cap foreground live relay fan-out; process additional declared relays with bounded finite work and expose partial coverage.
- Keep stable live requests below relay filter and byte policy limits.
- Sequence root pages and compatibility gap-fill so a route normally owns one live and one finite request per relay.
- Preserve background/foreground handoff with the existing repository live ownership registry.

## Necessity Gate For Lower-Level Changes

A Welshman change is considered only after the application-level implementation proves at least one of these with deterministic tests and production diagnostics:

- Aborted route work fails to release scheduler capacity.
- Foreground requests remain blocked beyond the agreed budget after obsolete and background work is bounded and cancelled.
- Existing callbacks cannot reliably distinguish finite terminal outcomes.
- Multiple unrelated features need the same finite-result contract and application wrappers have demonstrably diverged.

If proven, the first acceptable change is a small sibling finite API returning explicit per-relay results. It must not alter existing `load`, feeds, request batching, or scheduler behavior.

Queued-priority mutation, foreground reservations, active preemption, feed-controller rewrites, and a global subscription coordinator remain out of scope without separate evidence and review.

## Risks

- Cached authority can be stale. Treat it as provisional, render cached content, and refresh the exact announcement immediately.
- A malicious announcement can declare many relays. Cap live fan-out and expose incomplete relay coverage.
- Legacy events can miss address tags. Use bounded focus/re-entry gap-fill and exact thread coverage.
- More events can share a timestamp than a relay's result cap. Use inclusive overlap and explicit partial status.
- Cache context can be forged. Verify signatures and repository/root membership before durable use.
- Background watchers can duplicate foreground coverage. Preserve the existing ownership handoff.
- A route-local implementation can still become overly complex. Keep helpers stateless and keep lifecycle state in the owning layout.

## Success Criteria

- Cached repository activity renders before new network completion.
- Warm recent and watched repositories render after hard reload with relays unavailable.
- Root discovery causes no live subscription restart or filter growth.
- Same-repository navigation creates one repository activity owner.
- Leaving a route aborts all its queued and active finite work.
- Recent history is bounded and older history loads only on demand.
- Equal-timestamp pages do not silently skip roots.
- Timeout, disconnect, `CLOSED`, abort, error, and EOSE remain distinguishable.
- Timeout or failure never produces authoritative empty UI.
- No planned phase modifies Welshman or nostr-git package internals.
