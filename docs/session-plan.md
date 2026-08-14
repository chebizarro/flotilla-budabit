# Session Plan

## Objective

- Remove section writer-count limits from community content transport by querying stable structural tags and enforcing current Communikey grants client-side.
- Preserve the current visibility policy: current section grants determine whether historical and live content is visible.
- Treat `authors` as an optional transport optimization, never as the authorization boundary for community content.
- Define targeted-publication authority consistently: an authorized `kind:30222` wrapper may curate an external original; implicit targeting-ID originals must be signed by the wrapper author.
- Keep exact identity and address-coordinate author filters for definitions, profile lists, forms, personal metadata, and `kind:pubkey:d` references.

## Constraints

- Current repository state is authoritative over this plan.
- `docs/session-checkpoint.md` is authoritative over compacted conversation summaries and older chat history.
- Branch `dev` tracks `origin/dev`; every verified phase must be committed and pushed there.
- Stage only intentional phase files and never overwrite concurrent user changes.
- Current-grant authorization remains fail-closed while community definition or profile-list evidence is unavailable.
- A broad relay result is transport evidence only. Every rendered or extension-returned event must pass local structural and grant admission.
- Broad history must paginate by raw relay events and distinguish saturated/incomplete scans from authoritative empty results.
- Targetable originals do not generally carry `h=<community>`; discover wrappers through `#p`, then load originals by targeting ID, event ID, or exact address.
- Exact `authors` fields that identify an event coordinate are not ACL arrays and must remain.
- Never amend or force-push. After each phase push, reread the checkpoint and the entire plan and continue immediately unless complete or blocked.

## Phase 1: Transport And Admission Primitives

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Separate relay discovery filters from authoritative local selection and provide reusable community filter plans.

### Exit Criteria

- Community filter plans expose structural relay filters separately from current-writer local filters.
- Empty or unresolved writer evidence cannot create an unrestricted local selector.
- `makeFeed` can query broad relay filters while admitting repository, cache, tracker, and initial events through local filters.
- Pagination continues past unauthorized-only pages within a bounded scan and reports incomplete rather than authoritative empty when saturated.
- Exact address references retain their singleton coordinate author.
- Focused community-feed and request tests, root check, formatting, and whitespace checks pass.
- Phase files and checkpoint advancement are committed and pushed.

### Steps

- Add direct-content and targeted-original filter-plan helpers in `src/app/core/community-feeds.ts`.
- Extend `makeFeed` in `src/app/core/requests.ts` with separate relay filters and an admission-aware bounded scan.
- Keep existing callers backward compatible until migrated.
- Add focused tests proving an author beyond 1,000 is not dropped from relay discovery and unauthorized repository events remain excluded.

### Verification

- `pnpm exec vitest run --project=main src/app/core/community-feeds.test.ts src/app/core/requests.test.ts`.
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

## Phase 2: Community-Exclusive Content

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Move room, thread, message, comment, reaction, and direct repository transport to stable `#h` filters while retaining current-writer admission locally.

### Exit Criteria

- Room roots/messages and thread roots/replies use structural relay filters without ACL-derived authors.
- Route cache selectors and projections continue to reject structurally valid events from unauthorized authors.
- Direct detail hydration and recovery use structural IDs/root tags on the wire and local author admission.
- Community-scoped activity and reaction transport no longer carries large ACL arrays.
- Current-grant changes restart/refilter relevant views so revocation hides history and regrant can refetch it.
- Focused unit and community E2E tests cover authorized and outsider events with identical structural tags.
- Root check, formatting, and whitespace checks pass.
- Phase files and checkpoint advancement are committed and pushed.

### Steps

- Migrate community home/menu room selectors and finite room-root loads.
- Migrate thread list/detail and room detail/message feeds to dual filter plans.
- Separate transport and local selection in `EventActivity` and `ReactionSummary` for community-scoped calls.
- Migrate direct community repository announcements and fix the existing broad global Git selector to apply local writer admission.
- Add focused route/helper and recovery coverage.

### Verification

