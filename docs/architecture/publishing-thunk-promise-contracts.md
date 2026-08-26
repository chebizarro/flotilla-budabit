# Publishing Thunk State and Promise Contracts

## Purpose

This document records the current Welshman/Budabit publishing contracts for relay results,
publishing thunks, and acknowledgement waiters. It is intended as a reference for code that
must distinguish among:

- local optimistic publication;
- an individual relay attempt finishing;
- at least one selected relay accepting an event;
- every relay attempt reaching a terminal state;
- the thunk's `complete` promise settling.

These are separate events. Treating them as equivalent can cause an operation to commit local
state without a relay acknowledgement, wait longer than necessary, or wait forever after a
pre-transport failure.

Primary implementations:

- `packages/welshman/packages/net/src/publish.ts`
- `packages/welshman/packages/app/src/thunk.ts`
- `packages/welshman/packages/lib/src/Deferred.ts`

## Executive Summary

- There is no `thunk.failure` promise or immutable aggregate thunk outcome.
- `thunk.results` is the current per-relay state and can contain mixed outcomes.
- `thunk.complete` is a lifecycle signal, not a success signal.
- `thunk.complete` resolves after the normal aggregate `publish()` path finishes, including when
  every relay NACKs or times out.
- `thunk.complete` does not currently settle on every terminal path. Signing failures, setup
  failures, wrapping failures, and aborts before transport starts can leave it pending forever.
- `waitForThunkCompletion()` follows terminal thunk state and therefore covers several paths that
  `thunk.complete` misses, but it does not establish relay acceptance.
- `waitForAnyRelayAck()` is the explicit contract for "at least one selected relay accepted this
  event." It resolves earlier than aggregate completion and returns the accepting relay.
- `waitForAnyRelayAck()` is implemented from thunk state and subscriptions. Replacing it with a
  one-time state check or `await thunk.complete` is not equivalent.

## Outcome Layers

### Local Event Visibility

`publishThunk()` enqueues a thunk and, unless `optimistic` is `false`, immediately inserts its
prepared event into the local repository. For unsigned events, that optimistic event is later
replaced by the signed event.

Local repository visibility is not evidence that any relay received or accepted the event.

Relevant code:

- optimistic insertion: `packages/welshman/packages/app/src/thunk.ts:228-246`
- replacement after signing: `packages/welshman/packages/app/src/thunk.ts:202-221`
- queue delay: `packages/welshman/packages/app/src/thunk.ts:451-459`

### Per-Relay Attempt

`publishOne()` represents one event/relay attempt. A matching Nostr `OK` message must contain the
exact event ID. `OK true` produces `Success`; `OK false` produces `Failure`.

Normal protocol failures, timeouts, and active aborts are fulfilled `PublishResult` values. They
are not promise rejections.

Relevant code: `packages/welshman/packages/net/src/publish.ts:35-106`.

### Aggregate Network Publication

`publish()` starts one `publishOne()` call per configured relay and awaits them with
`Promise.all()`. On the normal path it returns a record keyed by relay URL.

```ts
type PublishResultsByRelay = Record<string, PublishResult>
```

An aggregate result may contain any mix of Success, Failure, Timeout, and Aborted results. The
aggregate `onComplete` callback receives only the last completing relay's `PublishResult`, not the
full result record.

Relevant code: `packages/welshman/packages/net/src/publish.ts:108-160`.

### Thunk Lifecycle

A `Thunk` wraps event preparation, signing, optional wrapping and proof of work, optimistic local
state, queueing, network publication, retry state, and cancellation.

Its public result-related fields are:

```ts
event: HashedEvent
results: PublishResultsByRelay
complete: Deferred<void>
controller: AbortController
```

There is no single authoritative event-level success/failure field.

## Publish Statuses

`PublishStatus` is defined in `packages/welshman/packages/net/src/publish.ts:6-13`.

| Status    | Meaning                                                                                                                        | Terminal for thunk state? |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------: |
| `Sending` | Initial state. The thunk may be queued, signing, wrapping, calculating proof of work, or waiting through its configured delay. |                        No |
| `Pending` | `publishOne()` has obtained an adapter and started the relay attempt.                                                          |                        No |
| `Success` | The relay returned an exact-event-ID `OK true`.                                                                                |                       Yes |
| `Failure` | The relay returned `OK false`, or the thunk synthesized failure after signing, wrapping, setup, or transport errors.           |                       Yes |
| `Timeout` | The attempt remained pending until its timeout. The default is 10 seconds.                                                     |                       Yes |
| `Aborted` | An active attempt was aborted, or the thunk controller replaced relay state with Aborted.                                      |                       Yes |

