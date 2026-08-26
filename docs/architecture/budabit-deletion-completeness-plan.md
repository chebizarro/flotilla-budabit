# Budabit Deletion Completeness Plan

## Status

- Proposed phased application plan.
- Applies to Budabit and its vendored Welshman deletion contracts.
- GitWorkshop and Applesauce were comparison inputs only; neither is an implementation target.

## Problem

Budabit has strong low-level deletion semantics and increasingly robust publication workflows,
but deletion coverage differs by surface:

- The Welshman repository retains kind-5 events, tracks delete evidence before or after targets,
  excludes deleted targets from normal queries, and reports removals to derived stores.
- Ordinary target stores do not need kind 5 in their filters to react to deletion.
- Issue deletion removes the root and authored kind-1985 label/title events.
- Pull-request deletion additionally inventories authored updates, statuses, labels, and comments.
- Repository deletion inventories several repository-owned event kinds, publishes chunked delete
  requests, reports relay outcomes, deletes supported physical remotes, and conditionally removes
  the local clone.

The remaining gaps are not a need for a new deletion engine. They are incomplete inventory,
inconsistent policy between issue and PR workflows, bounded hydration gaps, and insufficiently
explicit presentation of partial deletion.

## Existing Contracts To Preserve

### Repository Semantics

`packages/welshman/packages/net/src/repository.ts` provides the canonical behavior:

- Both `e` and `a` delete evidence are indexed.
- The delete author must match the target author.
- Delete evidence must be newer than the target.
- Non-replaceable events can be deleted by ID.
- Replaceable events require address deletion; an `e` deletion is not durable replacement
  tombstoning.
- Delete-before-target and target-before-delete are supported.
- Deleted targets remain internally available by ID.
- Normal queries exclude deleted targets; `includeDeleted` is available for audit workflows.
- `RepositoryUpdate.removed` is the source of target-store invalidation.

### Publication Semantics

`src/app/core/commands.ts` and `src/app/core/git-commands.ts` establish:

- Delete relays are scoped and validated.
- Repository events use authoritative repository publication scope.
- Addressable targets use address tombstones through the normal `makeDelete` path.
- Delete timestamps can be forced newer than their targets.
- Complex issue and PR operations wait for a relay acknowledgement before publishing the
  tombstone to the local repository.
- Retried operations retain acknowledged progress and retry the same signed delete event.
- Cancellation aborts in-flight publication and does not falsely commit local deletion.

These guarantees must not be weakened by cleanup expansion.

## Deletion Policy

Deletion is a request to relays, not proof of universal erasure. Relays may retain data, other
clients may have copied it, and Budabit cannot delete events authored by another key.

Every workflow must distinguish:

- `required`: the user-selected root or repository announcement. Failure fails the operation.
- `best-effort`: related events authored by the same user. Failure is reported but does not
  misrepresent the root result.
- `foreign`: related events authored by another user. Never target them.
- `unsupported`: related event shapes Budabit cannot safely classify. Report or ignore them
  explicitly; do not guess.

Root deletion should occur after related authored cleanup so retries can continue from retained
progress and a root failure does not conceal which secondary requests succeeded.

## Scope Definition

### Issue Deletion

The complete bounded authored inventory should consider:

- Issue root, required.
- Kind-1985 title/label events referring to the issue.
- Kind-1624 cover-letter or description edits referring to the issue.
- Status events referring to the issue.
- NIP-22 comments whose root or parent resolves to the issue.
- Reactions authored by the issue author that target the issue or an authored secondary event.
- Other known Git issue metadata explicitly supported by Budabit.

Events from other authors remain. Replies to a deleted comment may consequently become orphaned
and should continue to render under existing missing-parent rules where appropriate.

### Pull-Request Deletion

The current inventory already includes updates, statuses, labels, and comments. Complete coverage
should additionally audit:

- Cover letters and description edits.
- Reactions to the root and authored related events.
- Patch revision or stack metadata where it is authored by the same key and belongs exclusively
  to the deleted PR.
- Merge and conflict metadata where ownership and repository relation are unambiguous.

Shared evidence must not be deleted merely because it references the PR. A target is eligible only
when policy declares it owned by this workflow and its author matches the active root author.

### Repository Deletion

The current `buildRepoOwnedDeleteFilters` inventory covers:

- Kind-30617 announcements.
- Repository state.
- Stacks.
- Merge and conflict metadata.
- Issues.
- Pull requests and updates.
- Selected status kinds.

The complete bounded inventory should also consider:

- Kind-1985 labels and title edits.
- Kind-1624 cover letters.
- NIP-22 comments carrying repository `q` coordinates or resolving through repository roots.
- Reactions and stars authored by the repository owner.
- Applied and complete status variants consistently with open, draft, and closed.
- Any current repository-owned metadata kind persisted by `storage-events.ts` or loaded by
  `RepoSession.svelte`.

