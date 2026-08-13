# Investigation: UI unresponsive after `each_key_duplicate` in NotificationsModal

## Summary
Duplicate notification row ids (`event:<eventId>`) reached the keyed `{#each}` block in
`NotificationsModal.svelte`. Svelte 5 throws `each_key_duplicate` as an **uncaught error during
effect flush**, which destroys the app's root reactive effect — all event handlers stop firing and
every button in the UI goes dead. Fixed by deduping rows by id at the notification merge point.

## Symptoms
- Clicking any button in the UI has no effect after the bug triggers.
- Console: `Uncaught Svelte error: each_key_duplicate — Keyed each block has duplicate key
  `event:30c359d0...` at indexes 0 and 1` at `NotificationsModal.svelte` (keyed each at source
  line 362).
- Triggered right after repo-announcement publish/refresh activity (`[budabit:publish] relays
  {category: "repo-announcement", ...}` appears immediately before the crash).

## Root Cause
- `src/app/components/NotificationsModal.svelte:362` renders `{#each visibleRows as row (row.id)}`.
- `visibleRows` derives from `notificationCenterRows`
  (`src/app/util/notification-sources.ts:~3182`), which concatenated rows from 7+ sources
  (chat, community, moderation, repo-watch, widget, engagement, route) with **no dedupe by id**.
- Several sources generate ids as `` `event:${event.id}` ``. In particular,
  `buildRepoWatchNotificationRows` flatMaps over watch *candidates*; when two candidates (e.g. the
  same repo watched under different paths/communities) share the same `latestEvent`, two rows with
  the identical id are emitted. Cross-source collisions (repo-watch vs engagement vs chat) are also
  possible.
- Individual sources (`buildCommunityNotificationRows`, application rows) dedupe internally via
  `rowsById` maps, but the repo-watch builder and the final merge point did not.
- In Svelte 5, `each_key_duplicate` is a runtime error thrown inside the reactive flush; uncaught,
  it tears down the root effect tree → global loss of interactivity (matches the symptom exactly).

## Eliminated Hypotheses
- Git worker / VendorReadRouter failures (404s, `repo:getFile` timeout): handled and logged as
  caught errors (`[security-audit] Could not discover nested manifest ...`); they never escape as
  uncaught exceptions and cannot kill the host UI.
- Relay/WebSocket connection failures: routine, caught, and non-fatal.

## Fix
1. `src/app/util/notification-display.ts` — added `dedupeNotificationRowsById(rows)`: keeps the
   newest row (`createdAt`) per id.
2. `src/app/util/notification-sources.ts` — `notificationCenterRows` now wraps the merged
   source+route rows in `dedupeNotificationRowsById(...)` before sorting (central guarantee that
   the keyed each never sees duplicate ids).
3. `src/app/util/notification-sources.ts` — `buildRepoWatchNotificationRows` also dedupes its own
   output, since it is consumed independently (unread counts, etc.).
4. `src/app/util/notification-display.test.ts` — unit test covering duplicate-id collapse and
   newest-wins semantics.

## Verification
- `tsc --noEmit -p tsconfig.check.json`: no errors in changed files (3 pre-existing errors in an
  unrelated package test remain).
- `notification-display.test.ts`: 5/5 pass (incl. new dedupe test).
- `notification-sources.test.ts`: 35 failures both **before and after** the change under the
  ad-hoc vitest config (pre-existing env issue: root vitest workspace is broken by the
  uninitialized `packages/flotilla-extension-template` submodule; failures are
  `localStorage.removeItem is not a function` at module import, unrelated to this fix).

## Preventive Measures
- Any new notification source must either emit globally-unique row ids or rely on the central
  dedupe in `notificationCenterRows` (now in place).
- Consider a top-level `svelte:boundary` (or window `error` handler) around modal content so a
  single render error can't take down the whole app's interactivity.
- Follow-up: fix the vitest workspace so `notification-sources.test.ts` runs in CI
  (`packages/flotilla-extension-template` submodule not initialized).
