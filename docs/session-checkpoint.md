# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Scale Communikey community content beyond relay `authors` array limits by using structural tag transport and current-grant client admission.
- Complete all four phases in `docs/session-plan.md`, committing and pushing every verified phase.

## Current Phase

- Phase 2: Community-Exclusive Content

## Phase Exit Criteria

- Room roots/messages and thread roots/replies use structural relay filters without ACL-derived authors.
- Route selectors and projections continue to reject unauthorized structurally valid events.
- Community activity, reactions, and direct repository transport use broad structural filters with local admission.
- Focused tests, root check, formatting, and whitespace checks pass.
- Phase files and checkpoint advancement are committed and pushed.

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

## Decisions

- Preserve current-grant visibility, including retroactive hide/reappear behavior after revocation/regrant.
- Use wrapper-author authority for targeted publications; explicit references may curate external originals.
- Require same-author originals for implicit targeting-ID associations.
- Keep exact authors for definitions, profile lists, personal metadata, forms, and address coordinates.
- Use four durable phases and push each verified phase to tracked `origin/dev`.

## Current State

- Repository: `/home/johnd/Work/budabit`.
- Branch: `dev`, tracking `origin/dev`.
- Phase 1 is verified and ready for durable closeout in the same commit as this checkpoint advancement.

## Next Action

- Reread the full plan, inspect current direct community routes and components, then migrate room/thread/activity/repository transport to Phase 1 filter plans.

## Verification

- Startup read the previous checkpoint and entire previous plan.
- `git status`, branch/upstream, remotes, recent log, and durable-document history were inspected.
- `HEAD` and `origin/dev` both resolved to `2947fb98648eee8e474ccbe08720b1774004d633` before plan creation.
- Phase 1 focused tests: `pnpm exec vitest run --project=main src/app/core/community-feeds.test.ts src/app/core/requests.test.ts` passed, 2 files and 22 tests.
- Phase 1 `pnpm check` passed with 0 errors and 0 warnings.
- Phase 1 intentional-file Prettier and `git diff --check` passed.
- Phase 1 review reported no high or medium blocking findings.

## Risks Or Blockers

- No current blocker.
- Broad `#h`/`#p` transport is vulnerable to unauthorized event volume; bounded pagination must report incomplete rather than false empty.
- A single profile-list event remains bounded by relay event/tag limits; sections need multiple list references for very large memberships.
- Targeted-publication consumers currently implement inconsistent wrapper/original authority and require careful phased migration.
- Broad-scan consumers must map `{complete:false, saturated:true}` to incomplete UI state when Phase 2 starts using relay filters.
- Targeted-wrapper authorization remains a caller precondition until Phase 3 centralizes it.

## Files

- `docs/session-plan.md`
- `docs/session-checkpoint.md`
- `src/app/core/community-feeds.ts`
- `src/app/core/community-feeds.test.ts`
- `src/app/core/requests.ts`
- `src/app/core/requests.test.ts`