The normal transition is:

```text
Sending -> Pending -> Success | Failure | Timeout | Aborted
```

Some failures skip `Pending`:

```text
Sending -> Failure
Sending -> Aborted
```

State completeness means only that no result remains Sending or Pending:

```ts
const thunkIsComplete = (thunk: AbstractThunk) =>
  !thunkHasStatus([PublishStatus.Sending, PublishStatus.Pending], thunk)
```

Consequences:

- every terminal status counts as complete;
- complete state does not imply relay acceptance;
- a zero-relay thunk is state-complete immediately;
- state completeness and `thunk.complete` settlement are not equivalent.

## Promise Contracts

| API                                  | Fulfills when                                                                                                      | Fulfilled value                                        | Rejects when                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `publishThunk(options)`              | Not a promise; returns after constructing and enqueueing the thunk.                                                | `Thunk`                                                | It can throw synchronously when construction requirements are not met, such as no signer or pubkey.                  |
| `publishOne(options)`                | One relay attempt terminates normally through ACK, NACK, timeout, or active abort.                                 | `PublishResult`                                        | Setup or execution code throws, such as adapter creation or send setup.                                              |
| `publish(options)`                   | Every mapped `publishOne()` fulfills.                                                                              | `PublishResultsByRelay`                                | Any `publishOne()` rejects. Other already-started attempts are not automatically cancelled.                          |
| `Thunk.publish()`                    | Normal publication returns, a pre-start internal abort is observed, or an unwrapped signing/PoW failure is caught. | `undefined`                                            | Wrapping or underlying `_publish()` exceptions escape its limited catch. The queue catches them and calls `_fail()`. |
| `thunk.complete`                     | `_publish()` successfully awaits aggregate `publish()`.                                                            | `undefined`                                            | It has no internal rejection path. Several abnormal paths leave it pending.                                          |
| `waitForThunkCompletion(thunk)`      | No result remains Sending or Pending.                                                                              | `undefined`                                            | Never rejects.                                                                                                       |
| `waitForThunkError(thunk)`           | The first Failure appears, or state becomes complete without Failure.                                              | Failure detail, or `""` when complete without Failure. | Never rejects.                                                                                                       |
| `waitForAnyRelayAck(thunk, targets)` | A selected target has Success.                                                                                     | That target's `PublishResult`.                         | Targets are empty, or every target is terminal/missing without Success.                                              |

## The `complete` Contract Gap

`complete` is created at `packages/welshman/packages/app/src/thunk.ts:43-45` and has one internal
settlement point:

```ts
await publish(...)
this.complete.resolve()
```

See `packages/welshman/packages/app/src/thunk.ts:140-165`.

### Paths That Resolve `complete`

The normal aggregate path resolves `complete` after all attempts finish, regardless of their
result values. This includes:

- all relays accepting;
- all relays NACKing;
- all relays timing out;
- mixed success and failure outcomes;
- abort after relay attempts are active and finish through normal abort cleanup;
- zero relays after the queued `_publish()` path runs.

### Paths That Can Leave `complete` Pending

The following paths can make state terminal without reaching `complete.resolve()`:

- the thunk is aborted before queue processing starts;
- the thunk is aborted while signing, calculating proof of work, or waiting through `delay`;
- signing or proof of work fails;
- private-event wrapping fails;
- adapter creation or transport setup throws;
- aggregate `publish()` rejects;
- a user-supplied lifecycle callback throws before transport cleanup and promise resolution.

In several of these paths `_fail()` marks every relay Failure. In abort paths, the controller
marks relays Aborted. A state-based waiter can therefore settle while `complete` remains pending.

`complete` is a `Deferred<void>`, so it technically exposes `.resolve()` and `.reject()`. The thunk
implementation never calls `.reject()`. External code should not mutate those deferred methods;
they are not an outcome API.

## Failure APIs and Their Limits

