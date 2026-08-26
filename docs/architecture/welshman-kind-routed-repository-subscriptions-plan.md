# Welshman Kind-Routed Repository Subscriptions Plan

## Status

- Proposed phased implementation.
- Implements lesson 1 from `welshman-performance-lessons-from-applesauce.md`.
- Designed for incremental rollout with the existing global update path retained as fallback.

## Problem

`Repository.onUpdate` currently wraps a callback for diagnostics and registers it on one global
`update` emitter. Every update invokes every registered callback synchronously. Generic stores in
`@welshman/store` then scan additions with `matchFilters`, process removals by ID, and emit only if
their local state changed.

This makes downstream updates conditional but callback invocation unconditional. A broad or
accidentally dirty derived store can amplify a relay burst into sustained synchronous reactive
work.

Bounded repository admission limits burst size and yields between update batches, but one update
still fans out to every listener.

## Goals

- Avoid invoking listeners that cannot be affected by an update's kinds.
- Preserve exact current store values and deletion behavior.
- Preserve synchronous delivery for listeners selected by the router.
- Preserve update ordering, batching, reentrancy, and error behavior.
- Preserve subscriber attribution and add routing diagnostics.
- Roll out through an opt-in API before changing existing `onUpdate` behavior.
- Keep the first implementation limited to kind routing and a fallback bucket.

## Non-Goals

- Full NIP-01 filter routing by author, ID, address, tag, or time.
- Replacing `matchFilters` inside derived stores.
- Query interning or shared derived-store caching.
- Asynchronous or concurrent listener execution.
- Changing `RepositoryUpdate`'s public `{added, removed}` shape.
- Changing relay ingress batching or scheduler ownership.
- Changing deletion or replacement semantics.

## Correctness Invariants

### Additions

A routed listener must be invoked if any added event kind is in its routed kind set.

The listener still runs `matchFilters`, because a kind match alone does not establish author, ID,
tag, time, or limit relevance.

### Removals

A routed listener must be invoked if any removed target's kind is in its routed kind set.

This includes removals caused by:

- A kind-5 event.
- A newer replaceable event.
- `removeEvent`.
- `load` replacing repository contents.
- A merged batch containing any of the above.

Routing only from added kinds is incorrect. A kind-5 addition can remove a kind-30000 event, and a
kind-30000 listener must receive that update even if it does not subscribe to kind 5.

### OR Filters

Nostr filter arrays are OR branches. A listener is safely kind-routable only when every branch has
a non-empty `kinds` constraint.

For example:

```ts
;[{kinds: [1]}, {authors: [pubkey]}]
```

must use the fallback bucket because the second branch can match any kind.

### Unknown Affected Kinds

If the repository cannot determine all affected kinds, it must invoke fallback listeners and all
otherwise uncertain routed listeners. Routing must fail open, never suppress a possibly relevant
notification.

### Existing Delivery Semantics

- Listeners run synchronously and in stable registration order within the selected candidate set.
- A listener may unsubscribe itself during delivery.
- Reentrant publications remain queued behind the current update.
- A throwing listener preserves the current failure behavior.
- No listener is invoked more than once for one repository update, even when several kinds match.

## Proposed API

Keep `onUpdate` unchanged and add an opt-in sibling:

```ts
export type RepositoryUpdateRoute = {
  kinds: readonly number[]
}

repository.onRoutedUpdate(subscriber, route, listener)
```

An explicit sibling API is preferred over inferring behavior from
`RepositoryUpdateSubscriber.filters` because those filters are privacy-preserving diagnostic
summaries. They are capped and omit values. Diagnostic metadata must not become a correctness
input.

The generic store package should derive a route only when all filter branches have kinds:

```ts
const getKindRoute = (filters: Filter[]) => {
  if (filters.some(filter => !filter.kinds?.length)) return undefined
  return {kinds: Array.from(new Set(filters.flatMap(filter => filter.kinds!)))}
}
```

Stores without a safe route continue using `onUpdate` during migration. A later phase may make
both methods use one internal registry while preserving their public contracts.

## Internal Design

### Subscription Registry

