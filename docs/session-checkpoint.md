# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Scale Communikey community content beyond relay `authors` array limits by using structural tag transport and current-grant client admission.
- Complete all four phases in `docs/session-plan.md`, committing and pushing every verified phase.

## Current Phase

- Phase 4: Notifications Documentation And Final Validation

## Phase Exit Criteria

- Active and global notifications use structural relay transport with current-grant local admission.
- No ACL-derived `authors` arrays remain on community content transport; retained authors identify exact authority, identity, personal metadata, or address coordinates.
- Communikey and Budabit architecture documentation covers structural discovery, current-grant admission, targeted-wrapper authority, bounded saturation, and profile-list sharding.
- Regression coverage proves more than 1,000 writers, outsider saturation, revocation/regrant, wrapper-author curation, and retained exact filters.
- Full main tests, root check, E2E typecheck, build, formatting, and whitespace checks pass, or a real blocker is recorded.
- The checkpoint is advanced to `Current Phase: Complete`, committed, pushed, and reread.

## Completed With Evidence

- Verified the prior repository-manipulation workflow is already committed; the worktree started clean at `2947fb986` and matched `origin/dev`.
- Confirmed most route feeds derive section writers and place them in relay `authors` filters.
- Confirmed Welshman trims filter arrays above 1,000 values before feed requests.
- Confirmed the core community live stream already uses broad `kinds + #h` transport.
- Confirmed current parsers validate event structure but do not independently enforce writer grants.
- Phase 1 added reusable relay/local community filter plans that fail closed on an empty writer set.
- Phase 1 added targeted-original plans: explicit IDs remain exact, address references retain coordinate authors and matching kinds, and implicit targeting IDs use the wrapper signer as a singleton identity constraint.
- Phase 1 extended `makeFeed` with separate relay filters while preserving historical versus live local filter semantics.
- Phase 1 broad scans count raw and admitted events separately, deduplicate relay exhaustion, scan at most three unauthorized pages per load, and report non-exhausted empty or saturated results as incomplete.
- Phase 1 tests prove an allowed writer at index 1,001 is admitted locally while absent from the wire filter, outsiders are rejected from repository and initial events, and multi-relay exhaustion is not falsely inferred.
- Phase 1 final review found no remaining high or medium blockers.
- Phase 2 migrated room, thread, message, comment, reaction, report, and direct repository transport to structural relay filters with current-grant local selectors.
- Phase 2 added bounded per-relay/per-filter cursor history with raw/admitted separation, disconnect/timeout handling, three-page budgets, same-timestamp saturation detection, and explicit incomplete results.
- Phase 2 made room/thread/Git request keys grant-sensitive so revocation refilters immediately and regrant refetches history.
- Phase 2 separated comment, reaction, and report grants throughout shared components and community routes; open report modals react to current report grants.
- Phase 2 loads exact same-author NIP-09 deletes without requiring `h`, includes delete completion in engagement status, and chunks exact target IDs by 100.
- Phase 2 keeps partial authorized content visible with incomplete-history warnings and retry controls.
- Phase 2 added E2E proof that room history wire filters omit ACL authors while a structurally matching outsider message remains hidden.
- Phase 2 final review found no remaining high or medium blockers.
- Phase 3 centralized current wrapper-author admission and split targeted-original relay transport from authoritative local association filters.
- Phase 3 migrated calendar, goals, repositories, permalinks, widgets, notifications, curation, repository collection reads, and extension descriptor queries to wrapper-author authority.
- Explicit event and address references retain exact identity and may associate external-author originals; implicit targeting IDs remain constrained to the authorized wrapper signer.
- Targeted list/detail routes use bounded wrapper, delete, and original scans, preserve explicit relay hints, and surface partial history instead of authoritative empty results.
- Extension queries paginate broad wrapper/direct transport, locally admit each result against current descriptor grants, reject mixed-descriptor cross-authorization, and return timeout for undersized partial results.
- Open widgets resolve fresh runtime grant evidence for every privileged community request and fail closed when the originating context disappears.
- Home, launcher, and prompt widget curation caches are keyed by current definition, profile-list, and report evidence so revocation hides stale widgets and regrant refetches them.
- Repository collection reads distinguish collected, uncollected, and indeterminate state; authoritative scans cover all declared community relays and include bounded target, same-author delete, and original completeness.
- Widget and repository wrapper deletes use chunked same-author filters, avoiding relay filter-value truncation and unauthorized NIP-09 deletion.
- Phase 3 final review found no remaining actionable findings.

## Decisions

- Preserve current-grant visibility, including retroactive hide/reappear behavior after revocation/regrant.
- Use wrapper-author authority for targeted publications; explicit references may curate external originals.
- Require same-author originals for implicit targeting-ID associations.
- Keep exact authors for definitions, profile lists, personal metadata, forms, and address coordinates.
- Use four durable phases and push each verified phase to tracked `origin/dev`.

## Current State

- Repository: `/home/johnd/Work/budabit`.
- Branch: `dev`, tracking `origin/dev`.
- Phases 1 through 3 are verified; Phase 3 is ready for durable closeout in the same commit as this checkpoint advancement.

## Next Action

- After the Phase 3 commit and push, reread this checkpoint and the full plan, audit remaining notification/shared consumers and community `authors` construction, update architecture documentation, and run the complete Phase 4 validation matrix.

## Verification

