# Optimistic Publication Operations Plan

## Status

Phases 1 through 3 are implemented: the operation core and route-independent recovery are active,
and community room messages use retained operation previews until relay confirmation. Remaining
publishing call sites stay isolated so they can be migrated without changing excluded workflows.

## Objective

Decouple optimistic event presentation from the canonical event repository.

Budabit should be able to:

- Show an event immediately while it is signing or being sent.
- Commit an outbound event to `repository` only after a qualifying relay confirms it.
- Keep authored content visible with a failure annotation when confirmation is missing.
- Roll back optimistic mutations such as reactions and stars when confirmation is missing.
- Retry signing or relay publication through a global, route-independent recovery toast.
- Preserve feature-specific relay selection and confirmation rules.
- Migrate safe single-event flows incrementally without changing complex workflows.

## Non-Goals

- Do not build a second Nostr repository for pending events.
- Do not persist pending operations or retry callbacks through a hard reload.
- Do not change direct Git repository transport, repository creation, import, fork, GRASP, or Git
  remote operations.
- Do not make generic child-thunk retry responsible for compound workflows.
- Do not migrate NIP-59 direct messages until wrapped-event repository behavior is separately
  addressed.
- Do not change extension or extension-settings publication in this plan.
- Do not change already ACK-gated edit, delete, moderation, badge, profile, or linked-publication
  workflows unless explicitly listed in a later phase.
- Do not make `thunk.complete` a success signal.
- Do not claim that a timeout proves a relay did not accept an event.

## Problem Statement

`publishThunk` currently inserts an event into `repository` unless `optimistic: false` is supplied.
That makes a transport attempt look like canonical event state before a relay has acknowledged or
served the event.

This coupling is unsafe because repository insertion is not a reversible preview operation:

- Replaceable events supersede previous values and update replacement indexes.
- Delete events add tombstones that are not reversed by removing the delete event.
- Repository-derived stores can treat an unconfirmed event as current state.
- Selected repository events are persisted to IndexedDB independently of whether their outbound
  attempt received an ACK.
- The in-memory thunk that explains the optimistic event disappears on hard reload, while the
  repository event may remain.

`tracker` is useful positive evidence that an event was acknowledged or observed at a relay. It is
not a publication-outcome journal: it does not represent terminal failure, the current retry
attempt, signing failure, or workflow ownership.

## Architectural Decision

Use three separate concepts:

```text
repository                 confirmed or relay-observed canonical events
publicationOperations      in-memory outbound operation state
feature projection         repository state plus selected optimistic previews
```

`publicationOperations` is not a second repository. It is a bounded runtime registry of outbound
work. It has no Nostr filter engine, replaceable-event indexes, delete semantics, persistence, or
general event-loading API.

Each feature decides how an operation affects its UI. Network and repository behavior remain
shared.

## Core Invariants

1. A migrated outbound event is never inserted into `repository` before confirmation.
2. A qualifying `OK true` ACK is confirmation.
3. Observing the same event from a qualifying relay is also confirmation.
4. Signing success, socket send, relay pending, timeout, and `thunk.complete` are not confirmation.
5. The first qualifying confirmation commits the logical event to `repository` at most once.
6. A terminal attempt without confirmation remains outside `repository`.
7. A terminal attempt without confirmation is called `unconfirmed`, not necessarily unpublished.
8. Retrying a signed event reuses the exact signed event.
9. Retrying a signing failure retries signing for the same prepared event and original owner.
10. Retry is blocked when the active account differs from the operation owner.
11. Feature previews are projections of operation state, never repository side effects.
12. Discard removes operation and preview state but never claims to retract relay publication.
13. Partial relay failure is success when the operation's confirmation policy requires any one of
    the qualifying relays and at least one qualifies.
14. Compound workflows retain their own stage ordering and commit rules.

## Confirmation Semantics

The first implementation uses an any-eligible-relay policy:

- `relays` is the transport destination set.
- `confirmRelays` is the subset whose ACK or readback can confirm the operation.
- `confirmRelays` defaults to `relays`.
- An empty confirmation set fails before publication begins.
- One success from `confirmRelays` commits the event.
- Failures from non-confirmation relays do not prevent a confirmed commit.

Workflows requiring all relays, ordered stages, readback verification, or a required relay selected
by an earlier stage stay outside the simple operation API.

## Proposed Application API

Add `src/app/core/publication-operations.ts`.

