# Welshman Kind-Routed Repository Subscriptions Plan

## Status

- Phases 0-5 implemented on 2026-08-26.
- Focused and full-suite correctness validation, deterministic root profiles, and physical desktop
  and mobile validation are complete.
- Implements lesson 1 from `welshman-performance-lessons-from-applesauce.md`.
- Phase 6 is not justified by the current measurements; kind-only routing remains the intended
  stopping point.

## Implementation Record

The implemented scope includes:

- Private affected-kind envelopes across immediate publication, nested and deferred batches,
  reentrant queues, repository loads, deletes, replacements, and explicit removals.
- `Repository.onRoutedUpdate` as an opt-in sibling to unchanged fallback `onUpdate` behavior.
- Routing diagnostics for registered, candidate, invoked, fallback, and routed listener counts.
- Safe kind-route derivation for generic `@welshman/store` repository projections.
- Explicit target-kind routing for `deriveIsDeleted`.
- Routed Budabit persistence, relay-provenance persistence, repository cache, calendar feed, and
  safely constrained live-feed listeners.
- Deliberate fallback delivery for the dynamic local-relay adapter, the all-kind topic index, and
  live feeds containing any OR branch without a kind constraint.
- Regression coverage for delete-target routing and unrelated community profile-list deletes.
- One ordered repository-owned registry for `onUpdate` fallback listeners and `onRoutedUpdate`
  kind-routed listeners, with no duplicate EventEmitter delivery path.
- Physical dispatch diagnostics, exact failed-update invocation counts, and multi-kind candidate
  deduplication.

Validation completed during implementation:

- Full Welshman suite: 499 passed, 1 skipped.
- Focused Budabit suite: 72 passed.
- `@welshman/net` and `@welshman/store` TypeScript builds.
- `pnpm check` with zero errors and warnings.
- `pnpm e2e:check`.
- Desktop and mobile-4x deterministic root performance profiles.
- Prettier and `git diff --check` for changed files.

### Physical Validation

Signed kind `30078` manifests and their Blossom artifacts were verified by event signature, exact
author and d-tag, SHA-256, byte count, gzip integrity, and diagnostics schema. Phase 4 used build
`dd63c37bc`; Phase 5 used build `ae3c0a42c`, whose repository dispatch implementation is commit
`6b710f08d`.

| Profile           | Phase 4 run         | Phase 5 run         |
| ----------------- | ------------------- | ------------------- |
| Desktop `/git`    | `mta6mc2x-6y9or57o` | `mtab3m0u-w647bvxb` |
| Desktop Community | `mta6o4qj-3ft5w0v0` | `mtab5hrs-fe7yadmk` |
| Mobile `/git`     | `mta6omtv-87by4nkw` | `mtab74iq-h58civv6` |
| Mobile Community  | `mta6qjs1-4jzrst0v` | `mtab8mu2-f7ny3lp0` |

For repository updates that crossed the diagnostics recording threshold, Phase 4 physically
entered every globally registered EventEmitter wrapper even though its inner route check selected
fewer logical callbacks. Phase 5 diagnostics measure the callbacks physically dispatched by the
unified registry.

| Community profile | Phase 4 physical callback entries | Phase 5 physical callbacks | Reduction |
| ----------------- | --------------------------------: | -------------------------: | --------: |
| Desktop           |                               502 |                         48 |     90.4% |
| Mobile            |                               380 |                         47 |     87.6% |

This directly validates the fan-out objective. It does not establish a general route-latency
improvement. All captures were service-worker controlled with effectively warm assets, and the
single-run settlement results were mixed:

| Profile           | Phase 4 settled | Phase 5 settled | Observed change |
| ----------------- | --------------: | --------------: | --------------: |
| Desktop `/git`    |          855 ms |          662 ms |      23% faster |
| Mobile `/git`     |          2.45 s |          2.72 s |      11% slower |
| Desktop Community |         18.45 s |         20.18 s |       9% slower |
| Mobile Community  |         34.55 s |         22.36 s |      35% faster |

Community settlement remained dominated by asynchronous widget and relay completion. Both Phase 5
`/git` captures exhausted the bounded background telemetry tail with community repository
announcements still unsettled, and desktop captures recorded unrelated NIP-46 relay timeouts.
These conditions make the wall-clock results unsuitable for a latency claim. At least three
compatible runs per phase, route, and profile would be required for one.

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
- Physical Community and `/git` captures show lower callback fan-out; subscriber and route timing
  remain supporting evidence rather than a required improvement.

### Phase 5: Consolidate The Legacy Path (Complete)

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

- A routing failure should degrade to invoking more listeners, never fewer.
- `onUpdate` remains the supported explicit fallback API in the unified registry.
- If a post-deployment correctness regression is found, revert the Phase 5 consolidation commit
  independently before changing routing semantics.
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