Co-maintainer announcements and events are foreign unless signed by the deleting key. Deleting one
owner's repository cannot truthfully claim to delete another maintainer's coordinate or event.

Physical Git remote deletion remains separate from Nostr metadata deletion. A relay ACK for kind 5
is not proof that a GRASP or hosted Git repository was physically erased.

## Hydration Requirements

Complex deletion can target only events it has discovered. A finite inventory must therefore
report its completeness rather than equating a timeout with an empty result.

For each relay record:

- EOSE-complete.
- Partial due to timeout, disconnect, `CLOSED`, result cap, or local error.
- Aborted.
- Events accepted after signature, author, relation, and repository-authority validation.

Use authoritative repository activity relays. Route hints and broad application relays may help
discover the announcement but must not silently become metadata deletion scope.

Hydration should run in bounded rounds:

1. Load address- and repository-coordinate-owned roots and metadata.
2. Derive root IDs from validated round-one results.
3. Load root-referenced comments, edits, statuses, labels, and reactions in chunks.
4. If policy includes reactions to authored secondary events, perform one additional bounded ID
   round.
5. Stop at the documented depth. Do not recursively crawl arbitrary `e`, `E`, or `q` graphs.

Cache and in-memory results can seed inventory immediately, but authoritative-empty or
complete-inventory claims require finite relay outcomes.

Delete hydration used for normal rendering remains separate from pre-delete inventory. Normal
stores should continue to rely on repository `removed` IDs rather than adding broad kind-5 filter
branches.

## Shared Data Model

Introduce a small application-level plan representation rather than another repository:

```ts
type DeleteTargetPolicy = "required" | "best-effort"

type PlannedDeleteTarget = {
  event: TrustedEvent
  policy: DeleteTargetPolicy
  relation: string
}

type DeleteInventoryOutcome = {
  targets: PlannedDeleteTarget[]
  foreignCount: number
  unsupportedCount: number
  relayOutcomes: FiniteRelayResult[]
  complete: boolean
}
```

The exact finite result type should reuse the repository activity finite-request contract where
available. Do not add persistent operation state beyond the existing retained in-flight delete
state unless reload-resumable deletion becomes an explicit product requirement.

Target classification must be pure and testable. Transport, repository mutation, and UI progress
remain outside classification helpers.

## Phases

### Phase 0: Policy Matrix And Regression Baseline

Document the supported root and secondary kinds with:

- Required or best-effort policy.
- Valid relation tags.
- Expected author.
- Addressable versus regular deletion form.
- Authoritative relay source.
- Maximum traversal depth.

Add repository-level tests for:

- Delete before target.
- Target before delete.
- Address deletion and later replacement resurrection.
- ID deletion ignored for replaceable events.
- Mismatched author rejection.
- Equal and older delete timestamps.
- Target and delete in one batch.
- Persisted load containing target and deletion in either order.

Add application regression tests proving target stores receive `removed` without including kind 5
in their filters.

Exit criteria:

- Current behavior and intended coverage are explicit.
- No workflow calls a specific-ID helper for an addressable target unless it deliberately wants
  non-durable version-only behavior.

### Phase 1: Shared Authored Target Classification

Create pure helpers for:

- Determining whether an event belongs to an issue, PR, or repository.
- Classifying known secondary kinds.
- Rejecting foreign authors.
- Deduplicating targets by event ID.
- Selecting address versus ID deletion through existing `makeDelete` behavior.
- Ordering best-effort targets before required roots.

Reuse current Git constants and relation conventions from `RepoSession.svelte`, issue/PR pages,
`storage-events.ts`, and repository activity loading. Do not create a second list of unexplained
numeric kinds where named constants exist.

Keep `runDeleteEventsSequentially` as the publication executor. The classifier supplies targets;
it does not publish.

Exit criteria:

- Issue, PR, and repository inventory tests use one classification vocabulary.
- Foreign events cannot enter a publication target list.
- Existing acknowledgement, cancellation, and retry tests remain unchanged.

### Phase 2: Complete Issue And PR Cleanup

Replace the issue-only label query and the PR-specific filter construction with policy-driven
inventory builders.

For issues:

- Add authored cover letters, statuses, and comments.
- Add authored reactions in a bounded second round.
- Keep all related cleanup best-effort unless product policy explicitly promotes a kind.
- Keep the issue root required and last.

For pull requests:

- Preserve current authored updates, statuses, labels, and comments.
- Add cover letters and reactions.
- Audit patch/stack/merge metadata and include only unambiguously PR-owned events.
- Decide whether current strict secondary failure behavior should become best-effort for
  consistency with issue cleanup. Record that product decision in tests and UI copy.

Update confirmation copy to list what will be attempted and what necessarily remains.

Exit criteria:

- Issue and PR workflows have the same policy vocabulary and truthful outcome reporting.
- Root success is not reported before a relay acknowledgement.
- Optional failures are visible by kind and count.