- Focused main tests for community feeds, requests, activity, reactions, and repository community contexts.
- `pnpm exec playwright test tests/e2e/community-room-recovery.spec.ts` when the controlled E2E environment is available.
- `pnpm check`.
- Prettier and `git diff --check`.

### Mandatory Closeout

- Verify every exit criterion, advance the checkpoint to Phase 3, inspect and stage only phase files, commit, push, and reread the checkpoint.
- Do not stop at the phase boundary unless complete or blocked.

### Continue

- If complete, perform the final response; otherwise immediately begin the next phase startup.

## Phase 3: Targeted Publications And Extensions

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Apply wrapper-author authority consistently to calendar, goals, repositories, permalinks, widgets, and extension community queries without large original-author ACL filters.

### Exit Criteria

- `kind:30222` wrappers are discovered by `#p=<community>` and admitted only when the wrapper author has the current section grant.
- Explicit `e` originals load by exact ID and explicit `a` originals retain exact coordinate author plus `#d`.
- Implicit `h=<targeting-id>` originals require the original author to equal the authorized wrapper author and cannot be starved by `limit:1` collisions.
- Authorized wrappers may associate external-author originals through explicit references.
- Calendar, goals, repositories, permalinks, widgets, notifications used by those routes, and extension descriptor queries share these semantics.
- Broad extension relay results are post-filtered before being returned to widgets.
- Focused target-flow and extension tests, root check, formatting, and whitespace checks pass.
- Phase files and checkpoint advancement are committed and pushed.

### Steps

- Centralize wrapper admission and targeted-original association validation.
- Migrate list/detail route filters and projections for each targetable feature.
- Split extension descriptor relay filters from local authorized result filters.
- Remove obsolete original-author ACL requirements while preserving exact address identity.
- Add collision, external-original, unauthorized-wrapper, and extension-boundary tests.

### Verification

- Focused main tests for community targeting, calendar/goals/repository contexts, descriptor query plans, bridge queries, and curation.
- `pnpm check`.
- Prettier and `git diff --check`.

### Mandatory Closeout

- Verify every exit criterion, advance the checkpoint to Phase 4, inspect and stage only phase files, commit, push, and reread the checkpoint.
- Do not stop at the phase boundary unless complete or blocked.

### Continue

- If complete, perform the final response; otherwise immediately begin the next phase startup.

## Phase 4: Notifications Documentation And Final Validation

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Finish remaining community content consumers, document the architecture, and verify the complete migration.

### Exit Criteria

- Active and global notification sources use broad structural transport with current-grant local row admission and no redundant large ACL wire filters.
- An audit finds no ACL-derived `authors` arrays on community content transport; exact authority, identity, personal metadata, and address-coordinate filters remain.
- Communikey and Budabit architecture docs describe tag discovery, client-side current-grant admission, targeted wrapper authority, pagination saturation, and profile-list sharding limits.
- Tests include more than 1,000 writers, outsider spam pages, revocation/regrant behavior, wrapper-author curation, and retained exact authority filters.
- Full main tests, root check, E2E typecheck, build, formatting, and whitespace checks pass, or a real blocker is recorded.
- Checkpoint says `Current Phase: Complete` with final evidence and residual risks.
- Final closeout commit is pushed and the checkpoint is reread.

### Steps

- Migrate remaining notification and shared community consumers.
- Audit all community-related `authors` construction and classify retained exact uses.
- Update `Communikeys.md`, `Budabit-Community-Architecture.md`, moderation guidance, and relay scheduling guidance.
- Run focused and broad verification, repair regressions, and complete the checkpoint.

### Verification

- Focused main community and notification tests.
- `pnpm test:main`.
- `pnpm check`.
- `pnpm run e2e:check`.
- `pnpm run build`.
- Prettier and `git diff --check`.

### Mandatory Closeout

- Verify every exit criterion.
- Update the checkpoint to `Current Phase: Complete` with final evidence, changed files, verification, and residual risks.
- Inspect status, diff, and log; stage only phase files, commit, and push.
- Reread the checkpoint and confirm it says Complete before the final response.
- Do not claim completion before that reread.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- Otherwise immediately resume the unresolved phase or stop only for a recorded blocker.