Introduce repository-owned records with:

- Monotonic registration ID.
- Subscriber diagnostic metadata.
- Listener callback.
- Optional routed kind set.
- Active flag or identity-safe removal mechanism.

Maintain:

- A fallback ordered registry for legacy and unroutable listeners.
- A `Map<number, Set<registrationId>>` for kind-routed listeners.
- One registration table used to deduplicate candidates and preserve registration order.

Do not register routed listeners on the underlying global `update` emitter. During the migration,
legacy listeners may remain on the emitter or be represented in the same fallback registry.

### Affected-Kind Envelope

Do not add enumerable fields to public `RepositoryUpdate`; existing callers and tests compare its
exact shape.

Internally queue an envelope:

```ts
type PendingRepositoryUpdate = {
  update: RepositoryUpdate
  affectedKinds?: Set<number>
}
```

Every mutation path records kinds before data needed to identify a removed event is discarded.

- `publishNow`: added event kind, replaced event kind, and deleted target kinds.
- `removeEvent`: target kind before indexes are removed.
- `load`: kinds from added events and stale/removed events captured before clearing indexes.
- Batch merge: union all known affected kinds; remain unknown if any constituent is unknown.

The public listener still receives only `envelope.update`.

### Candidate Selection

For a fully known affected-kind set:

1. Add every fallback registration.
2. Add registrations from each affected kind bucket.
3. Deduplicate by registration ID.
4. Sort by registration ID.
5. Invoke each active callback once.

For unknown affected kinds, invoke all listeners.

The first implementation should not attempt to infer removal relevance from each listener's
current map. That would move store-specific state into the repository and complicate ownership.

### Diagnostics

Extend repository timing records with additive fields:

- `registeredListeners`.
- `candidateListeners`.
- `invokedListeners`.
- `fallbackListeners`.
- `routedListeners`.
- `affectedKinds` capped for diagnostics.
- `routingStatus`: `legacy`, `known`, or `unknown`.

Retain existing `listeners` while downstream diagnostics transition. Define it consistently as
invoked listener count or preserve its legacy meaning and document the new fields separately.

Subscriber timing continues to measure only invoked callbacks.

## Phases

### Phase 0: Contract Tests And Baseline

Add tests before routing behavior changes.

Cover:

- Added event of a matching kind.
- Added event of an unrelated kind.
- Delete event removing a target of another kind.
- Replaceable event removing the previous version.
- Explicit removal after the event leaves indexes.
- Repository `load` adding and removing several kinds.
- Target and delete in one batch.
- Nested batches.
- Reentrant publication.
- Self-unsubscription.
- Throwing listeners.
- One listener routed to multiple matching kinds but invoked once.
- OR filters with one unconstrained branch remaining unrouted.

Capture current physical or deterministic diagnostics for:

- Total active repository listeners.
- Update count and affected kinds.
- Per-listener invocation count.
- Subscriber duration by source.

Exit criteria:

- Existing semantics are represented by focused tests.
- A repeatable workload can compare candidate and actual listener counts.

### Phase 1: Affected-Kind Tracking In Shadow Mode

Add internal update envelopes and affected-kind collection, but continue invoking every listener.

Compute and report how many listeners would have been selected if kind routing were active.

Use shadow assertions in tests to compare expected candidate sets. In development diagnostics,
record unknown-kind fallbacks and the mutation path that produced them without logging event
content, pubkeys, IDs, or tag values.

Exit criteria:

- Every repository mutation path supplies complete affected kinds or deliberately marks them
  unknown.
- Shadow candidate selection never excludes a listener known to become dirty in focused tests.
- Production-style captures show a material candidate reduction.

### Phase 2: Opt-In Routed API

Add `onRoutedUpdate` and the kind/fallback registries.

Keep `onUpdate` on the legacy path. Initially migrate only synthetic tests and one low-risk generic
store fixture.

Verify:

- Registration ordering.
- Identity-safe unsubscribe.
- Timing attribution.
- Error propagation.
- Reentrant queue behavior.
- No duplicate invocation across kind buckets.

Exit criteria:

