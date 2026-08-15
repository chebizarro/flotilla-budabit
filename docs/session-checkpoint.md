# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Fix community authority readiness and user-facing loading states without exposing internal permission hydration.
- Preserve aggregate calendar grants while restoring their use in broad-transport local admission.
- Complete all phases in `docs/session-plan.md`, committing and pushing every verified phase.

## Current Phase

- Phase 2: Consumer Readiness And Copy

## Phase Exit Criteria

- Community content, governance, menu, and publishing surfaces use generation-aware authority readiness where relevant.
- Loading copy names the resource and no readiness state exposes community-permission hydration.
- Terminal authority failure uses generic resource unavailable/retry copy while meaningful access-policy language remains.
- Extension bridge readiness stays fail-closed, becomes generation-aware, and returns community-context loading copy.
- Focused tests, root check, formatting, and whitespace checks pass.
- Phase changes and checkpoint advancement are committed, pushed, and reread.

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

## Decisions

- Remove only readiness-related permission copy; retain real membership and access-policy wording.
- Show resource-specific loading copy and generic resource unavailable/retry copy on terminal failure.
- Keep extension requests fail-closed when profile-list evidence is missing.
- Keep aggregate calendar grants, creation behavior, and section naming unchanged.
- Use three durable phases and push each verified phase to tracked `origin/dev`.

## Current State

- Repository: `/home/johnd/Work/budabit`.
- Branch: `dev`, tracking `origin/dev`.
- Worktree was clean at plan creation.
- Local branch started three commits ahead of `origin/dev`: `c42ecb8f6`, `19b22b08c`, and `72f31b2f8`.
- Phase 1 implementation is verified and ready for its closeout commit and push.

## Next Action

- Replace duplicated consumer predicates with shared authority/form readiness and update readiness-only copy, starting with calendar, threads, and goals.

## Verification

- Read the previous checkpoint and entire previous session plan before replacing them for this workflow.
- Inspected status, branch tracking, remotes, recent commits, and durable-document history.
- Confirmed current branch state is clean and current code is authoritative over stale previous closeout text.
- Phase 1 focused suite passed 48 tests in `src/app/core/community-state-loading.test.ts`.
- Phase 1 `pnpm check` passed with 0 errors and 0 warnings.
- Phase 1 changed-file Prettier and `git diff --check` passed.
- Phase 1 independent final review approved the lifecycle with no high/medium findings.

## Risks Or Blockers

- No current blocker.
- Cached authority remains intentionally usable during refresh; terminal relay failure must not turn known authority into an unrestricted selector.
- Admission forms need separate readiness where access-request UI depends on proving their absence.
- Moderation report/delete completeness remains a separate concern outside this workflow.
- Node 25 jsdom tests require `NODE_OPTIONS=--no-experimental-webstorage` in this environment.

## Files

- `docs/session-plan.md`
- `docs/session-checkpoint.md`
- `src/app/core/community-state.ts`
- `src/app/core/community-state-loading.test.ts`
