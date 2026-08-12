# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Implement `docs/architecture/repository-activity-loading-design.md` with route-owned repository I/O, stable live filters, bounded recent history, verified recent/watched caching, and truthful UI states.
- Complete all phases in `docs/architecture/repository-activity-loading-session-plan.md`, committing and pushing every verified phase while never committing the session-plan file.

## Current Phase

- Phase 6: Verified Bounded Repository Cache

## Phase Exit Criteria

- Cache records use canonical repository addresses and retain bounded relay provenance.
- Every event is independently signature-verified before write and before hydration.
- Recent eligibility is bounded by count and age; watched eligibility is retained within its own hard limit.
- Per-repository and global event/byte limits prune deterministically.
- Delete evidence is retained at least as long as its cached target.
- Cache hydration publishes into the canonical repository/tracker and never creates a second projection source.
- Pruning persistent records does not remove active in-memory events.
- Route and watched-repository writes are idempotent by repository/event key.
- Offline warm reload works for recent and watched repositories.

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
- Phase 3 was committed and pushed to `origin/dev` as `c809a5159`.
- Phase 4 added bounded recent issue/PR root pages with independent relay cursors and explicit recent, partial, failed, and exhausted states.
- Empty EOSE exhausts only its relay; timeout and other non-EOSE outcomes remain partial rather than becoming empty authority.
- Older pages retain an inclusive oldest-timestamp boundary; repeated full pages at the same boundary become explicit partial saturation instead of skipping events.
- Finite compatibility gap-fill now has one owner and covers comments, PR updates, labels, cover letters, statuses, reports, and delete events for newly admitted roots.
- The previous duplicate reactive comment/status root loaders and unbounded root filters were removed.
- Issue and PR Load more reveal local rows first, then request the next relay page only when local rows are exhausted.
- Phase 4 focused verification passed: 3 files and 16 tests; root/list/detail E2E passed 5 tests including bounded on-demand pagination; `pnpm check`, `pnpm run e2e:check`, Prettier, and `git diff --check` passed.
- Phase 5 added a layout-owned `ensureRoot(id)` action with complete, partial, failed, unavailable, and aborted outcomes; concurrent exact demand coalesces while retryable outcomes remain retryable.
- Exact issue, pull-request, and pull-request-update results are checked against the accepted canonical repository address before entering canonical projections; conflicting and foreign coordinates are rejected.
- PR-update deep links resolve their accepted root before compatibility gap-fill and switch the exact legacy live lane from the requested update to its root.
- Automatic and exact-demand compatibility gap-fill now share in-flight work and mark roots complete only after all relay requests reach EOSE.
- Issue and PR details consume `ensureRoot`; issue and PR lists no longer create `makeFeed` instances or issue-edit prefetch ownership; `PRView` initial comment/update/status/cover-letter loads were removed.
- Same-repository detail/list/overview navigation retained one stable activity owner in E2E coverage, while late direct-link delivery and unavailable relay states continued to pass.
- Phase 5 focused verification passed: 4 files and 31 tests; root/list/detail E2E passed 7 tests; 4 affected detail regressions passed; `pnpm check`, `pnpm run e2e:check`, Prettier, and `git diff --check` passed.

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
- Phases 1 through 5 are verified; Phase 5 is ready for scoped commit/push closeout.
- The session plan remains intentionally untracked and must not be staged.

## Next Action

- Add the application-owned verified repository cache with deterministic eligibility, event, provenance, and byte bounds.

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
- `pnpm exec vitest run --project=main src/app/core/repo-root-history.test.ts src/app/core/repo-loading-scope.test.ts src/app/core/repo-live-session.test.ts` passed: 3 files, 16 tests.
- `pnpm exec playwright test tests/e2e/git-list-resolution.spec.ts tests/e2e/git-detail-resolution.spec.ts` passed the existing 4 tests after integration.
- The new bounded-pagination E2E passed and proved the first `limit: 100` request has no cursor while older demand retains the oldest timestamp in `until`.
- Phase 4 `pnpm check`, `pnpm run e2e:check`, owned-file Prettier, and `git diff --check` passed.
- `pnpm exec vitest run --project=main src/app/core/repo-root-history.test.ts src/app/core/repo-live-session.test.ts src/app/core/repo-loading-scope.test.ts src/app/core/event-activity-io.test.ts` passed: 4 files, 31 tests.
- `pnpm exec playwright test tests/e2e/git-detail-resolution.spec.ts tests/e2e/git-list-resolution.spec.ts` passed: 7 tests covering late exact delivery, unavailable relays, foreign-root rejection, PR-update deep links, single navigation ownership, cold lists, and bounded pagination.
- `pnpm exec playwright test tests/e2e/pr-spam-hiding.spec.ts tests/e2e/issue-deletion.spec.ts tests/e2e/git-quote-navigation.spec.ts` passed: 4 affected detail regressions.
- Phase 5 `pnpm check`, `pnpm run e2e:check`, owned-file Prettier, and `git diff --check` passed.

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
- `src/app/core/repo-root-history.ts`
- `src/app/core/repo-root-history.test.ts`
- `src/routes/git/[id=naddr]/issues/+page.svelte`
- `src/routes/git/[id=naddr]/prs/+page.svelte`
- `tests/e2e/git-list-resolution.spec.ts`
- `src/app/core/event-activity-io.test.ts`
- `src/app/components/PRView.svelte`
- `src/routes/git/[id=naddr]/issues/[issueid]/+page.svelte`
- `src/routes/git/[id=naddr]/prs/[prid]/+page.svelte`
- `tests/e2e/git-detail-resolution.spec.ts`