The first implementation wraps existing Welshman thunks instead of changing their default:

```ts
type PublicationPreviewPolicy = "retain-on-failure" | "rollback-on-failure" | "none"

type PublicationPhase = "publishing" | "confirmed" | "unconfirmed" | "cancelled"

type StartPublicationOptions = {
  event: EventTemplate
  relays: string[]
  confirmRelays?: string[]
  label: string
  href?: string
  semanticKey?: string
  preview: PublicationPreviewPolicy
}

type PublicationSnapshot = {
  operationId: string
  ownerPubkey: string
  label: string
  href?: string
  semanticKey?: string
  event: HashedEvent
  phase: PublicationPhase
  preview: PublicationPreviewPolicy
  attempt: number
  results: PublishResultsByRelay
  error?: string
}

type PublicationHandle = {
  operationId: string
  settled: Promise<PublicationSnapshot>
}

declare const publicationOperations: Readable<Map<string, PublicationSnapshot>>

declare function startPublication(options: StartPublicationOptions): PublicationHandle
declare function retryPublication(operationId: string): Promise<PublicationSnapshot>
declare function cancelPublication(operationId: string): void
declare function discardPublication(operationId: string): void
declare function clearPublicationOperations(): void
declare function isPublicationPreviewVisible(operation: PublicationSnapshot): boolean
```

`clearPublicationOperations` supports account/session teardown and deterministic tests. It must not
be exposed as a general UI action.

## Internal Runtime State

Public snapshots remain serializable and presentation-safe. A private runtime map additionally
retains:

- The current thunk.
- The current attempt generation.
- The original owner pubkey.
- The exact event after signing.
- Thunk subscription cleanup.
- Whether repository commit already occurred.
- Whether a toast was emitted for the current failed generation.
- Any in-flight retry promise.

Signer objects, adapter contexts, callbacks, and private event payloads must not be persisted.

## Start Lifecycle

`startPublication` performs these steps:

1. Validate relay and confirmation-relay sets.
2. Create the thunk with `optimistic: false`.
3. Capture its owner and prepared event.
4. Register a `publishing` operation immediately.
5. Subscribe to the attempt directly.
6. Wait for the first qualifying ACK through `waitForAnyRelayAck`.
7. On confirmation, publish the signed logical event to `repository` exactly once.
8. Mark the operation `confirmed` and retain it briefly so feature projections can hand off to
   repository state without flicker.
9. When all qualifying relays become terminal without success, mark the operation `unconfirmed`.

The global `thunks` writable only changes when thunks are appended or removed. Per-relay status
mutations notify the thunk's subscribers, not the containing writable. The implementation must not
depend on a Svelte effect over `$thunks` to notice terminal outcomes.

## Retry Lifecycle

`retryPublication` performs these steps:

1. Require an existing `unconfirmed` operation.
2. Reject duplicate concurrent retries.
3. Verify the active pubkey still equals `ownerPubkey`.
4. Recover the active NIP-46 receiver when applicable.
5. Recheck operation generation, phase, and active account after asynchronous recovery.
6. Call `retryThunk` for the current attempt.
7. Preserve `operationId` and increment `attempt`.
8. Replace the current thunk subscription.
9. Return the same logical operation to `publishing`.
10. Apply normal confirmation or unconfirmed handling to the new attempt.

For an already signed event, `retryThunk` must resend the exact event. For a signing failure, retry
must sign the same prepared event with the operation owner's signer. NIP-59 exact-wrapper retry is
not covered by this phase.

## Cancel And Discard

Cancel applies only while an attempt is in progress:

- Abort the current thunk.
- Remove the operation from feature previews.
- Do not remove or alter repository state.
- Do not claim that an already-sent event was retracted.

Discard applies to an unconfirmed operation:

- Remove it from the operation registry.
- Remove retained-on-failure previews.
- Leave rollback-on-failure features on their canonical repository state.
- Do not publish a delete or compensation event.

Closing a toast is notification dismissal, not operation discard.

## Preview Policies

### `retain-on-failure`

Visible while `publishing` and `unconfirmed`.

Use for authored content where preserving the user's work and exposing an inline retry is useful:

- Room messages.
- Thread roots and replies.
- Goal comments.
- Calendar comments.
- Safe single-event goal/calendar creation surfaces when migrated.

On confirmation, repository state takes over. On discard, the preview disappears.

### `rollback-on-failure`

