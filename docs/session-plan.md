# Session Plan

## Objective

- Fix community authority readiness so optional admission forms and fast multi-relay settling cannot leave content routes in a permanent incomplete-permission state.
- Replace internal permission-readiness copy with resource-specific loading and generic retry states while preserving meaningful membership and access-policy wording.
- Keep extension community APIs fail-closed, but align their readiness decision and copy with the host application.
- Restore the intentional aggregate calendar grant behavior: a grant for either calendar kind admits both all-day and timed calendar events.

## Constraints

- Current repository state is authoritative over this plan.
- `docs/session-checkpoint.md` is authoritative over compacted conversation summaries and older chat history.
- Branch `dev` tracks `origin/dev`; every verified phase must be committed and pushed there.
- Stage only intentional phase files and never overwrite concurrent user changes.
- Preserve fast first-relay authority use when all referenced profile-list evidence is available locally.
- Admission-form discovery is optional for content authority and must not block community feeds.
- Content remains fail-closed while required profile-list authority is genuinely unavailable.
- Preserve meaningful permission language for membership, applications, grants, denials, and access policy. Remove only loading/readiness implementation language.
- Preserve aggregate calendar grant and section behavior introduced by `9d2789ba6`; do not redesign calendar sections or restrict creation by selected event kind.
- Keep the extension bridge fail-closed when required profile-list evidence is missing; do not turn not-ready into a false denial or empty authoritative result.
- Never amend or force-push. After each phase push, reread the checkpoint and the entire plan and continue immediately unless complete or blocked.

## Phase 1: Authority Readiness Lifecycle

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Give required profile-list authority a coherent progressive lifecycle that is independent from optional admission-form discovery.

### Exit Criteria

- `activeCommunityPermissionStatus` readiness is based on required profile-list authority filters, not admission-form filters.
- Fast multi-relay results can become usable immediately when every authority filter is covered, while slower relay results can still advance terminal completeness.
- Status distinguishes usable evidence, continued loading, and terminal unavailability without freezing after the first settled relay.
- Stale viewer/definition generations cannot update the active status.
- Focused state-loading tests cover missing admission forms, delayed relay completion, partial authority, terminal failure, and stale generations.
- Focused tests, root check, formatting, and whitespace checks pass.
- Phase files and checkpoint advancement are committed and pushed.

### Steps

- Extend the community relay loader with a non-duplicating final-settlement update for early-settle requests.
- Track authority and admission-form requests separately; keep forms out of content authority readiness.
- Keep authority loading active until all relay attempts settle while allowing cached/covered authority to be used early.
- Add a generation-aware pure readiness classifier for active community consumers.
- Add focused regressions in `src/app/core/community-state-loading.test.ts` and helper tests as needed.

### Verification

- `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --project=main src/app/core/community-state-loading.test.ts`.
- `pnpm check`.
- Prettier check on intentional changed files.
- `git diff --check`.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing with completed evidence, verification results, changed files, next phase, next exit criteria, next action, and remaining risks.
- Inspect `git status`, `git diff`, and recent commits; stage only intentional phase files.
- Commit and push the phase. This is a transition, not a stopping point.
- Reread the checkpoint after push and confirm the next phase.
- Do not consider the phase complete until checkpoint update, verification, commit, push, and checkpoint reread succeed.
- Do not consider the whole plan complete unless the checkpoint says `Current Phase: Complete`.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- Otherwise immediately begin the next phase startup without an intermediate summary.

## Phase 2: Consumer Readiness And Copy

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Apply one readiness contract across community surfaces and expose only resource-specific loading or generic retry copy.

### Exit Criteria

- Calendar, threads, goals, rooms, repositories, permalinks, widgets, create flows, menus, access, admin, moderation, and publish gates use generation-aware authority readiness where relevant.
- Loading copy names the resource being loaded and no readiness state says community permissions are loading or incomplete.
- Terminal authority failures show a generic resource unavailable/retry state rather than an internal permission error.
- Meaningful access, membership, grant, and denial permission wording remains intact.
- Extension bridge requests retain fail-closed profile-list coverage, use generation-aware readiness, and return community-context loading copy.
- Screenshot automation and tests no longer depend on old permission-readiness copy.
- Focused tests, root check, formatting, and whitespace checks pass.
- Phase files and checkpoint advancement are committed and pushed.

### Steps

- Replace duplicated route predicates with the shared readiness classifier.
- Consolidate each resource's bootstrap, authority, and data-load branches under its normal loading label.
- Add generic resource retry states for terminal authority failure.
- Update create-flow toasts, menu labels, publish-gate titles, and extension bridge errors without changing genuine access-policy messages.
- Add focused source and behavior regressions for calendar, threads, goals, rooms, Git, and bridge readiness.

### Verification

- Focused main tests for community state, route transport, home readiness, bridge behavior, and loading copy.
- `pnpm check`.
- Prettier check on intentional changed files.
- `git diff --check`.

### Mandatory Closeout

- Verify every exit criterion, advance the checkpoint to Phase 3, inspect and stage only phase files, commit, push, and reread the checkpoint.
- Do not stop at the phase boundary unless complete or blocked.

### Continue

- If complete, perform the final response; otherwise immediately begin the next phase startup.

## Phase 3: Unified Calendar Admission And Final Validation

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Restore aggregate calendar writer admission throughout the broad-transport pipeline and verify the complete workflow.

### Exit Criteria

- A writer granted either `EVENT_DATE` or `EVENT_TIME` is admitted for both calendar event kinds in list, detail, wrapper, follow-up, and notification flows.
- Calendar creation and section naming retain their existing aggregate behavior.
- No change introduces per-kind calendar publishing restrictions or section remapping.
- Regression tests prove both one-kind grant directions for direct events and targeted wrappers.
- Full main tests, root check, E2E typecheck, build, formatting, and whitespace checks pass, or a real blocker is recorded.
- Checkpoint says `Current Phase: Complete` with final evidence and residual risks.
- Final closeout commit is pushed and the checkpoint is reread.

### Steps

- Reuse `getCommunityCalendarTargetWriterPubkeys` for calendar relay/local filter plans.
- Use centralized wrapper authorization for layout follow-up discovery and aggregate writers for calendar notifications.
- Preserve existing aggregate creation gate and calendar section helper unchanged.
- Add focused calendar transport and permission regressions.
- Run focused and full verification, then complete the checkpoint.

### Verification

- Focused calendar, community permission, target-route, notification, and request tests.
- `NODE_OPTIONS=--no-experimental-webstorage pnpm test:main`.
- `pnpm check`.
- `pnpm run e2e:check`.
- `pnpm run build`.
- Prettier check on intentional changed files.
- `git diff --check`.

### Mandatory Closeout

- Verify every exit criterion.
- Update the checkpoint to `Current Phase: Complete` with final evidence, changed files, verification, and residual risks.
- Inspect status, diff, and log; stage only phase files, commit, and push.
- Reread the checkpoint and confirm it says Complete before the final response.
- Do not claim completion before that reread.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- Otherwise immediately resume the unresolved phase or stop only for a recorded blocker.
