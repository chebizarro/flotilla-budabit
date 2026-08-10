# Welshman Repository Admission Plan

## Status

Proposed follow-up. Not implemented by the optimistic publication operations rollout.

## Objective

Replace ambiguous Welshman transport optimism with an explicit repository-admission policy after
all Budabit and Welshman callers have declared their intended behavior.

This plan is required before changing the current `publishThunk` default.

## Preconditions

- Keep the phase 8 inventory in
  [Optimistic Publication Operations Audit](./optimistic-publication-operations-audit.md) current.
- Migrate or explicitly retain every default-optimistic application and Welshman helper caller.
- Define settings-specific fresh-snapshot recovery for replaceable configuration events.
- Define workflow-owned recovery for compound and conditional publications.
- Separate outbound wrapped-rumor admission from inbound unwrap admission in `WrapManager`.
- Preserve explicit local-relay and direct Git local-first behavior.

## Proposed API Direction

Replace `optimistic?: boolean` with a required admission policy at shared transport boundaries, for
example:

```ts
type RepositoryAdmission = "optimistic" | "confirmed-only" | "none"
```

The final names and defaults must be chosen only after caller migration. `confirmed-only` must not
implicitly commit on thunk completion; callers still need an ACK/readback owner such as publication
operations. `none` is for transport whose workflow owns repository admission separately.

Inbound relay observation remains canonical admission and should not reuse the outbound enum.

## Delivery Phases

### Phase 0: Contract Tests

- Lock current boolean behavior for ordinary, signing-failure, retry, abort, and wrapped thunks.
- Add explicit tests for prepared-event and signed-event repository admission.
- Add `WrapManager` tests distinguishing outbound wrapping from inbound unwrap observation.
- Add local-adapter tests preserving intentional local admission.

### Phase 1: Explicit Policy Without Default Change

- Add the admission enum alongside the boolean.
- Reject conflicting boolean and enum options.
- Preserve current behavior when neither is supplied.
- Instrument or statically inventory implicit callers.

### Phase 2: Caller Migration

- Mark publication operations and ACK-gated helpers `confirmed-only` or `none` as appropriate.
- Mark settings and local-first snapshots explicitly `optimistic` until fresh-snapshot recovery exists.
- Mark compound workflow stages according to their workflow owner.
- Migrate Welshman command helpers and downstream consumers.

### Phase 3: Wrapped Admission

- Stop outbound `WrapManager.add` from unconditionally admitting rumors.
- Preserve inbound relay-observed unwrap admission.
- Retain exact wrapper identity for retry or explicitly keep wrapped flows outside generic retry.

### Phase 4: Require Explicit Admission

- Remove the compatibility boolean after all persisted and external callers are migrated.
- Make repository admission required at thunk construction boundaries.
- Consider a non-optimistic default only after the implicit-caller inventory reaches zero.

## Non-Goals

- Do not move workflow ordering into Welshman transport.
- Do not interpret timeout or thunk completion as confirmation.
- Do not make the repository an outbound operation journal.
- Do not alter direct Git recovery, settings intent, or local relay behavior without their own tests.

## Exit Criteria

- Every outbound thunk declares an admission policy.
- Wrapped outbound and inbound admission are independently tested.
- No caller depends on an implicit default.
- ACK-gated and operation-owned events cannot enter repository before confirmation.
- Settings, compound workflows, extensions, and direct transport retain documented ownership.
