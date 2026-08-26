# Welshman Performance Lessons From Applesauce

## Status

- Comparative architecture note.
- Applies to Budabit's vendored Welshman packages and their use by Budabit.
- Applesauce and GitWorkshop are evidence only. No changes to either project are proposed here.
- The first recommended change is specified separately in
  `welshman-kind-routed-repository-subscriptions-plan.md`.

## Context

Budabit's August 2026 physical performance captures established that relay admission was
creating sustained main-thread pressure in the process-wide Welshman repository. Every
repository update synchronously woke every active `update` listener. Each listener then decided
whether the update was relevant.

Bounded relay ingress improved the worst bursts by:

- Deferring ordinary relay admission by 16 ms.
- Publishing at most 16 events in one repository batch.
- Serializing reentrant updates.
- Yielding after at most 16 queued repository updates.

This reduced update frequency and the largest tasks, but it did not change listener fan-out. A
single derived store, `communityModeratorProfileListEvents`, still consumed most measured
repository listener time because its filter included all kind-5 events from the current user.
Removing that unnecessary branch reduced measured repository-listener time from 7.48 seconds to
1.36 seconds in the recorded mobile Community workload.

The current implementation is in:

- `packages/welshman/packages/net/src/repository.ts`
- `packages/welshman/packages/store/src/repository.ts`
- `packages/welshman/packages/app/src/index.ts`

The measurements and history are in `performance-journal.md`.

## Comparative Finding

Applesauce does not solve this problem with routed notifications. Its `EventStore` has global
RxJS `insert$`, `remove$`, and `update$` subjects. Every active unique model connected to one of
those subjects receives each synchronous emission and applies its own exact predicate.

Applesauce gains efficiency elsewhere:

- Equivalent models are memoized and shared by all consumers.
- Events are canonicalized by ID so duplicate deliveries reuse one object.
- Timelines query once and then apply matching insertions and removals incrementally.
- Mutable metadata updates have a separate opt-in stream.
- Active models claim events, allowing unclaimed memory entries to be pruned.
- Snapshot queries use kind, author, kind-author, tag, time, ID, and address indexes.

These mechanisms reduce duplicate work and full re-querying, but they do not prevent irrelevant
models from waking. Models also remain connected for a 60-second warm period, which can increase
fan-out after their last visible consumer has gone away.

Welshman should therefore adopt the useful supporting ideas without copying Applesauce's global
synchronous notification design.

## Current Welshman Strengths

Welshman already has several properties that should be preserved:

- One canonical process-wide repository is shared by relay ingress, persistence hydration,
  optimistic publication, and application projections.
- Snapshot queries use existing ID, address, tag, day, author, and kind indexes.
- Derived stores query once and process `added` and `removed` deltas incrementally.
- Delete events remain queryable while normal target queries exclude deleted events.
- `RepositoryUpdate.removed` lets target stores react to deletion without subscribing to kind 5.
- Atomic batches merge intermediate mutations into one final-state update.
- Deferred ingress and the queued update drain yield between bounded batches.
- Per-subscriber diagnostics can attribute synchronous listener cost to a named source.

The next work should build on these contracts rather than replace the repository or store model.

## Lessons

### 1. Route Notifications Before Invoking Listeners

The highest-value change is coarse repository-level routing. Most Welshman filters declare one or
more kinds, and the repository already knows the kinds affected by additions, replacements,
deletions, expiration, explicit removal, and full loads.

Listeners whose filters are entirely kind-constrained should be placed in kind buckets. An update
should invoke only listeners whose buckets intersect the kinds affected by that update. Listeners
without a safe kind constraint remain in a fallback bucket.

Full `matchFilters` checks stay in each store callback. Coarse routing narrows candidates; it does
not replace exact matching.

Deletion is the important correctness constraint. A kind-30000 store must receive an update that
removes a kind-30000 target even when the event causing the removal is kind 5. Routing must use
the kinds of both added events and removed targets, not merely `update.added.map(event.kind)`.

See `welshman-kind-routed-repository-subscriptions-plan.md`.

### 2. Share Equivalent Derived Queries

Applesauce memoizes a model by constructor and semantic arguments, so multiple consumers share one
repository subscription and one incremental projection.