### Per-Relay Failure Callback

`onFailure` runs for a relay NACK and receives that relay's `PublishResult`. It is not an aggregate
failure callback. Synthetic `_fail()` paths also do not invoke `onFailure` for each relay.

### Failed Relay URLs

`getFailedThunkUrls()` includes only Failure and Timeout:

```ts
getThunkUrlsWithStatus([PublishStatus.Failure, PublishStatus.Timeout], thunk)
```

Aborted relays are excluded. See `packages/welshman/packages/app/src/thunk.ts:338-339`.

### Thunk Error Waiter

`waitForThunkError()` is not a general failure promise:

- it resolves as soon as the first explicit Failure appears, even if another relay remains pending
  and later succeeds;
- it ignores Timeout and Aborted as errors;
- it resolves with an empty string when all relays are terminal without a Failure;
- it never rejects.

It should not be used to enforce "at least one relay accepted" or "all relays succeeded."

### Final Current-State Inspection

The closest current mechanism for obtaining all terminal relay states is:

```ts
await waitForThunkCompletion(thunk)

const results = thunk.results
const accepted = Object.values(results).filter(result => result.status === PublishStatus.Success)
```

This is still a snapshot of mutable current state, not immutable publication history.

## Relay Acknowledgement Contract

`waitForAnyRelayAck()` is implemented in
`packages/welshman/packages/app/src/thunk.ts:385-445`.

Its behavior is:

- use `thunk.options.relays` by default;
- deduplicate explicit target relays;
- resolve with the first observed target Success;
- ignore Success from relays outside the target set;
- continue waiting while any target is Sending or Pending;
- reject after every target is terminal or missing without Success;
- reject immediately for an empty target list;
- return the successful `PublishResult`, including relay identity and detail;
- install no separate timer, relying on the relay attempts to reach Timeout or another terminal
  state.

A missing target is treated as terminal and reported as `no result`. If the helper is called after
multiple targets are already successful, it returns the first successful relay in target-list
order, not necessarily the chronologically first ACK.

### Why `complete` Cannot Replace ACK Waiting

`await thunk.complete` differs from `waitForAnyRelayAck()` in several ways:

- it waits for all normal attempts rather than the first selected Success;
- it resolves when no relay accepted;
- it does not reject on no ACK;
- it can remain pending after state-terminal pre-transport errors;
- it returns no accepting relay identity.

The distinction is covered explicitly in
`src/app/core/git-commands.test.ts:919-939`: thunk completion without relay Success must not count
as acknowledgement.

### Why a One-Time State Read Cannot Replace ACK Waiting

A direct status check answers only the current instant. It cannot distinguish "not yet accepted"
from "all targets have terminated without acceptance" unless the caller also implements terminal
state checks and subscribes to future changes.

`waitForAnyRelayAck()` is itself derived entirely from thunk state and `subscribe()`. Replacing the
helper with state is technically possible, but doing so means reimplementing its target filtering,
terminal-state policy, subscription cleanup, and error behavior.

### ACK History Versus Mutable State

Current thunk state is not durable evidence that a Success ever occurred:

- `abortThunk()` writes Aborted to every configured relay, including relays that previously
  succeeded;
- `_fail()` writes Failure to every configured relay and can overwrite earlier state;
- one aggregate attempt can reject while other attempts remain active.

An ACK promise that already resolved preserves the earlier observation even if later state is
overwritten. This is one reason correctness-sensitive operations should create the ACK waiter as
part of the active publishing transaction rather than inspect state much later.

## Current Policy Patterns

Different callers intentionally enforce different publication policies.

### First Selected ACK

Linked publication, event replacement, repository operations, and community writes use
`waitForAnyRelayAck()` before committing local state or starting a dependent publication stage.
Some flows require the returned relay identity so the next event is sent to the same relay.

Example: `src/app/core/publication-operations.ts` linked publication stages.

### All Attempts Terminal, Then Inspect

Some settings flows use `waitForThunkCompletion()` and then require at least one Success.

Example: `src/app/core/repo-watch.ts:211-230`.

### Normal Aggregate Completion, Then Inspect

Some extension bridge flows await `thunk.complete` and then count Success entries. This establishes
the desired acceptance policy on normal transport outcomes, but remains vulnerable to the
non-settling `complete` paths listed above.