Visible only while `publishing`.

Use for desired-state mutations where showing an unconfirmed result as committed would be
misleading:

- Reaction creation.
- Reaction deletion.
- Community star and unstar.
- Future isolated personal repository-star mutations.

On an unconfirmed attempt, the feature projection returns to repository state. Retrying returns the
operation to `publishing`, reapplying the preview.

### `none`

Never exposed as an event preview.

Use when a form, modal, or another domain-specific draft already represents pending work. The
operation may still participate in global recovery.

## Feature Projection Rules

Feature projections should consume narrow selectors, not a generic pending-event repository.

Examples:

- Room messages select operations whose event kind/tags match the active room and whose policy is
  visible for the current phase.
- Thread pages select matching root/comment operations and merge by event ID before parsing.
- `ReactionSummary` overlays reaction additions and target-reaction deletions by author, target, and
  emoji semantic key.
- Star buttons overlay a desired boolean keyed by owner plus community/repository address.

Every projection deduplicates by event ID against repository-derived events. A confirmed operation
must not render twice during the handoff grace period.

## Global Recovery Toast

Mount one publication-recovery observer beside the existing toast renderer in `AppContainer`.

The observer watches `publicationOperations`, not `repository` or historical thunks.

On transition to `unconfirmed`:

- Push a persistent toast once per operation attempt.
- Use neutral wording: `Publication was not confirmed by any relay.`
- Display the operation label.
- Offer Retry.
- Offer View when a stable `href` exists.
- Keep the operation after the toast is closed.

On retry:

- Update the existing logical operation.
- Reapply feature previews according to their policy.
- Show retry progress in the toast component.
- On confirmation, show a short generic `Published` state and dismiss.
- On another unconfirmed result, update the same recovery item rather than creating an unrelated
  operation.

The existing three-toast cap is acceptable for the first rollout. The operation store intentionally
leaves room for a later recovery tray or badge without changing publication semantics.

## Late Confirmation And Readback

An event can be accepted even when its ACK is lost. The operation layer should listen for positive
tracker evidence:

- When `tracker` adds a qualifying relay for the operation event ID, treat the operation as
  confirmed.
- If the incoming event is already in `repository`, do not insert it twice.
- If the operation still owns a signed logical event and repository does not contain it, commit it.
- Clear stale failure UI after reconciliation.

No negative tracker state should be interpreted as proof of failure.

## Session And Account Boundaries

Operations are memory-only:

- They survive SvelteKit SPA navigation.
- They disappear on hard reload.
- They are not restored automatically from IndexedDB or session storage.
- A later relay load may legitimately make a previously unconfirmed event appear as canonical.

On account change:

- Hide previews owned by other accounts.
- Block retry with instructions to restore the original account.
- Clear active operations on full logout/session removal.
- Never sign a prepared event owned by one account with another account's signer.

Durable retry is a separate future project requiring a serializable event outbox, workflow versioning,
account restoration, stale-intent detection, private-event handling, and exact wrapper retention.

## Safe Migration Scope

### Authored Content: Retain On Failure

| Flow                                | Current publication               | Migration notes                                                                                                      |
| ----------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Community room message              | Single kind `9` thunk             | Existing room candidate merge is the reference projection. Replace repository optimism with operation previews.      |
| Current thread creation             | Single kind `11` thunk            | Add pending root projection to thread list/detail so navigation does not lose the item.                              |
| Compose-menu thread creation        | Single kind `11` thunk            | Reuse the same thread projection.                                                                                    |
| Repository-activity thread creation | Single thread event               | The Nostr thread publication is standalone even though its source item is Git activity. Do not change Git transport. |
| Thread reply                        | Single kind `1111` thunk          | Merge operation previews into thread replies and retain unconfirmed replies.                                         |
| Goal comment                        | Single kind `1111` thunk          | Merge operation previews into detail activity.                                                                       |
| Calendar comment                    | Single kind `1111` thunk          | Merge operation previews into detail activity.                                                                       |
| Compose-menu goal creation          | Single goal event                 | Safe as a standalone exact-event operation; keep separate from current linked goal creation.                         |
| Compose-menu calendar creation      | Single addressable calendar event | Add a current-address guard before retry if a newer edit exists. Keep calendar edits unchanged.                      |

### Mutations: Roll Back On Failure