Welshman currently creates a new readable and repository listener each time helpers such as
`deriveEventsById` are called. Budabit can therefore create equivalent filters in several mounted
components and repeat the same matching and projection work.

After kind routing is validated, Welshman should consider interning only its generic repository
derivations:

- Canonicalize filter order and set-like filter values.
- Include repository identity and options such as `includeDeleted` in the key.
- Share one readable while it has consumers.
- Tear down immediately at first; add a short warm period only if measurements justify it.
- Expose cache size and active-consumer diagnostics.

This should be a separate change. Routing reduces the cost of every subscription, while interning
changes ownership and lifecycle semantics.

### 3. Preserve Incremental State And Suppress No-Op Emissions

Both libraries query initial state and then apply deltas. Welshman's mutable maps are efficient,
but every derivation should retain the rule that downstream `set` is called only when observable
contents change.

Particular care is required for:

- Replaceable insertion followed by removal of the previous version.
- A target and its delete arriving in one batch.
- Duplicate event delivery from cache and network.
- Tracker-only provenance changes.

Applesauce can emit equivalent timeline state twice during replaceable processing. Welshman's
merged final-state batch is preferable and should remain covered by tests.

### 4. Keep Structural And Metadata Notifications Separate

Applesauce has an explicit noisy `update$` channel that models consume only when they depend on
mutable metadata. Welshman already keeps relay provenance in `Tracker`, but future repository
metadata must not be folded into structural `added` and `removed` notifications by convenience.

The repository update channel should continue to mean that query-visible event membership may
have changed. Relay provenance, diagnostics, cache bookkeeping, and mutable annotations should
use their own channels.

### 5. Retain Canonical Events And Indexed Snapshot Reads

Applesauce's canonical event instances make duplicate delivery and referential comparisons cheap.
Welshman already retains one event by ID and should preserve that behavior.

The existing snapshot indexes are also sufficient for the proposed notification work. A new query
engine is not needed. Notification routing should initially reuse only kinds; author, ID, address,
and tag routing should require new measurements showing that kind routing is insufficient.

### 6. Make Subscription Retention Observable Before Adding Warm Caches

Applesauce keeps an unused model warm for 60 seconds. This can improve remount latency but also
keeps filters connected to every global event emission.

Welshman should not add a warm query cache by default. If shared derived queries later benefit
from retention, the timeout must be configurable and diagnostics must report:

- Active shared queries.
- Queries with no current consumer.
- Time retained after the final consumer.
- Repository updates examined while warm.
- Cache evictions and maximum size.

### 7. Use Claims Only If Repository Pruning Becomes A Requirement

Applesauce lets active models claim events while unclaimed events are eligible for LRU pruning.
This is useful but changes assumptions about synchronous local availability.

Budabit already has bounded sidecar persistence and route-owned hydration work. Event claims and
repository pruning should remain deferred until memory captures prove that canonical repository
retention is a material problem. They are not required for listener routing.

## Recommended Order

1. Add shadow-measured kind routing without changing delivery.
2. Enable opt-in routed subscriptions for Welshman's generic derived stores.
3. Migrate identified Budabit listeners that have safe kind constraints.
4. Validate physical mobile workloads and retain a fallback path.
5. Consider semantic query sharing only after routing measurements settle.
6. Consider richer routing keys only if remaining candidate fan-out justifies them.

## Non-Goals

- Replacing Svelte stores with RxJS.
- Replacing the Welshman repository with Applesauce's EventStore.
- Introducing a second canonical event store.
- Re-querying the repository on every update.
- Making notification delivery asynchronous inside one listener callback.
- Changing relay request ownership or scheduler behavior.
- Combining listener routing with deletion semantics changes.

## Success Measures

For the same captured workload and repository update sequence:

- Routed and legacy projections produce identical values.
- Every applicable target deletion and replacement reaches its target-kind listeners.
- The number of invoked listeners is materially lower than total registered listeners.
- Repository subscriber time and longest update task decrease on mobile.
- No increase occurs in stale views, missed updates, or post-navigation retained listeners.
- Diagnostics can distinguish total listeners, candidate listeners, invoked listeners, and
  fallback listeners.
