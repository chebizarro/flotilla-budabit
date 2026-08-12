# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Implement `docs/architecture/repository-activity-loading-design.md` with route-owned repository I/O, stable live filters, bounded recent history, verified recent/watched caching, and truthful UI states.
- Complete all phases in `docs/architecture/repository-activity-loading-session-plan.md`, committing and pushing every verified phase while never committing the session-plan file.

## Current Phase

- Phase 4: Recent Root Pages And Legacy Gap-Fill

## Phase Exit Criteria

- Repository entry requests explicit bounded recent root pages per authoritative relay.
- Pagination cursors and completion are per relay.
- Inclusive timestamp overlap prevents silent same-second loss; unresolved saturated boundaries become partial.
- Compatibility gap-fill covers comments, PR updates, labels, cover letters, statuses, reports, and repository-tagged deletes for loaded roots.
- `loadOlderRoots()` performs real network work only when local visible rows need another page.
- Recent-page completion is not presented as full-history exhaustion.
- Tests cover empty EOSE, partial relay outcomes, equal timestamps, duplicate IDs, and older-page demand.

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
- Phase 1 was committed and pushed to `origin/dev` as `a405a1f08`.
- Phase 2 changed generic persisted event and tracker hydration from destructive replacement to additive merge.
- Late cached replaceables cannot displace newer in-memory winners, and cached provenance is unioned with relays learned after startup continued.
- Eligible event persistence now establishes a pending barrier before tracker provenance is written; repository update evidence also retriggers provenance persistence.
- `/git` and repository-detail layouts wrap their existing finite `load` calls with route-lifetime cancellation without changing filters or completion behavior.
- Repository teardown aborts route finite work and identity-safely disposes and clears the route-owned `Repo` instance.
- Phase 2 focused verification passed: 4 files and 39 tests; root `pnpm check` passed with 0 diagnostics; Prettier and `git diff --check` passed.
- Phase 2 was committed and pushed to `origin/dev` as `8222a752e`.
- Phase 3 replaced root-growing live filters with stable announcement, coordinate/state/comment-`q`, and exact-open-thread lanes.
- Stable lanes reconcile independently per relay; unchanged relays and lanes retain their current request.
- Root discovery is absent from stable filter identity, while legacy root-only activity is isolated to the currently open exact thread.
- Unexpected live termination retries with bounded exponential backoff and `lastReceivedAt` overlap; route abort is terminal and releases foreground ownership.
- Initial live requests use `limit: 0` without `since`, preserving late delivery of imported events with old signed timestamps; only retries use overlap cursors.
- Phase 3 focused verification passed: 3 files and 14 tests; repository detail E2E passed 2 tests; root `pnpm check`, Prettier, and `git diff --check` passed.

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
- Phases 1 through 3 are verified; Phase 3 is ready for scoped commit/push closeout.
- The session plan remains intentionally untracked and must not be staged.

## Next Action

- Add per-relay bounded recent root pages, inclusive timestamp pagination, and finite compatibility gap-fill for admitted roots.

## Verification

- Planning review inspected reset baseline route loading, Welshman request/feed/storage contracts, GitWorkshop, and Applesauce.
- Git upstream merge completed without conflicts.
- `pnpm exec vitest run --project=main src/app/core/finite-relay-request.test.ts` passed: 1 file, 10 tests.
- `pnpm check` passed with 0 errors and 0 warnings.
- Phase-owned Prettier check passed.
- Phase-owned `git diff --check` passed.
- `pnpm exec vitest run --project=main src/app/util/storage.test.ts src/app/core/git-state.test.ts src/app/core/repo-loading-scope.test.ts src/lib/indexeddb.test.ts` passed: 4 files, 39 tests.
- Phase 2 `pnpm check` passed with 0 errors and 0 warnings.
- Phase 2 owned-file Prettier and `git diff --check` passed.
- `git-state.test.ts` continues to emit its existing incomplete mocked-router warning while passing.
- `pnpm exec vitest run --project=main src/app/core/repo-live-session.test.ts src/app/core/repo-loading-scope.test.ts src/app/core/repo-live-ownership.test.ts` passed: 3 files, 14 tests.
- Initial repository-detail E2E exposed and rejected a wall-clock `since` boundary that filtered old imported events.
- After changing initial live to `limit: 0` and retaining `since` only on retry, `pnpm exec playwright test tests/e2e/git-detail-resolution.spec.ts` passed: 2 tests.
- Phase 3 `pnpm check`, owned-file Prettier, and `git diff --check` passed.

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
- `src/app/util/storage.ts`
- `src/app/util/storage.test.ts`
- `src/app/core/git-state.ts`
- `src/app/core/git-state.test.ts`
- `src/app/core/repo-loading-scope.test.ts`
- `src/routes/git/+page.svelte`
- `src/routes/git/[id=naddr]/+layout.svelte`
- `src/app/core/repo-live-session.ts`
- `src/app/core/repo-live-session.test.ts`
