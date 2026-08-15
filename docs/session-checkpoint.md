# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Fix community authority readiness and user-facing loading states without exposing internal permission hydration.
- Preserve aggregate calendar grants while restoring their use in broad-transport local admission.
- Complete all phases in `docs/session-plan.md`, committing and pushing every verified phase.

## Current Phase

- Complete

## Phase Exit Criteria

- Calendar list, detail, layout follow-up, and notification flows use aggregate calendar writer admission for both all-day and timed events.
- Either calendar-kind grant authorizes both calendar event kinds for direct events and targeted wrappers.
- Existing aggregate creation behavior and distinct calendar section naming remain unchanged.
- Structural relay filters remain broad while local admission remains aggregate and fail-closed.
- Focused and full tests, root check, E2E typecheck, build, formatting, and whitespace checks pass.

## Completed With Evidence

- The previous four-phase structural transport migration completed at `c32ca5703` and is pushed to `origin/dev`.
- Commit history confirms `9d2789ba6` intentionally made either calendar grant authorize both all-day and timed calendar behavior.
- Current broad transport correctly separates structural relay filters from local author admission.
- Current permission status combines required profile-list filters with optional admission-form filters.
- Early multi-relay settlement returns `complete: false`, and later relay settlement does not update the finished status.
- Calendar, goals, and threads expose that stale state when empty; populated routes often mask it by rendering content first.
- `afcb9dbbe` unintentionally replaced aggregate calendar writer admission with per-kind writer maps in calendar transport.
- The extension bridge is not the calendar screenshot cause; it intentionally returns `COMMUNITY_CONTEXT_NOT_READY` while required profile lists are initially unresolved.
- Phase 1 split profile-list authority and admission-form discovery into independently tracked statuses.
- Phase 1 added non-duplicating progressive relay settlement: early authority can be used when every referenced list is cached, while slower relay completion still updates terminal status.
- Non-terminal partial evidence remains loading, non-empty authority filters without relays fail closed, and terminal failures remain retryable.
- Selective retries no longer reset or invalidate the sibling authority/form stream; stale updates are rejected by each status store's generation key.
- Phase 1 added a shared `loading`/`ready`/`unavailable` classifier with current-community and key-prefix validation.
- Independent Phase 1 review found no remaining high or medium actionable issue.
- Phase 2 added generation-aware active authority and admission-form readiness stores and applied them across community content, governance, menu, widget, and publishing surfaces.
- Community routes now use resource-specific loading copy and generic resource unavailable/retry states without exposing permission hydration internals.
- Publishing controls and content filters require both current bootstrap and authority readiness, preventing stale generations from remaining interactive.
- Community-home and top-menu widgets remain hidden until current authority is ready.
- The extension bridge now distinguishes active and runtime snapshots, blocks stale active generations, independently hydrates runtime evidence, and fails closed when required profile lists remain missing.
- Phase 2 added a static copy regression test and updated the landing screenshot readiness sentinel.
- Independent Phase 2 review found no remaining high or medium actionable issue.
- Phase 3 restored aggregate calendar writers in list and detail direct-event and targeting-wrapper filter plans while retaining broad structural relay filters.
- Layout follow-up discovery now uses centralized targeting-wrapper authorization, including aggregate calendar grants, after generation-aware authority readiness succeeds.
- Active-community and global notification discovery now use aggregate calendar grant evidence and writer admission for both calendar event kinds.
- Phase 3 regressions prove both cross-kind grant directions for direct events and targeted wrappers.
- Independent Phase 3 review found no high or medium actionable issue.

## Decisions

- Remove only readiness-related permission copy; retain real membership and access-policy wording.
- Show resource-specific loading copy and generic resource unavailable/retry copy on terminal failure.
- Keep extension requests fail-closed when profile-list evidence is missing.
- Keep aggregate calendar grants, creation behavior, and section naming unchanged.
- Use three durable phases and push each verified phase to tracked `origin/dev`.

## Current State

- Repository: `/home/johnd/Work/budabit`.
- Branch: `dev`, tracking `origin/dev`.
- Phase 1 is committed and pushed as `d0f7654e6 fix: stabilize community authority readiness`.
- Phase 2 is committed and pushed as `3f94ed334 fix: align community readiness states`.
- Phase 3 implementation and all required validation are complete.
- Unrelated user changes remain in `src/app/components/MenuSettings.svelte`, `src/lib/components/CardButton.svelte`, and `tests/e2e/settings-menu-navigation.spec.ts`; do not stage them.

## Next Action

- Commit and push the verified Phase 3 changes, then reread this checkpoint and confirm `Current Phase: Complete`.

## Verification

- Read the previous checkpoint and entire previous session plan before replacing them for this workflow.
- Inspected status, branch tracking, remotes, recent commits, and durable-document history.
- Confirmed current branch state is clean and current code is authoritative over stale previous closeout text.
- Phase 1 focused suite passed 48 tests in `src/app/core/community-state-loading.test.ts`.
- Phase 1 `pnpm check` passed with 0 errors and 0 warnings.
- Phase 1 changed-file Prettier and `git diff --check` passed.
- Phase 1 independent final review approved the lifecycle with no high/medium findings.
- Phase 2 focused readiness and bridge suites passed 104 tests.
- Phase 2 broader community and extension suites passed 403 tests; the one static room-retry contract mismatch was corrected and its 7-test rerun passed.
- Phase 2 `pnpm check` passed with 0 errors and 0 warnings.
- Phase 2 changed-file Prettier and `git diff --check` passed.
- Phase 2 static readiness-copy regression passed.
- Phase 2 independent final review approved the consumer and bridge changes with no high/medium findings.
- Phase 3 focused calendar, permission, target-route, notification, live, and request suites passed 113 tests across 6 files.
- Phase 3 full main suite passed 1,703 tests across 179 files with coverage enabled.
- Phase 3 `pnpm check` passed with 0 errors and 0 warnings.
- Phase 3 `pnpm run e2e:check` passed.
- Phase 3 `pnpm run build` passed, including the service-worker contract.
- Phase 3 changed-file Prettier and `git diff --check` passed.
- Phase 3 independent final review found no high or medium findings.

## Risks Or Blockers

- No current blocker.
- Cached authority remains intentionally usable during refresh; terminal relay failure must not turn known authority into an unrestricted selector.
- Admission forms need separate readiness where access-request UI depends on proving their absence.
- Moderation report/delete completeness remains a separate concern outside this workflow.
- Node 25 jsdom tests require `NODE_OPTIONS=--no-experimental-webstorage` in this environment.
- Route and global notification discovery wiring is partly protected by source-contract tests rather than a full relay-discovery integration test; the underlying authorization behavior is covered.
- The production build retains its existing large-chunk warning, and Browserslist data is stale; neither blocked validation.

## Files

- `docs/session-plan.md`
- `docs/session-checkpoint.md`
- `src/app/core/community-state.ts`
- `src/app/core/community-state-loading.test.ts`
- `src/app/core/community-readiness-copy.test.ts`
- `src/app/extensions/bridge.ts`
- `src/app/extensions/bridge.test.ts`
- `src/app/extensions/community-home-readiness.ts`
- `src/app/core/community-permissions.test.ts`
- `src/app/core/community-targeted-routes.test.ts`
- `src/app/util/notifications.ts`
- `src/app/util/notifications.test.ts`
- `src/app/util/notification-sources.ts`
- `src/app/util/notification-sources.test.ts`
- `src/routes/c/[community]/+layout.svelte`
- `src/routes/c/[community]/calendar/+page.svelte`
- `src/routes/c/[community]/calendar/[event]/+page.svelte`