- Startup read the previous checkpoint and entire previous plan.
- `git status`, branch/upstream, remotes, recent log, and durable-document history were inspected.
- `HEAD` and `origin/dev` both resolved to `2947fb98648eee8e474ccbe08720b1774004d633` before plan creation.
- Phase 1 focused tests: `pnpm exec vitest run --project=main src/app/core/community-feeds.test.ts src/app/core/requests.test.ts` passed, 2 files and 22 tests.
- Phase 1 `pnpm check` passed with 0 errors and 0 warnings.
- Phase 1 intentional-file Prettier and `git diff --check` passed.
- Phase 1 review reported no high or medium blocking findings.
- Phase 2 focused tests: 8 files and 80 tests passed in the combined run; final review reran the changed-file suite with 68 tests passing.
- Phase 2 `pnpm check` passed with 0 errors and 0 warnings.
- Phase 2 room recovery/authorization E2E passed, 3 tests.
- Phase 2 intentional-file Prettier and `git diff --check` passed after formatting the E2E addition.
- Phase 2 final review reported no high or medium blocking findings.
- Phase 3 focused main suite passed, 17 files and 201 tests, using `NODE_OPTIONS=--no-experimental-webstorage` so jsdom owns web storage under Node 25.
- Phase 3 `pnpm check` passed with 0 errors and 0 warnings.
- Phase 3 intentional-file Prettier and `git diff --check` passed.
- Phase 3 final independent review reported no actionable findings and confirmed readiness for checkpoint advancement and commit.

## Risks Or Blockers

- No current blocker.
- Broad `#h`/`#p` transport is vulnerable to unauthorized event volume; bounded pagination must report incomplete rather than false empty.
- A single profile-list event remains bounded by relay event/tag limits; sections need multiple list references for very large memberships.
- Node 25 exposes an unusable default `localStorage` stub without a persistence path; jsdom tests that use storage require `NODE_OPTIONS=--no-experimental-webstorage` in this environment.
- The complete test, E2E typecheck, build, documentation, and retained-`authors` audit remain Phase 4 work.

## Files

- `docs/session-plan.md`
- `docs/session-checkpoint.md`
- `src/app/core/community-feeds.ts`
- `src/app/core/community-feeds.test.ts`
- `src/app/core/community-live.ts`
- `src/app/core/community-live.test.ts`
- `src/app/core/community-permissions.ts`
- `src/app/core/community-permissions.test.ts`
- `src/app/core/community-publication-contract.test.ts`
- `src/app/core/requests.ts`
- `src/app/core/requests.test.ts`
- `src/app/core/repo-collection-read-model.ts`
- `src/app/core/repo-collection-read-model.test.ts`
- `src/app/core/repo-collect-button.test.ts`
- `src/app/core/repo-community-context.ts`
- `src/app/core/event-activity-io.ts`
- `src/app/core/event-activity-io.test.ts`
- `src/app/core/community-route-transport.test.ts`
- `src/app/core/community-targeted-routes.test.ts`
- `src/app/core/community-widgets-route.test.ts`
- `src/app/core/reaction-operations.test.ts`
- `src/app/core/reaction-publication-contract.test.ts`
- `src/app/core/repo-community-context.test.ts`
- `src/app/components/CommunityMenu.svelte`
- `src/app/components/EventActivity.svelte`
- `src/app/components/ReactionSummary.svelte`
- `src/app/components/ReportDetails.svelte`
- `src/app/components/ThreadItem.svelte`
- `src/app/components/ThreadActions.svelte`
- `src/app/components/RoomItem.svelte`
- `src/app/components/ChannelMessage.svelte`
- `src/app/components/GoalItem.svelte`
- `src/app/components/GoalActions.svelte`
- `src/app/components/CalendarEventItem.svelte`
- `src/app/components/CalendarEventActions.svelte`
- `src/app/components/RepoCollectButton.svelte`
- `src/app/components/RepoCollectModal.svelte`
- `src/app/components/WidgetFrame.svelte`
- `src/app/components/WidgetModal.svelte`
- `src/app/components/community/CommunityExtensionsPrompt.svelte`
- `src/app/components/community/CommunityHomeWidgetSlot.svelte`
- `src/app/components/community/CommunityWidgetSlotLaunchers.svelte`
- `src/app/extensions/bridge.ts`
- `src/app/extensions/bridge.test.ts`
- `src/app/extensions/community-context.ts`
- `src/app/extensions/community-context.test.ts`
- `src/app/extensions/community-curation.ts`
- `src/app/extensions/community-curation.test.ts`
- `src/app/extensions/community-widget-slots.ts`
- `src/app/extensions/community-widget-slots.test.ts`
- `src/app/extensions/types.ts`
- `src/app/extensions/widget-grant-reactivity.test.ts`
- `src/app/util/notifications.ts`
- `src/app/util/notifications.test.ts`
- `src/routes/c/[community]/+page.svelte`
- `src/routes/c/[community]/threads/+page.svelte`
- `src/routes/c/[community]/threads/[thread]/+page.svelte`
- `src/routes/c/[community]/rooms/[room]/+page.svelte`
- `src/routes/c/[community]/git/+page.svelte`
- `src/routes/c/[community]/goals/+page.svelte`
- `src/routes/c/[community]/goals/[goal]/+page.svelte`
- `src/routes/c/[community]/calendar/+page.svelte`
- `src/routes/c/[community]/calendar/[event]/+page.svelte`
- `src/routes/c/[community]/permalinks/+page.svelte`
- `src/routes/c/[community]/widgets/+page.svelte`
- `src/routes/git/+page.svelte`
- `tests/e2e/community-room-recovery.spec.ts`