| Flow                           | Current publication                                | Migration notes                                                                                                  |
| ------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Reaction creation              | Single kind `7` thunk through `publishReaction`    | Centralize optimistic addition in `ReactionSummary`; repository remains committed-only.                          |
| Reaction removal               | Single kind `5` delete targeting kind `7`          | Suppress the target only while publishing; restore on unconfirmed outcome.                                       |
| Community star                 | Single kind `7` reaction                           | Render desired starred state from operation while publishing.                                                    |
| Community unstar               | Single kind `5` delete targeting the star reaction | Restore committed star on unconfirmed outcome.                                                                   |
| Git issue/comment/PR reactions | Single repo-scoped reaction or reaction delete     | Safe when migrated through explicit reaction call sites; preserve repo relay scope and exclude collection stars. |

### Independent Governance Events

| Flow                           | Current publication                              | Migration notes                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Moderator invite responses     | One profile-list response per pending invitation | Responses from one click are independent. Register each exact operation without retrying the whole action. Add a latest-address guard before retry.                                       |
| Community report-review labels | One kind `1985` label per report                 | Labels are independent. Remove the current failed-event repository purge and retain failure only in operation state. Avoid presenting one child retry as recovery for unrelated children. |

These governance migrations occur after the single-event operation and toast behavior are proven on
social content.

## Excluded Workflows

### Already ACK-Gated Or Verified

These are non-related to the repository-optimism migration and should not receive duplicate global
child-thunk handling:

- Current linked goal creation.
- Current linked calendar creation.
- Event/message/comment edits.
- Generic content deletion confirmations.
- Report creation and report deletion.
- Direct messages.
- Community room creation.
- Admission forms and applications.
- Moderation reports, bans, and report removal.
- Badge definitions, awards, acceptance, revocation, and opt-out.
- Profile publication and verified community updates.
- Git comments, labels, statuses, and deletes already using ACK-gated helpers.
- Email-digest publication.

### Unsafe Compound Or Conditional Operations

These require workflow-level recovery rather than generic event retry:

- Admission Grant, which publishes profile-list and review events and may first publish a community
  definition update.
- Admission Reject/Revoke when it publishes a profile-list replacement followed by a review.
- Admin moderator acceptance/revocation chains.
- Community repository announcement plus targeting association.
- Community permalink plus targeting association.
- Widget publication plus community targeting changes.
- Community repository collections, where community add/remove requires paired star and targeting
  operations.
- Issue/PR creation coupled to initial status publication.
- PR applied/merge workflow publication.
- Demo Day multi-stage application workflow.

The review-only admission rejection branch is mechanically single-event, but the same call site is
conditionally part of a dependent two-event operation. It remains excluded until operation metadata
can prove the standalone branch.

### Replaceable Settings And Local-First State

Exact retry of an old full snapshot can restore stale intent or publish an intermediate state. Keep
these outside the first operation rollout:

- App settings and mute/relay-list replacements.
- Blossom server-list replacement.
- Trusted-relay settings.
- Repository-watch settings.
- Git-auth backup settings.
- Extension settings.
- Extension install, enable, disable, update, and uninstall synchronization.

Extension settings are especially unsafe for generic exact retry because install-and-enable can
create an installed-but-disabled intermediate snapshot followed by a second enabled snapshot. A
future settings-specific API should publish a fresh current snapshot with monotonic replacement
timestamps and an ACK check.

### Repository And Git Transport

Keep all direct/custom repository transport outside this plan:

- New repository creation.
- Repository import and fork.
- Durable repository-creation recovery.
- Repository announcement and state transport.
- GRASP publication and verification.
- Branch-state synchronization.
- Remote repair/backfill.
- Repository rollback and full repository deletion.
- Git push, clone, remote, and filesystem operations.

An ordinary Nostr reaction attached to a Git issue/comment remains eligible because it uses the
single-event reaction path, not custom repository transport.

### Extensions And Wrapped Events

- Generic extension `nostr:publish`.
- Shared extension configuration.
- Widget iframe optimistic state.
- Pipelines extension publication.
- NIP-59 direct messages and other wrapped events.

The host can adopt the operation API later, but this plan makes no extension-specific changes.
Wrapped events require a lower-level fix because `WrapManager` currently introduces repository side
effects even when the thunk is configured with `optimistic: false`.

## Phased Delivery

## Phase 0: Red Contract Tests

### Goal

Lock the simple operation contract before production implementation.

### Tests