- Routed and legacy listeners observe identical relevant update sequences.
- The legacy API remains behaviorally unchanged.

### Phase 3: Migrate Generic Welshman Stores

Add a private `subscribeToRepositoryUpdates` helper in
`packages/welshman/packages/store/src/repository.ts`.

The helper:

- Builds a kind route only when every filter branch is kind-constrained.
- Calls `onRoutedUpdate` when safe.
- Falls back to `onUpdate` otherwise.
- Keeps diagnostic summaries separate from routing input.

Migrate:

- `deriveEventsById`.
- `makeDeriveEvent`, whose generated ID/address filters also contain target kinds only when they
  can be derived safely; otherwise leave it on fallback.
- `deriveEventsByIdByUrl`.
- `deriveEventsByIdForUrl`.
- `deriveItemsByKey`.
- `deriveIsDeleted`, routed by the target event's kind.

Do not change exact matching or map mutation logic in the same phase.

Exit criteria:

- All generic store tests pass against routed and fallback cases.
- Deleting a target updates its store without requiring kind 5 in the target filter.
- No application listener migration is required for correctness.

### Phase 4: Migrate Identified Application Listeners

Audit direct `repository.onUpdate` consumers in Budabit, including persistence, repository cache,
live feeds, calendar feeds, topics, and local adapters.

Migrate only listeners with a complete, stable kind constraint. Keep broad infrastructure
listeners in fallback when they genuinely consume all events.

Add source-level regression coverage for the community moderator profile-list filter so unrelated
kind-5 events cannot re-enter that projection.

Exit criteria:

- Every migrated listener documents or derives its safe kind route.
- Fallback listeners are enumerated with a reason.
- Physical Community and `/git` captures show lower invoked-listener counts and subscriber time.

### Phase 5: Consolidate The Legacy Path

After routed delivery is validated, implement both public APIs on one internal ordered registry.
`onUpdate` becomes an explicit fallback registration rather than an EventEmitter listener.

Retain `emit("update")` only if an external compatibility consumer requires it. Otherwise remove
the duplicate internal delivery mechanism in a separate commit with a repository-wide search and
tests.

Exit criteria:

- One registry owns ordering, unsubscribe, diagnostics, and delivery.
- No duplicate callback path remains.
- Existing public `onUpdate` callers continue to receive every update.

### Phase 6: Evaluate Further Routing

Stop after kind routing unless measurements show substantial remaining irrelevant fan-out.

If justified, evaluate one dimension at a time:

- Exact event ID.
- Exact replaceable address.
- Author.
- Kind-author pair.
- Tag key/value.

Each extension must retain a fallback and final exact matching. Do not implement a general query
planner speculatively.

## Verification

Run at minimum:

- `packages/welshman/packages/net/__tests__/repository.test.ts`.
- Store-package repository derivation tests.
- Community preference tests.
- Persistence and repository-cache tests for direct listeners.
- Type checking for affected packages and Budabit.
- Existing deterministic root performance harness.
- Physical mobile Community and `/git` workloads used in the performance journal.

Compare:

- Registered versus invoked listeners per update.
- Fallback listener count.
- Unknown affected-kind updates.
- Total repository subscriber time.
- Maximum subscriber update duration.
- Long-task time and largest task.
- Route settlement and navigation responsiveness.

## Rollback

- Keep a runtime or build-time switch that makes `onRoutedUpdate` register as legacy fallback
  during the first production validation.
- A routing failure should degrade to invoking more listeners, never fewer.
- Do not remove legacy `onUpdate` until routed physical captures and correctness tests settle.
- Keep affected-kind diagnostics after rollout so future repository mutation paths cannot silently
  bypass routing metadata.

## Completion Criteria

- Relevant store outputs are byte-for-byte or structurally equivalent to the legacy path.
- All repository mutation paths preserve removal-kind routing.
- No listener is missed for deletes, replacements, explicit removal, batches, or loads.
- Candidate listener count is materially lower in measured Community and `/git` workloads.
- The dominant cost no longer scales with every registered repository listener for a
  single-kind update.
- The implementation remains kind-only and substantially smaller than a general filter router.