Example: `src/app/extensions/bridge.ts:562-603`.

### UI Interpretation

The primary thunk toast considers publication successful when state is complete and at least one
relay has Success. Timeout and Failure are displayed as failures; abort is handled separately.

Example: `src/app/components/ThunkToast.svelte:20-47`.

## Merged Thunks

`MergedThunk` combines child result state but has no `complete`, `failure`, controller, single
event, or promise outcome API. Promise helpers accept a concrete `Thunk`, while status helpers
generally accept `AbstractThunk`.

For a relay represented by multiple children, merged status selection has the effective
precedence:

```text
Success > Sending > Pending > Timeout > Failure > Aborted
```

This projection can display Success for a relay while another child attempt for that relay is
still pending. Code requiring exact child completion should flatten and inspect the child thunks
rather than infer it solely from merged relay status.

Relevant code: `packages/welshman/packages/app/src/thunk.ts:260-309`.

## Additional Edge Cases

### Duplicate Relay URLs

`publish()` warns when relay URLs are not unique, but still starts one attempt per array entry while
storing results by URL. Duplicate attempts can overwrite each other's state and make target-state
inspection appear terminal before every duplicate attempt finishes. Callers should normalize and
deduplicate relay lists before publication.

### Already-Aborted External Signals

`publishOne()` installs an abort listener but does not first check `signal.aborted`. A signal that
was already aborted before listener installation may still allow the event to be sent and leave the
attempt pending until timeout.

### Callback Exceptions

Lifecycle callbacks are not guarded. A throwing callback can prevent state notification, adapter
cleanup, or promise resolution. Internal lifecycle settlement should not depend on consumer
callbacks returning normally.

### Abnormal Subscription Retention

`waitForThunkCompletion()` and `waitForThunkError()` do not unsubscribe themselves after resolving.
Normal aggregate completion clears thunk subscriptions, but abnormal paths that only call `_fail()`
can retain already-resolved subscriber closures.

## Recommended Future API Boundaries

Keep lifecycle termination, aggregate outcome, and early relay acknowledgement as distinct
contracts.

### Lifecycle Completion

Make `complete` settle on every path where the thunk has concluded, including signing, wrapping,
setup, and pre-transport abort paths. Its meaning should remain "this attempt is finished," not
"this event was accepted."

Centralized finalization should ensure state update, subscriber notification, and lifecycle
settlement happen exactly once.

### Structured Aggregate Outcome

Prefer an always-settling structured outcome over `thunk.failure`. A failure-only promise is
ambiguous for partial multi-relay success and would have no useful settlement behavior on success.

An outcome could contain:

```ts
type ThunkOutcome = {
  status: "success" | "partial" | "failure" | "aborted"
  results: PublishResultsByRelay
  acceptedRelays: string[]
  failedRelays: string[]
}
```

The result should be an immutable final snapshot so later abort or retry activity cannot erase
historical acknowledgement evidence.

### Early ACK Waiter

Retain `waitForAnyRelayAck()` or an equivalent relay-policy waiter. A final outcome cannot replace
its early settlement timing or its accepting-relay identity.

If broader policies are needed, build them explicitly rather than overloading `complete`:

- any selected relay accepted;
- every selected relay accepted;
- at least N selected relays accepted;
- all selected relays reached terminal state.

## Test Coverage Priorities

Existing tests cover normal Success, Failure, Timeout, mixed aggregate results, ACK target
filtering, missing targets, signing/setup failure state, and successful `complete` settlement.

Future contract work should add focused tests for:

- `complete` after all NACKs;
- `complete` after all timeouts;
- active abort versus pre-publish abort;
- signing, wrapping, and setup failure settlement;
- `waitForThunkCompletion()` and `waitForThunkError()` semantics;
- Success overwritten by later abort or synthetic failure;
- duplicate relay behavior;
- callback exceptions;
- already-aborted external signals;
- merged thunk completion and status precedence.

Relevant existing tests:

- `packages/welshman/packages/net/__tests__/publish.test.ts`
- `packages/welshman/packages/app/__tests__/thunk.test.ts`
- `src/app/core/publication-operations.test.ts`
- `src/app/core/event-edit-publish.test.ts`
- `src/app/core/git-commands.test.ts`