### Phase 3: Complete Repository Metadata Inventory

Extend `buildRepoOwnedDeleteFilters` into a bounded multi-round inventory planner.

Round one:

- Announcements and repository state by owner and identifier.
- Address-scoped Git roots, updates, statuses, labels, cover letters, stack, merge, and conflict
  metadata.
- Repository-`q` comments where supported.

Round two:

- Secondary events by validated root IDs for legacy events lacking repository coordinates.
- Reactions authored by the repository owner.

Keep relay result completeness. If any required relay inventory is partial, show that before
publication and require an explicit user decision to continue with partial metadata cleanup.

Retain existing chunked kind-5 publication, per-relay result reporting, remote deletion, and local
clone preservation rules.

Exit criteria:

- Every repository activity kind loaded or persisted by current Git surfaces is either included or
  explicitly documented as excluded.
- Inventory does not target co-maintainer or community-member events.
- Partial inventory cannot be displayed as complete deletion.

### Phase 4: Close Delete Hydration Gaps

Audit normal Git and community rendering paths for broad or duplicated kind-5 subscriptions.

For Git:

- Ensure repository entry hydrates delete evidence for the bounded recent activity scope.
- Ensure exact issue/PR deep links request delete evidence for the root and loaded secondary IDs.
- Ensure repository sidecar caching retains accepted delete evidence required to suppress stale
  cached targets after reload.
- Keep compatibility hydration finite and root-scoped for legacy events without repository tags.

For community surfaces:

- Preserve bounded, authority-validated community delete hydration.
- Replace joined author/relay-list freshness keys with canonical bounded identities where
  applicable.
- Do not add kind 5 to target-only derived-store filters merely to observe target removal.

Exit criteria:

- Deleted cached Git targets do not reappear after reload once their accepted tombstones are in
  the bounded cache scope.
- Hydration failure remains retryable and does not establish authoritative absence.
- No broad delete branch recreates the profile-list performance regression.

### Phase 5: Truthful Preview And Outcomes

Before a complex delete, show:

- Required root count.
- Best-effort authored event counts by kind/relation.
- Foreign related-event count that will remain.
- Inventory completeness and partial relays.
- Nostr metadata relays.
- Physical remote targets, handled separately.

After publication, show:

- Required deletes acknowledged or failed.
- Best-effort deletes acknowledged or failed by kind.
- Relay delivery outcomes.
- Physical remote outcomes.
- Whether local data was removed or preserved.
- A reminder that deletion requests do not guarantee erasure from every relay or copy.

Exit criteria:

- Success text never equates ACK with universal deletion.
- Partial inventory and partial publication are distinguishable.
- The user can identify which authored secondary data may remain.

### Phase 6: Validation And Policy Lock

Add focused tests for:

- Issue root with title, description, status, comment, nested comment, and reaction events.
- PR root with update, cover letter, label, status, comment, reaction, and patch metadata.
- Repository with current and legacy relation tags.
- Mixed own and foreign authors.
- Duplicate events from cache and relay.
- Delete-before-target and reload hydration.
- One relay complete and another partial.
- Cancellation during inventory and publication.
- Retry after some secondary ACKs and root failure.
- Addressable target deletion using `a`, not only `e`.
- Chunk limits for large repository inventories.

Run physical or realistic large-repository validation to ensure inventory and local tombstone
publication remain yielded and do not recreate sustained repository listener pressure.

Exit criteria:

- The policy matrix and tests agree.
- Large authored inventories remain cancellable and bounded.
- Repository subscriber diagnostics remain within the post-routing budget.

## Risks And Controls

### Unbounded Graph Traversal

Control: fixed rounds, chunked IDs, named supported relation edges, and a documented depth limit.

### Deleting Shared Or Foreign Evidence

Control: exact author equality plus kind-specific relation validation. References alone do not
establish ownership.

### Addressable Event Resurrection

Control: use `a` tombstones for replaceable/addressable targets and force a deletion timestamp at
least newer than the target under Welshman's strict comparison.

### Partial Relay Inventory

Control: explicit per-relay finite outcomes and truthful partial state. Never convert timeout to an
empty complete inventory.

### Main-Thread Pressure

Control: bounded request filters, chunked classification, yielded publication, routed repository
listeners, and diagnostics over the full workflow.

### Misleading Success

Control: report request acknowledgement, metadata inventory, physical remote deletion, and local
cleanup as separate outcomes.

## Completion Criteria

- Issue and PR deletion use a shared authored-target policy.
- Repository deletion covers every supported repository-owned event kind or documents its
  exclusion.
- Replaceable targets consistently use address tombstones.
- Foreign events are never targeted.
- Delete hydration prevents accepted stale cached targets from reappearing in covered scopes.
- Partial inventory and publication remain visible and retryable.
- Existing relay-ack-before-local-publication guarantees remain intact.
- Complex deletion remains bounded, cancellable, and compatible with repository listener routing.