- `startPublication` always creates a non-optimistic thunk.
- An empty confirmation set fails before a thunk is created.
- Repository insertion does not occur before confirmation.
- The first qualifying ACK commits exactly once.
- `confirmRelays` is passed to the ACK waiter.
- A terminal unconfirmed attempt remains registered and outside repository.
- Retry reuses the exact event and logical operation ID.
- A signing failure retries signing for the same prepared event.
- Retry commits after a later ACK.
- Retry is blocked after an account change.
- Discard removes the operation without repository mutation.
- Cancel aborts in-flight work without repository mutation.
- Preview visibility follows retain, rollback, and none policies.

### Exit Criteria

- Architecture plan exists.
- Red tests compile as soon as `publication-operations.ts` exists.
- Before implementation, the focused test command fails because the planned module/API is absent.
- No production file is added or modified.

## Phase 1: Publication Operation Core

### Goal

Implement the in-memory single-event operation lifecycle.

### Steps

- Add `publication-operations.ts` with readonly snapshots and private runtime state.
- Wrap `publishThunk` with `optimistic: false`.
- Subscribe to each current attempt.
- Commit once after a qualifying ACK.
- Implement retry, cancel, discard, account guards, and test/session cleanup.
- Implement preview visibility helper.
- Reconcile positive tracker evidence.
- Keep confirmed operations for a short handoff grace period, then clean them up.

### Exit Criteria

- Phase 0 tests pass.
- No migrated flow inserts into repository before ACK.
- No change to `publishThunk` default behavior.
- No UI migration yet.

## Phase 2: Global Recovery Toast

### Goal

Provide route-independent recovery for registered operations.

### Steps

- Add a toast child component keyed by `operationId`.
- Observe operation phase transitions at the app shell.
- Push one persistent toast per unconfirmed attempt generation.
- Wire Retry to `retryPublication`.
- Add View when an operation has a stable route.
- Use `Published` and `not confirmed` event-generic copy.
- Ensure toast close does not discard the operation.

### Exit Criteria

- Failure toast survives SPA navigation.
- Retry updates the same logical operation.
- Retry success dismisses the toast after a short success state.
- Account mismatch disables retry with actionable copy.
- Existing unrelated toast behavior remains unchanged.

## Phase 3: Room Message Reference Migration

### Goal

Prove retain-on-failure presentation without repository optimism.

### Steps

- Replace room `publishThunk` call with `startPublication`.
- Select matching room-message operations in the existing candidate merge.
- Include publishing and unconfirmed retain-policy operations.
- Commit only through the operation core after ACK.
- Resolve inline status by operation ID/current attempt.
- Add Discard for unconfirmed authored messages.

### Exit Criteria

- Message appears before ACK.
- Repository does not contain it before ACK.
- ACK moves it into repository without duplicate rendering.
- Unconfirmed message remains annotated after route navigation.
- Retry success removes failure state and leaves one canonical message.
- Discard removes only the preview.

## Phase 4: Reaction Add/Delete Reference Migration

### Goal

Prove rollback-on-failure desired-state projection.

### Steps

- Add an `optimistic` passthrough or operation-based replacement for `publishReaction`.
- Start reaction and reaction-delete operations without repository insertion.
- Overlay additions and pending deletions in `ReactionSummary`.
- Key pending mutations by owner, target event, and emoji/reaction identity.
- Disable conflicting repeated mutations while publishing.
- Preserve community and repo relay scopes.

### Exit Criteria

- Pending reaction appears immediately.
- Rejected reaction disappears and repository remains unchanged.
- Pending delete hides or dims its target.
- Rejected delete restores its target.
- Toast retry reapplies the pending desired state.
- ACK commits one reaction/delete and clears operation state.
- Collection-star deletes are not accidentally classified as ordinary reaction deletes.

## Phase 5: Community Star Migration

### Goal

Apply rollback-on-failure to a simple preference toggle.

### Steps

- Remove explicit repository insertion from `CommunityStarButton`.
- Start star/delete operations through the operation core.
- Render desired state while publishing and disable conflicting toggles.
- Return to committed star state on unconfirmed outcome.
- Reapply desired state during retry.

### Exit Criteria

- Star/unstar changes immediately while publishing.
- Failed star/unstar rolls back.
- No unconfirmed reaction/delete enters repository.
- Global retry repairs the operation.

## Phase 6: Authored Thread And Comment Migrations

### Goal

