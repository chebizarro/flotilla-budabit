# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Implement `docs/architecture/repository-activity-loading-design.md` with route-owned repository I/O, stable live filters, bounded recent history, verified recent/watched caching, and truthful UI states.
- Complete all phases in `docs/architecture/repository-activity-loading-session-plan.md`, committing and pushing every verified phase while never committing the session-plan file.

## Current Phase

- Phase 2: Additive Storage And Route Lifecycle Safety

## Phase Exit Criteria

- Late event hydration merges verified persisted events with newer in-memory events instead of replacing repository indexes.
- Late tracker hydration merges provenance without clearing relays learned after startup continued.
- Event persistence observes the event before persisting its relay provenance.
- Core `/git` and repository-layout finite requests receive route-lifetime cancellation signals.
- Leaving a repository disposes and clears route-owned `activeRepoClass` state safely.
- Tests prove late hydration preserves newer events/provenance and route teardown aborts owned work.
- Existing community behavior and unrelated storage classes remain unchanged.

## Completed With Evidence

- The abandoned experiment and reset baseline were reviewed independently.
- The original problem statement was retained; coordinator, scheduler-demand, feed-controller, and dedicated query-state cache choices were rejected.
- GitWorkshop and Applesauce were reviewed for transferable patterns: immediate canonical rendering, independent refresh, additive relay streams, per-relay cursors, bounded batching, and explicit lifecycle ownership.
- Current Welshman primitives were confirmed sufficient for the planned implementation.
- User decisions: stable coordinate live plus focus/re-entry compatibility gap-fill; recent and watched cache eligibility; bounded recent page first with older history on demand.
- `dev` was reconciled with `origin/dev` before phase implementation without conflicts or changes to unrelated dirty files.
- Phase 1 added a stateless application finite-relay helper over existing Welshman callbacks.
- Phase 1 distinguishes EOSE, timeout, `CLOSED`, disconnect, abort, synchronous/asynchronous error, and event-consumer failure.
- Its deadline begins before `request` is invoked, so it bounds scheduler queue time and active relay time.
- Caller abort and timeout propagate through the existing request signal before the helper settles.
- Accepted and duplicate events are both forwarded for provenance handling while the returned event array is deduplicated by ID.
- Phase 1 focused verification passed: 1 file and 10 tests; root `pnpm check` passed with 0 diagnostics; Prettier and `git diff --check` passed.

## Decisions

- No planned Welshman or nostr-git package changes.
- No global repository coordinator or live supervisor.
- Repository layouts own activity I/O; child routes express narrow demand through context actions.
- Completion-sensitive finite work uses a per-relay application wrapper around existing callbacks.
- The detailed session plan remains untracked and unstaged by explicit user instruction.
- Architecture-scoped session files preserve the prior completed default workflow documents.

## Current State

- Repository: `/home/johnd/Work/budabit`.
- Branch: `dev`, tracking `origin/dev` after a clean merge of the prior divergence.
- Unrelated dirty relay-policy/Welshman files and an optimistic-publication plan predate this workflow and must remain unstaged and unmodified.
- Phase 1 is verified and ready for scoped commit/push closeout.
- The session plan remains intentionally untracked and must not be staged.

## Next Action

- Make generic event and tracker hydration additive, then add route-lifetime cancellation to current Git list/detail finite work.

## Verification

- Planning review inspected reset baseline route loading, Welshman request/feed/storage contracts, GitWorkshop, and Applesauce.
- Git upstream merge completed without conflicts.
- `pnpm exec vitest run --project=main src/app/core/finite-relay-request.test.ts` passed: 1 file, 10 tests.
- `pnpm check` passed with 0 errors and 0 warnings.
- Phase-owned Prettier check passed.
- Phase-owned `git diff --check` passed.

## Risks Or Blockers

- No current implementation blocker.
- The worktree contains unrelated changes in relay policy, Welshman, probe scripts, and an optimistic-publication plan; they must never be staged by this workflow.
- The session plan is intentionally uncommitted and will remain dirty/untracked across all phase commits.
- Live relay fan-out and exact cache bounds require measurement during later phases.

## Files

- `docs/architecture/repository-activity-loading-design.md`
- `docs/architecture/repository-activity-loading-session-plan.md` (never commit)
- `docs/architecture/repository-activity-loading-session-checkpoint.md`
- `src/app/core/finite-relay-request.ts`
- `src/app/core/finite-relay-request.test.ts`