Extend the room retain-on-failure pattern to safe authored content.

### Steps

- Migrate current and compose-menu thread creation.
- Migrate repository-activity thread creation without changing Git transport.
- Add pending thread-root projections to list and detail routes.
- Migrate thread, goal, and calendar comments.
- Reuse existing event renderers and operation-aware inline status.
- Migrate compose-menu goal/calendar creation only after address freshness behavior is tested.

### Exit Criteria

- Pending roots/comments render without repository insertion.
- Unconfirmed authored content remains visible and recoverable during the SPA session.
- Confirmed content hands off without duplicate cards/messages.
- Existing linked current goal/calendar creation remains unchanged.

## Phase 7: Independent Governance Publications

### Goal

Cover safe independent governance events without weakening compound workflow ownership.

### Steps

- Register each moderator-invite response independently.
- Add latest-address checks before retrying replaceable response snapshots.
- Register each report-review label independently.
- Remove explicit failed-label repository purging.
- Ensure partial batch failure does not claim the entire batch was recovered.

### Exit Criteria

- Each failed independent child can be retried exactly.
- Successful siblings are not retried.
- Failed report labels remain previews rather than repository events.
- Admission grant/revoke chains remain excluded.

## Phase 8: Audit And Legacy Optimism Reduction

### Goal

Measure remaining default-optimistic repository insertions and decide the next migration boundary.

### Steps

- Re-run the full `publishThunk` and manual `repository.publish` inventory.
- Classify remaining paths as safe single-event, ACK-gated, compound, direct transport, settings, or
  extension/wrapped.
- Remove redundant manual repository insertion from migrated flows.
- Document any intentional local-only repository usage separately.
- Consider an explicit Welshman repository-admission enum only after callers are migrated.

### Exit Criteria

- Every remaining pre-ACK repository insertion is documented and intentional.
- No migrated flow relies on repository optimism.
- A separate plan exists before changing `publishThunk` default behavior.

## Verification Strategy

### Core Unit Tests

- Operation registration and cleanup.
- ACK commit ordering.
- Confirmation-relay selection.
- Signing/transport/relay failure handling.
- Timeout as unconfirmed.
- Exact retry identity.
- Account guard before and after asynchronous signer recovery.
- Cancel and discard.
- Late tracker reconciliation.
- Preview-policy visibility.

### Feature Tests

- Room retain-on-failure and route revisit.
- Thread/comment retain-on-failure.
- Reaction add rollback.
- Reaction delete restoration.
- Community star rollback.
- Retry reapplication and eventual commit.
- No duplicate rendering during operation-to-repository handoff.

### Regression Tests

- Existing ACK-gated linked publication remains ordered.
- Existing edits and deletes retain exact-stage retry.
- No repository transport or extension test changes are required by early phases.
- IndexedDB does not persist unconfirmed migrated events because they never enter repository.

## Risks And Mitigations

| Risk                                               | Mitigation                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Operation and repository render simultaneously     | Deduplicate by event ID and retain confirmed operation only for a short handoff grace period.      |
| Retry after account switch                         | Store owner pubkey and recheck before and after asynchronous signer recovery.                      |
| Timeout was actually accepted                      | Use `unconfirmed` wording, exact retry, and late tracker reconciliation.                           |
| Stale replaceable retry                            | Exclude settings, require current-address checks for migrated addressable events.                  |
| Compound child retry creates inconsistent workflow | Explicitly exclude dependent workflows and retry only owning workflows.                            |
| Failed operations accumulate                       | Retain only unconfirmed operations, support discard, clear on logout, and bound session retention. |
| Existing thunk store selects stale attempts        | Operation owns one current attempt and generation; UI resolves by operation ID.                    |
| Toast eviction hides recovery                      | Keep operation independent of toast; leave room for a later recovery tray.                         |
| Wrapped event still touches repository             | Exclude NIP-59 flows until `WrapManager` admission behavior is fixed.                              |

## Completion Definition

The architecture is complete for the initial safe scope when:

- Migrated events never enter repository before confirmation.
- Authored content and desired-state mutations both have tested optimistic projections.
- Global recovery works across SPA navigation.
- Failure behavior is feature-appropriate rather than repository-driven.
- Hard reload cannot resurrect an unconfirmed migrated event from IndexedDB.
- Complex, settings, extension, wrapped, and direct repository workflows remain unchanged and
  explicitly documented.
