# Budabit Performance Journal

This document is the living record of Budabit performance findings, policies,
experiments, improvements, regressions, and validation results. It is intended
to preserve not only what changed, but also what was believed at the time, why
it was changed, and whether production evidence supported the decision.

Current code remains authoritative. Journal entries describe the repository at
their recorded commit and may become historical as the implementation changes.

## Record Conventions

Established 2026-08-23 at `217e23abb`.

Every material record should include:

- Date in `YYYY-MM-DD` form.
- Commit hash for the code that was inspected, changed, or validated.
- Status: `Observed`, `Proposed`, `In progress`, `Landed`, `Validated`,
  `Rejected`, `Reverted`, or `Superseded`.
- A description of the user-visible symptom and the implementation mechanism.
- The affected routes and source locations.
- For a landed change, its implementation commit.
- For a validated change, the environment, workload, metric, and result.
- For a rejected or reverted change, the reason and evidence.

When a finding changes state, append a dated update to its history rather than
rewriting the original observation. Corrections to factual errors should be
explicitly identified as corrections.

## Performance Policies

### Responsiveness Is A Startup Requirement

Draft policy recorded 2026-08-23 at `217e23abb`.

Time to complete loading is not the only startup metric. Navigation and other
basic input must remain responsive while cache hydration, relay backfills,
event verification, and reactive projections continue. A page that displays
content but starves input is not considered loaded successfully.

### Critical Paths Must Be Explicit

Draft policy recorded 2026-08-23 at `217e23abb`.

Work required for the current visible surface should have priority over global
reconciliation and work for unopened surfaces. Authentication, persistence,
notifications, Git account data, wallet state, and historical backfills should
not become startup dependencies merely because they are globally useful.

### A Time Budget Must Bound CPU Work

Draft policy recorded 2026-08-23 at `217e23abb`.

Racing a timer against a promise does not bound synchronous work that begins
after the promise resolves. Work described as bounded must be interruptible or
split into batches that yield to input and navigation.

## Baseline Investigation

Investigation recorded 2026-08-23 at `217e23abb` (`improve explore community
search`).

The production symptom was especially severe on mobile cold starts of the
community home route, `/c/[community]`, and the `/git` repository list. Warm
caches substantially improved both loading and navigation responsiveness. The
initial investigation therefore focused on unnecessary startup work, loading
order, and implementation bugs that amplify event publication and main-thread
recomputation.

No controlled timing baseline was captured with this first journal entry.
Future validation should include navigation latency during bootstrap, long
tasks over 50 ms, request ownership, and events published per task under a
documented mobile CPU and network profile.

## Obvious-Flaws Batch

Landed 2026-08-23 on `performance-obvious-flaws-fix`. Status: `Landed`, not
`Validated`.

The first bounded implementation round is represented by these commits:

- `cb7272042`: read-only IndexedDB reads and Git synchronization ownership.
- `a12559193`: DM cold-start hydration and conditional fallback.
- `f82aad369`: notification candidate and audio lifecycle cleanup.
- `e0ff70c4a`: community finite-request terminal cleanup and retry.
- `31295887d`: responsive secondary-navigation mounting.
- `f1ddf78be`: committed Git list navigation teardown.

Integrated verification passed 16 focused Vitest files with 121 tests,
`pnpm check`, `pnpm e2e:check`, affected-file Prettier checks, and
`git diff --check`. Fifteen targeted Git list, detail, and search Playwright
tests passed sequentially. Six selected community room Playwright tests failed
before their expected mock-relay subscriptions or room content appeared. The
representative recovery failure reproduced unchanged in an isolated worktree at
pre-batch commit `1073e907f`, so it is recorded as a pre-existing browser-test
baseline gap rather than validation of or a regression from this batch.

No controlled production/mobile timing, request-count trace, long-task profile,
or input-latency comparison was captured. These entries therefore use `Landed`
and must not be promoted to `Validated` from test evidence alone.

## Finding 001: Persisted State Hydration Blocks The Entire UI

Observed 2026-08-23 at `217e23abb`. Status: `Observed`.

### Symptom

On a cold start, the application can show no usable shell or navigation while
IndexedDB opens and persisted stores hydrate. A blocked database open can hold
the UI for the five-second timeout, and a successful open can still be followed
by substantial event replay before the first page mounts.

### Current Mechanism

The root layout renders its children only after the `unsubscribe` startup
promise settles:

- `src/routes/+layout.svelte:1081-1109` restores identity, configures storage,
  and awaits `db.connectWithTimeout()`.
- `src/routes/+layout.svelte:1256-1269` places `AppContainer` and all route
  children behind `{#await unsubscribe}`.
- `src/lib/indexeddb.ts:69-105` opens the database and awaits initialization of
  every configured adapter.
- `src/app/util/storage.ts:143-325` initializes persisted event, tracker,
  relay, profile, handle, zapper, and plaintext stores with full-store reads.

Persisted events and relay provenance are replayed item by item into global
repositories. Those insertions can update indexes and notify derived stores
before the route becomes usable. In addition, `IDB.getAll()` opens a
`readwrite` transaction even though it only reads:
`src/lib/indexeddb.ts:138-149`.

### Deeper Lesson

Persistence availability and interface availability are separate concerns.
Cache hydration can improve warm rendering without being a prerequisite for
mounting navigation. A cache-first design becomes a startup regression if the
entire cache must be replayed before the user can interact.

### Potential Fixes

Proposed 2026-08-23 at `217e23abb`. Status: `Proposed`.

- Restore the minimum synchronous identity/session state, then mount the
  application shell and navigation immediately.
- Connect IndexedDB concurrently and use hydration completion only when
  deciding whether an empty result is authoritative.
- Keep only narrowly justified current-route cache data in the foreground.
- Stage relay statistics, handles, zappers, plaintext, and tracker provenance
  after the visible route has started.
- Change read-only `getAll()` operations to `readonly` transactions.
- Batch persisted repository publication and yield between bounded batches.
- Preserve a visible recovery shell if the database open is blocked or fails.

### Validation Needed

- Cold start with an empty database.
- Cold start with a representative large persisted event and tracker database.
- Cold start while another tab or installed PWA context blocks IndexedDB.
- Navigation input issued repeatedly during hydration.
- Confirmation that no page treats pre-hydration absence as authoritative.

### History

- 2026-08-23 `217e23abb`: finding recorded; no fix implemented yet.
- 2026-08-23 `cb7272042`: scoped fix landed. `IDB.getAll()` now uses a
  `readonly` transaction, covered by focused Vitest. The broader shell and
  staged-hydration work remains proposed and is not performance-validated.

## Finding 002: Global DM Startup Duplicates Work And Can Backfill Full History

Observed 2026-08-23 at `217e23abb`. Status: `Observed`.

### Symptom

Opening an unrelated route can start several requests per messaging relay and
publish a large burst of DM events. This consumes relay capacity and main-thread
time while the community home or repository list is trying to become usable.

### Current Mechanism

Global startup calls `syncApplicationData()`, which includes `syncDMs()`:
`src/routes/+layout.svelte:1121-1123` and
`src/app/core/sync.ts:374-380`.

For each messaging relay, startup may perform all of the following:

- A negentropy-aware `pull` for relays believed to support it.
- A loader-based fallback request for those same relays, even when the pull was
  already started: `src/app/core/sync.ts:65-89`.
- A separate bootstrap request capped at 200 events:
  `src/app/core/sync.ts:92-124`.
- A live request: `src/app/core/sync.ts:126-130`.

There is also an empty-to-hydrated transition bug. The initial empty messaging
relay list marks relay observation as complete. When persisted relays then
arrive, the first populated list can satisfy
`shouldBackfillFirstRelayHistory`, starting an uncapped full-history pull during
ordinary cold startup: `src/app/core/sync.ts:273-300`.

### Deeper Lesson

Fallback paths must be conditional on failure, not unconditional parallel work.
Reactive initialization must also distinguish "persisted state has not hydrated"
from "the authoritative state is empty". Conflating those states turns a normal
cold-start transition into migration or recovery work.

### Potential Fixes

Proposed 2026-08-23 at `217e23abb`. Status: `Proposed`.

- Globally start only the bounded recent/live DM path needed for notifications.
- Defer the 200-event bootstrap until idle or until the user enters `/chat`.
- Reserve full-history backfill for an explicit user action or a detected relay
  migration, never the normal persistence-hydration transition.
- Track messaging-relay hydration readiness separately from an authoritative
  empty list.
- On negentropy-capable relays, run loader fallback only after pull failure or a
  bounded timeout rather than in parallel.
- Preserve route ownership and cancellation so DM work can yield to foreground
  community and Git requests.

### Validation Needed

- Logged-in cold start with zero, one, and several messaging relays.
- Persisted relay-list hydration from an initially empty in-memory store.
- Negentropy success, timeout, and failure paths.
- Confirmation that unread DM indicators remain correct before full history is
  loaded.
- Request counts and event-publication bursts while entering `/c/[community]`
  and `/git`.

### History

- 2026-08-23 `217e23abb`: finding recorded; no fix implemented yet.
- 2026-08-23 `a12559193`: fix landed. Unhydrated `null` messaging-relay state no
  longer triggers migration backfill when persisted relays arrive; authoritative
  empty state still supports first-relay full-history recovery. Smart relays now
  use loader fallback only after negentropy rejection. Focused zero, one,
  multiple-relay, success, and failure tests passed; production request counts
  remain unvalidated.

## Finding 003: Git Account Data Is Loaded Twice On Every Authenticated Route

Observed 2026-08-23 at `217e23abb`. Status: `Observed`.

### Symptom

An authenticated visit to community home starts GRASP server, Git credential,
and extension-settings relay work even when the route does not need Git account
data. The initial fallback-relay batch is also issued twice, increasing cold
network traffic and downstream store updates.

### Current Mechanism

The root layout globally starts `syncGitData()`:
`src/routes/+layout.svelte:1121-1123`.

Within `syncUserGitData()`, `subscribeAll()` installs three synchronization
owners:

- `setupGraspServersSync()`.
- `setupTokensSync()`.
- `setupExtensionSettingsSync()`.

Each setup function already invokes its corresponding load in
`src/app/core/git-requests.ts:173-191`, `199-247`, and `255-301`.
Immediately afterward, `subscribeAll()` explicitly invokes all three loads
again at `src/app/core/sync.ts:416-437`.

The fallback relay batch starts immediately, and a different resolved user
relay set can trigger another load at `src/app/core/sync.ts:490-511`.

### Deeper Lesson

A synchronization setup function should have one clear contract: either it
subscribes and performs initial hydration, or it only subscribes and leaves
hydration to the caller. Mixing both contracts makes duplicate I/O difficult to
see and easy to reintroduce. Global ownership also needs to be justified by
cross-route user value, not implementation convenience.

### Potential Fixes

Proposed 2026-08-23 at `217e23abb`. Status: `Proposed`.

- Choose one initial-load owner: remove the explicit loads in `subscribeAll()`
  or make each `setup*Sync()` subscription-only.
- Defer GRASP server and Git-token hydration until `/git`, a Git action, or a
  later idle phase.
- Keep extension settings early only where they are required to determine the
  visible community widget surface.
- Normalize and compare fallback and resolved relay sets before reloading.
- Coalesce overlapping fallback/user relay work instead of starting independent
  batches.
- Make loader functions return their actual request promises so failures,
  cancellation, and completion can be observed by their owner.

### Validation Needed

- Request-count assertion proving one initial request per data class and relay
  scope.
- Authenticated cold starts on `/c/[community]`, `/git`, and a non-Git route.
- Fallback relay sets equal to, overlapping, and disjoint from resolved user
  relay sets.
- Confirmation that widgets, repository operations, and authenticated Git
  actions still receive required settings before use.

### History

- 2026-08-23 `217e23abb`: finding recorded; no fix implemented yet.
- 2026-08-23 `cb7272042`: duplicate-load contract fix landed. The three setup
  functions retain initial-load ownership, explicit duplicate loads were
  removed, and loader functions now return the underlying request promises.
  Focused request-count and completion tests passed. Deferring Git account data
  from unrelated routes remains proposed.

## Finding 004: A Hidden Community Menu Performs Foreground Work

Observed 2026-08-23 at `217e23abb`. Status: `Observed`.

### Symptom

Mobile users pay for community-menu data derivation and relay requests on both
community home and `/git` even though the desktop secondary navigation is not
visible and the mobile drawer has not been opened.

### Current Mechanism

The community layout mounts `CommunityMenu` unconditionally at
`src/routes/c/[community]/+layout.svelte:718-721`. The Git layout also mounts it
whenever an active community exists at `src/routes/git/+layout.svelte:68-71`.
`SecondaryNav` hides its children below the `lg` breakpoint with CSS rather than
avoiding component creation: `src/lib/components/SecondaryNav.svelte:10-12`.

The mounted menu derives room, badge, badge-award, admission, report, delete,
review, and permission projections at
`src/app/components/CommunityMenu.svelte:147-397`. Two animation frames after
mount it begins admission evidence, report evidence, badge, profile badge, and
admission response requests: `src/app/components/CommunityMenu.svelte:409-553`.

### Deeper Lesson

CSS visibility is not execution visibility. Responsive interfaces must avoid
mounting expensive hidden surfaces, or explicitly suspend their effects until
the surface becomes visible.

### Potential Fixes

Proposed 2026-08-23 at `217e23abb`. Status: `Proposed`.

- Do not mount `CommunityMenu` on mobile until the drawer is opened.
- Split cheap navigation links from expensive count and evidence projections.
- On desktop, load non-visible counts after foreground route work settles.
- Move badge and moderation evidence to their destination pages or request it
  when the menu section becomes visible.
- Preserve cached indicators without refreshing their full evidence during the
  initial page bootstrap.

### Validation Needed

- Compare mobile request ownership and long tasks with the drawer unopened.
- Confirm opening the drawer starts required work and shows truthful loading
  states.
- Confirm desktop navigation remains immediately available.

### History

- 2026-08-23 `217e23abb`: finding recorded; no fix implemented yet.
- 2026-08-23 `31295887d`: fix landed. `SecondaryNav` now mounts children only
  while its responsive media query matches, preserving the `lg` default and
  chat's `md` breakpoint. Community and Git mobile drawers remain
  interaction-owned. Responsive contract tests and type checks passed; a
  controlled mobile request trace remains needed before marking this validated.

## Finding 005: Post-Paint Community Work Is Released In One Burst

Observed 2026-08-23 at `217e23abb`. Status: `Observed`.

### Symptom

Community home can paint and then become difficult to navigate as several relay
loads begin producing events at once. Two animation frames improve first paint
but do not preserve responsiveness after paint.

### Current Mechanism

One shared `communityBackgroundHydrationReady` flag becomes true after a Svelte
tick and two animation frames: `src/routes/c/[community]/+layout.svelte:261-279`.
That single flag releases:

- One month of message and historical discovery work at
  `src/routes/c/[community]/+layout.svelte:409-467`.
- Per-relay finite lifecycle follow-up plans at
  `src/routes/c/[community]/+layout.svelte:469-545`.
- Community delete hydration at
  `src/routes/c/[community]/+layout.svelte:547-602`.
- Live subscriptions for every active community relay at
  `src/routes/c/[community]/+layout.svelte:604-699`.

The page independently starts moderator-invite evidence and room-root history at
`src/routes/c/[community]/+page.svelte:492-692`. Global notifications and widget
loads can begin during the same period.

### Deeper Lesson

First paint is not an idle signal. Startup work needs ordered lanes based on
visible value and input responsiveness, not a shared post-paint boolean.
Deferring a large uninterrupted computation also does not make it background
work.

### Potential Fixes

Proposed 2026-08-23 at `217e23abb`. Status: `Proposed`.

- Use separate readiness gates for definition/authority, visible room roots,
  core live traffic, finite follow-up, deletes, history, notifications, and
  widgets.
- Load definition and authority first, followed by a small room-root page.
- Establish one core live stream before beginning historical backfill.
- Start delete checkpoints and finite follow-ups in later tasks.
- Defer month history and notification backfills until the page has remained
  responsive or the destination page needs them.
- Yield between event-processing batches and stop queued work when navigation
  begins.

### Validation Needed

- Record the startup request timeline by scheduler owner and priority.
- Measure navigation latency during the first ten seconds, not only first paint.
- Confirm live-before-backfill ordering does not lose events.
- Confirm delayed delete and history work does not create false empty states.

### History

- 2026-08-23 `217e23abb`: finding recorded; no fix implemented yet.

## Finding 006: Notification Startup Is Global And Cannot Be Fully Stopped

Observed 2026-08-23 at `217e23abb`. Status: `Observed`.

### Symptom

Community, repository-watch, and widget-update notification reconciliation
competes with visible home and Git work. Disabling the notification background
does not necessarily remove all candidate subscriptions and network effects.

### Current Mechanism

The root starts notification background immediately on every route except
`/explore`: `src/routes/+layout.svelte:252-290`. Startup activates Budabit
notification candidates, repository watches, widget updates, and badge updates
at `src/routes/+layout.svelte:228-239`.

Community notification candidates load targeting history and referenced roots
at `src/app/util/notifications.ts:680-836`. Repository-watch notification
stores start grouped finite history and live subscriptions at
`src/app/util/repo-watch-notifications.ts:1022-1182`. Widget update notification
stores catch up and subscribe at
`src/app/extensions/widget-update-notifications.ts:230-277`.

`setupBudabitNotifications()` installs the candidate store but returns a no-op
cleanup: `src/app/util/notifications.ts:968-973`. Permanently mounted consumers,
including notification sound, can keep those candidates subscribed after the
background coordinator claims to have stopped them.

### Deeper Lesson

Persisted notification presentation and network notification reconciliation
are separate responsibilities. Background work needs an enforceable lifecycle;
a coordinator flag is insufficient when downstream stores remain subscribed.

### Potential Fixes

Proposed 2026-08-23 at `217e23abb`. Status: `Proposed`.

- Render persisted notification indicators immediately without network
  reconciliation.
- Start network reconciliation after foreground bootstrap or a documented idle
  delay.
- Gate every candidate network source on `notificationBackgroundEnabled`.
- Make `setupBudabitNotifications()` restore an empty candidate source during
  cleanup.
- Use one owned coordinator subscription rather than permanently mounted UI
  components to keep network-derived candidates alive.
- Prioritize current-route foreground requests over badge and watch history.

### Validation Needed

- Prove that disabling notification background leaves no notification-owned
  relay requests.
- Verify persisted unread indicators before reconciliation.
- Test notification correctness after delayed startup, navigation, logout, and
  visibility changes.

### History

- 2026-08-23 `217e23abb`: finding recorded; no fix implemented yet.
- 2026-08-23 `f82aad369`: lifecycle fix landed. Budabit notification candidate
  setup now returns identity-safe cleanup that restores an empty source and
  unsubscribes active candidate derivations. Stop/restart ownership tests and
  existing repository-watch/widget notification tests passed. Startup timing
  and global scheduling remain proposed.

## Finding 007: The Root JavaScript Graph Dominates Both Nexus Pages

Observed and measured 2026-08-23 at `217e23abb`. Status: `Observed`.

### Symptom

Mobile pays substantial download, parse, and module-evaluation cost before
page-specific community or repository-list code can run. The community route is
small relative to the shared root graph, so page-only optimizations cannot
remove most cold JavaScript cost.

### Build Evidence

The generated production build at `217e23abb` had the following import-graph
sizes. Gzip values were calculated locally per generated asset and summed; they
are diagnostic estimates rather than transfer measurements from production.

| Entry graph                              | Raw JS/CSS | Gzip estimate |
| ---------------------------------------- | ---------: | ------------: |
| Root layout                              |   5.15 MiB |      1.66 MiB |
| Community layout and page including root |   5.25 MiB |      1.69 MiB |
| Git layout and list including root       |   5.55 MiB |      1.79 MiB |

One shared generated chunk was 1.83 MiB raw and approximately 536 KiB gzip. Its
source map included Svelte runtime code and a large Lucide icon graph.

### Current Mechanism

The root statically imports Git UI configuration, rich Git editors, Markdown,
notification infrastructure, extension infrastructure, and Cashu surfaces at
`src/routes/+layout.svelte:18-78`. `PrimaryNav` statically imports login,
settings, and the large notification modal at
`src/app/components/PrimaryNav.svelte:5-16`.

The extension barrel imported by the root exposes the large bridge graph:
`src/app/extensions/index.ts:1-6`. The flexible extension icon component imports
many icons from the `@lucide/svelte` package barrel at
`src/app/components/ExtensionIcon.svelte:2-39`.

### Deeper Lesson

Route splitting is defeated when route-specific implementations are registered
or imported at the application root. Shared configuration should not require
eager evaluation of every possible implementation.

### Potential Fixes

Proposed 2026-08-23 at `217e23abb`. Status: `Proposed`.

- Dynamically import login, settings, and notification modal bodies on use.
- Move rich Git editor and repository-detail component registration out of the
  global root where the provider contract permits it.
- Import the extension provider directly rather than through a bridge-heavy
  barrel.
- Split extension bridge handlers by capability or surface.
- Import individual Lucide icon modules and verify the resulting bundle graph.
- Dynamically import repo creation/import dialogs and worker-facing modules on
  interaction.
- Add a repeatable bundle report so chunk movement is validated rather than
  inferred from source imports.

### Validation Needed

- Compare initial transferred, parsed, and evaluated JavaScript for both nexus
  routes.
- Verify lazy surfaces still open without observable interaction delay.
- Record bundle reports before and after each split to detect graph migration.

### History

- 2026-08-23 `217e23abb`: build graph measured; no split implemented yet.

## Finding 008: First Service-Worker Installation Precaches The Whole App

Observed and measured 2026-08-23 at `217e23abb`. Status: `Observed`.

### Symptom

On a first production visit, service-worker installation competes with critical
application and relay traffic for mobile bandwidth, CPU, and storage I/O.

### Current Mechanism

The worker includes every generated build and static file that passes a small
path filter: `src/service-worker.js:35-43`. Installation fetches the resulting
app shell in batches of 12: `src/service-worker.js:96-127`.

The generated precache at `217e23abb` contained 329 files totaling 10.92 MiB raw
and approximately 3.17 MiB gzip. Root update initialization performs an
immediate version check and registration at
`src/routes/+layout.svelte:735-805`, `994-1040`.

### Deeper Lesson

Offline completeness and first-visit responsiveness have different deadlines.
An atomic cache can remain a product requirement without beginning its complete
download during the foreground bootstrap window.

### Potential Fixes

Proposed 2026-08-23 at `217e23abb`. Status: `Proposed`.

- Delay first update check and registration until load plus an idle or
  foreground-readiness signal.
- Preserve focus, visibility, and online update checks after initialization.
- If the atomic update contract allows it, precache a critical shell first and
  fill noncritical route chunks afterward.
- At minimum, exclude noncritical media and interaction-only assets from first
  installation.
- Measure production transfer contention before changing atomic cache policy.

### Validation Needed

- First visit with no worker or Cache API entries.
- Existing active worker with a new release installing in the background.
- Slow mobile network while community and Git relay traffic starts.
- Offline and atomic-version correctness after any cache-scope change.

### History

- 2026-08-23 `217e23abb`: precache measured; no fix implemented yet.

## Finding 009: The Repository Sidecar Cache Opens Globally

Observed 2026-08-23 at `217e23abb`. Status: `Observed`.

### Symptom

Community home can open and scan a second large IndexedDB database intended for
repository activity, competing with primary persistence and community
bootstrap.

### Current Mechanism

The root calls `setupRepositoryCache()` immediately after primary database
connection at `src/routes/+layout.svelte:1108-1112`. Its subscription to
`userRepoWatch` can call `reconcileWatched()`, which forces a complete sidecar
load: `src/app/core/repo-cache.ts:347-365`, `860-883`.

The sidecar policy permits up to 8,000 events and 16 MiB:
`src/app/core/repo-cache.ts:49-59`.

### Deeper Lesson

The existence of a global cache does not require global eager hydration. Cache
ownership should follow the routes and background features that consume it.

### Potential Fixes

Proposed 2026-08-23 at `217e23abb`. Status: `Proposed`.

- Open and reconcile the sidecar when entering `/git`, opening a repository, or
  enabling watched-repository notification work.
- Keep setup idempotent so the first real consumer owns initialization.
- Delay its repository update listener until primary persisted-event replay is
  complete to avoid recaching replayed data.
- Add an index or compact metadata path when only watched addresses are needed.

### Validation Needed

- Community cold start with a near-policy-limit repository cache.
- Git and watched-notification startup after deferred initialization.
- Concurrent consumers requesting initialization at the same time.

### History

- 2026-08-23 `217e23abb`: finding recorded; no fix implemented yet.

## Finding 010: Community Background Failures Can Suppress Future Loads

Observed 2026-08-23 at `217e23abb`. Status: `Observed`.

### Symptom

A failed community history, follow-up, or delete request can leave stale state,
produce an unhandled rejection, and prevent a later retry for the same load key.

### Current Mechanism

Three community layout effects attach `.then()` handlers without matching
`.catch()` and identity-safe final cleanup:

- History: `src/routes/c/[community]/+layout.svelte:442-466`.
- Follow-up: `src/routes/c/[community]/+layout.svelte:521-544`.
- Delete hydration: `src/routes/c/[community]/+layout.svelte:589-599`.

On rejection, controller fields and load keys may remain set and retry
scheduling is skipped. The room-root loader demonstrates a safer catch and
terminal-state pattern at `src/routes/c/[community]/+page.svelte:672-685`.

### Deeper Lesson

Request ownership includes terminal cleanup. A dedupe key becomes a permanent
failure cache when rejection does not clear it.

### Potential Fixes

Proposed 2026-08-23 at `217e23abb`. Status: `Proposed`.

- Add abort-aware catches to all three effects.
- Clear only the controller and key still owned by the settling request.
- Use `.finally()` for identity-safe controller cleanup.
- Schedule bounded retry using online and visibility state.
- Distinguish abort, timeout, partial completion, and unexpected failure.

### Validation Needed

- Rejection, timeout, disconnect, and navigation abort for each effect.
- Successful retry after a failed request with the same semantic key.
- No unhandled promise rejection in browser instrumentation.

### History

- 2026-08-23 `217e23abb`: implementation flaw recorded; no fix implemented yet.
- 2026-08-23 `e0ff70c4a`: fix landed. History, follow-up, and delete terminal
  paths now handle rejection, keep aborts quiet, guard state mutation by
  controller identity, and schedule retry after failure. Delete hydration now
  propagates relay failure instead of reporting a false successful empty result.
  Focused community lifecycle and route-contract tests passed.

## Finding 011: Community Home Widget Instances Duplicate Recovery Work

Observed 2026-08-23 at `217e23abb`. Status: `Observed`.

### Symptom

After room-catalog settlement, widget work can create another burst of relay
queries, repository scans, timers, frames, and lifecycle listeners even when
widget slots are below the viewport.

### Current Mechanism

Community home mounts an extension prompt and two `CommunityHomeWidgetSlot`
instances at `src/routes/c/[community]/+page.svelte:823-833`, `947-954`.
Each slot independently loads the same shared-config recovery filter at
`src/app/components/community/CommunityHomeWidgetSlot.svelte:356-406` and
maintains its own retry and page lifecycle machinery. Curated widget discovery
is partly promise-cached, but shared-config recovery is not shared by the two
instances.

The extension prompt also requests curated widgets independently at
`src/app/components/community/CommunityExtensionsPrompt.svelte:118-178`.

### Deeper Lesson

Component-level ownership is convenient but wasteful when several components
consume one semantic resource. Shared data should be loaded once at the nearest
common scope; visibility-specific projection can remain local.

### Potential Fixes

Proposed 2026-08-23 at `217e23abb`. Status: `Proposed`.

- Load shared widget configuration once per community/evidence/relay key.
- Pass or expose the shared result to both slots and the prompt.
- Keep one set of focus, online, visibility, and pageshow listeners.
- Mount or activate each widget slot only near viewport intersection.
- Defer extension availability prompting until fixed quick links are usable.

### Validation Needed

- Assert one shared-config request per semantic community key.
- Verify before/after slot filtering and extension prompts remain correct.
- Measure iframe and widget runtime activation below the fold.

### History

- 2026-08-23 `217e23abb`: finding recorded; no fix implemented yet.

## Finding 012: Git List Bootstrap Loads Broad Discovery Before Visible Scope

Observed 2026-08-23 at `217e23abb`. Status: `Observed`.

### Symptom

The `/git` list consumes announcements unrelated to the active tab, enlarges
global repository projections, and performs cache bookkeeping before the
visible personal, starred, community, or search scope has settled.

### Current Mechanism

The Git layout starts an unscoped live request equivalent to
`{kinds: [30617], limit: 100}` against up to six relays at
`src/app/core/repo-list-preload.ts:48-82`.

The page already owns narrower loaders for personal repositories, starred
addresses, community announcements, and account search in
`src/routes/git/+page.svelte:517-567`, `1038-1079`, `1123-1209`, and
`2359-2379`.

Broad unknown announcements cannot necessarily enter the verified sidecar, but
every repository update is still queued at `src/app/core/repo-cache.ts:826-873`
and can enter cloning, pruning, and comparison work before rejection at
`src/app/core/repo-cache.ts:512-546`, `652-678`.

### Deeper Lesson

Discovery and current-view loading are different products. A nexus page should
not download a discovery corpus to render a narrow initial view.

### Potential Fixes

Proposed 2026-08-23 at `217e23abb`. Status: `Proposed`.

- Remove broad live discovery from critical `/git` bootstrap.
- Start only the active mode's scoped request.
- Begin finite broad discovery after first cards, when search starts, or during
  a documented idle phase.
- Reject unknown direct announcements before expensive cache mutation work.
- Prefer a small index-backed first page for browse/search discovery.

### Validation Needed

- Personal, starred, community, and anonymous default modes.
- Search discovery before and after broad preload removal.
- Repository update and sidecar mutation counts during first load.

### History

- 2026-08-23 `217e23abb`: finding recorded; no fix implemented yet.

## Finding 013: Git Cache Hydration Is Neither Incremental Nor A Real Time Bound

Observed 2026-08-23 at `217e23abb`. Status: `Observed`.

### Symptom

The repository list can remain input-blocked while cached events are verified
and republished, even though hydration advertises a 250 ms route budget. Useful
scoped network requests also wait for this cache gate.

### Current Mechanism

The route races cache hydration with a 250 ms timer in
`src/app/core/repo-list-preload.ts:48-66`. Once IndexedDB resolves, hydration
runs an uninterrupted synchronous loop at
`src/app/core/repo-cache.ts:714-760` that can:

- Verify every event cryptographically.
- Scan and sort cached records.
- Perform recursive membership lookups.
- Recalculate repository metadata repeatedly.
- Republish records one by one into the global repository.

The event loop cannot fire the 250 ms timer during this synchronous work.
Personal, community, and collection loaders wait for the hydration-ready gate
in `src/routes/git/+page.svelte:525-530`, `1151-1163`, `1923-1927`,
`1980-1984`, and `2047-2051`.

Relay-list changes can set readiness false and restart preload work at
`src/routes/git/+layout.svelte:32-64` even after useful cache data was already
published.

### Deeper Lesson

A timeout bounds waiting only when work yields. Cache readiness should govern
truthful absence, not permission to start an independent network source.

### Potential Fixes

Proposed 2026-08-23 at `217e23abb`. Status: `Proposed`.

- Start active scoped network loading concurrently with cache hydration.
- Use hydration readiness only before declaring an empty state authoritative.
- Select and publish the newest announcement per eligible address first.
- Yield between small verification/publication batches.
- Process state and delete records after initial cards are available.
- Recalculate repository metadata once per affected address.
- Maintain event-ID/address indexes rather than repeatedly scanning all records.
- Hydrate once per layout mount; update network relay coverage independently.

### Validation Needed

- Empty, small, and near-policy-limit sidecar databases.
- Input latency during the synchronous phase under mobile CPU throttling.
- Cache/network races producing the same announcement.
- Relay-set changes after the first useful cache batch.

### History

- 2026-08-23 `217e23abb`: finding recorded; no fix implemented yet.

## Finding 014: Stars And Repository Collections Load Outside Their Visible Mode

Observed 2026-08-23 at `217e23abb`. Status: `Observed`.

### Symptom

Personal stars and multi-phase repository collections compete with first-card
loading even when the user is not viewing Starred or interacting with a
collection control.

### Current Mechanism

Personal star hydration starts whenever a user exists at
`src/routes/git/+page.svelte:1014-1032`. Reactions and deletes load sequentially
at `src/app/core/repo-stars-state.ts:154-181`.

Collection targets, deletes, and originals start in three phases at
`src/routes/git/+page.svelte:1911-2092`. Collection relays can include relays
from every writable community at `src/routes/git/+page.svelte:1759-1790`.

Star timeout wrappers race timers but do not abort underlying loads:
`src/app/core/repo-stars-state.ts:41-55`, `159-180`. Superseded work can continue
publishing events after the UI considers it timed out.

### Deeper Lesson

Data needed to enrich an optional tab is not current-page critical data. A
timeout without cancellation changes UI state but does not release resources.

### Potential Fixes

Proposed 2026-08-23 at `217e23abb`. Status: `Proposed`.

- Load stars immediately only in Starred mode.
- Outside Starred, retain cached state and hydrate only visible repository
  addresses after first cards.
- Start collection history when its surface opens or in a later idle lane.
- Cap and prioritize collection relays.
- Pass an abort signal through star loads and abort on timeout, supersession,
  and route destruction.
- Share the actual in-flight promise for equivalent hydration keys.

### Validation Needed

- Every Git mode with and without cached stars and collections.
- Timeout and rapid mode-switch cancellation.
- Star indicator correctness for cards entering and leaving the viewport.

### History

- 2026-08-23 `217e23abb`: finding recorded; no fix implemented yet.

## Finding 015: Repository Card Profile Enrichment Fans Out Per Person

Observed 2026-08-23 at `217e23abb`. Status: `Observed`.

### Symptom

The first rendered repository page can issue dozens of profile requests and
create duplicate profile-derived subscriptions before basic cards are stable.

### Current Mechanism

For each rendered card, the list collects owner, community owner, and up to
three maintainers at `src/routes/git/+page.svelte:3268-3293`, then calls
`loadBudabitProfile()` separately for every pubkey at
`src/routes/git/+page.svelte:3311-3322`. With 18 cards, this can approach 90
individual loads before deduplication effects.

Each visible maintainer creates both profile image and name consumers at
`src/app/components/RepoMaintainerList.svelte:59-79`. Relay permutations also
form distinct resolver keys at `src/app/core/profile-resolver.ts:75-100`.

### Deeper Lesson

Card identity and card enrichment should have separate readiness. Rendered is
not equivalent to visible, and repeated per-person loading is not batching.

### Potential Fixes

Proposed 2026-08-23 at `217e23abb`. Status: `Proposed`.

- Render repository-owned card metadata and pubkey placeholders first.
- Load owner profiles only for cards intersecting or approaching the viewport.
- Defer community-owner and maintainer profiles.
- Batch kind-0 filters by normalized relay set and cap concurrency.
- Add route cancellation to profile enrichment.
- Reuse one profile-derived value per maintainer row.

### Validation Needed

- Profile request count for the first mobile viewport.
- Fast scrolling, pagination, route teardown, and failed profile relays.
- Correct placeholder-to-profile upgrades without list reordering.

### History

- 2026-08-23 `217e23abb`: finding recorded; no fix implemented yet.

## Finding 016: Maintainer Verification Is Eager And Uses Incorrect Relay Grouping

Observed 2026-08-23 at `217e23abb`. Status: `Observed`.

### Symptom

Noncritical maintainer verification starts soon after first render, performs two
network rounds, and can still report incomplete or incorrect results because
evidence is queried on unrelated aggregate relays.

### Current Mechanism

Every rendered card becomes a verification target at
`src/routes/git/+page.svelte:3160-3188`. After a short timer, verification loads
pull requests and then applied statuses at
`src/routes/git/+page.svelte:3220-3258` and
`src/app/core/repo-card-verification.ts:103-215`.

The planner flattens all repository relays, keeps the first six globally, and
sends repository-specific filters to that aggregate set:
`src/app/core/repo-card-verification.ts:74-134`. This creates a filter/relay
cross-product and can omit the declared relays of later cards. Partial
completion is accepted without an immediate retry policy.

### Deeper Lesson

Proof enrichment must preserve the evidence scope of each subject. A global
relay cap applied after flattening is both inefficient and semantically wrong.
Optional proof should not delay or destabilize list navigation.

### Potential Fixes

Proposed 2026-08-23 at `217e23abb`. Status: `Proposed`.

- Remove remote maintainer verification from the repository list initially.
- Preserve cached positive verification where available.
- Perform full verification on the repository page.
- If list verification remains, limit it to viewport-visible cards that declare
  co-maintainers.
- Group every repository filter by that repository's own relay set.
- Cache results by announcement/evidence watermark and retry partial outcomes
  later with bounded backoff.

### Validation Needed

- Repositories whose relays occur after the former global six-relay cap.
- Mixed relay sets, partial completion, and cached-positive behavior.
- First-page request and long-task reduction with list verification disabled.

### History

- 2026-08-23 `217e23abb`: correctness and performance finding recorded; no fix implemented yet.

## Finding 017: Repository Cards Repeat Projection Work And Retain Search Contexts

Observed 2026-08-23 at `217e23abb`. Status: `Observed`.

### Symptom

Every profile, notification, reaction, or repository update can repeat parsing
and broad scans for every card. A long-lived list also retains full card arrays
for every search context used during the session.

### Current Mechanism

Per-card rendering repeatedly resolves profile relays and parses announcements
through `getRepoCardProfileRelays()` at
`src/routes/git/+page.svelte:812-842`, `4590-4592`.
`getCommunityRepoStargazerPubkeys()` scans community reactions per card at
`src/routes/git/+page.svelte:3529-3568`, `4593-4595`. Stable keys and
notification prioritization also repeatedly parse addresses and tags at
`src/routes/git/+page.svelte:260-311`.

`repoCardsByContext` retains arrays keyed by mode, tab, and search query at
`src/routes/git/+page.svelte:2446-2457`, `3087-3094`, `3421`.

The initial rendered cap is useful, but enrichment targets rendered cards rather
than actual viewport visibility.

### Deeper Lesson

Reactive updates are cheap only when projection work is incremental. Stable
event data should become a reusable card view model instead of being reparsed by
each render and enrichment path.

### Potential Fixes

Proposed 2026-08-23 at `217e23abb`. Status: `Proposed`.

- Build one per-address card view model containing stable key, parsed metadata,
  relay set, maintainers, community binding, stars, and notification status.
- Build stargazers-by-repository in one pass.
- Use one `IntersectionObserver` to activate card enrichment.
- Start with approximately one mobile viewport rather than enriching every
  rendered card.
- Bound `repoCardsByContext` with a small LRU and discard cleared search terms.
- Add simple rendered-window limits before adopting a virtualization library.

### Validation Needed

- Projection recomputation counts per incoming event.
- Long-lived search sessions across many queries.
- Scroll behavior and card state while contexts are evicted.

### History

- 2026-08-23 `217e23abb`: finding recorded; no fix implemented yet.

## Finding 018: Git Navigation Cleanup Can Permanently Stop A Mounted Page

Observed 2026-08-23 at `217e23abb`. Status: `Observed`.

### Symptom

A canceled or failed navigation can leave the repository list mounted but
unable to resume data loading.

### Current Mechanism

The Git layout and page abort work in `beforeNavigate` at
`src/routes/git/+layout.svelte:28-30` and
`src/routes/git/+page.svelte:3487-3489`. `stopGitPageReadWork()` permanently
marks page work stopped and clears controllers and timers at
`src/routes/git/+page.svelte:3449-3485`.

`beforeNavigate` runs before navigation is committed. Another hook can cancel,
or navigation can fail, while the current component remains mounted. Exact
pathname comparison also treats `/git/` differently from `/git`.

### Deeper Lesson

Speculative navigation cancellation and committed component teardown are
different lifecycle events. Irreversible cleanup belongs to committed teardown.

### Potential Fixes

Proposed 2026-08-23 at `217e23abb`. Status: `Proposed`.

- Move permanent cleanup to `onDestroy` or committed navigation cleanup.
- If early abort is required for responsiveness, recreate work when navigation
  is canceled.
- Compare route identity instead of exact path strings.
- Keep cancellation idempotent and generation-owned.

### Validation Needed

- Canceled, failed, same-route, trailing-slash, and successful navigation.
- Confirmation that early request abortion still protects destination startup.

### History

- 2026-08-23 `217e23abb`: correctness finding recorded; no fix implemented yet.
- 2026-08-23 `f1ddf78be`: fix landed. Speculative `beforeNavigate` teardown was
  removed from both Git list owners. The page performs irreversible cleanup in
  `onDestroy`, while the persistent layout stops preload after the committed
  route id leaves `/git`. Focused lifecycle tests passed, and 15 targeted Git
  list/detail/search Playwright tests passed sequentially.

## Finding 019: Full Community Preferences Compete With Git's Fast Path

Observed 2026-08-23 at `217e23abb`. Status: `Observed`.

### Symptom

The Git list attempts a narrow preferred-community load but the root
simultaneously starts the full authenticated community preference pipeline,
adding broad discovery and permission traffic to repository bootstrap.

### Current Mechanism

The Git page intentionally invokes the fast preferred-community list path at
`src/routes/git/+page.svelte:608-619`. The root excludes only `/explore` from
full `hydrateCommunityPreferences()` startup at
`src/routes/+layout.svelte:304-333`.

The full preference pipeline at `src/app/core/community-state.ts:2102-2287`
loads membership/admin/moderator evidence, broad definitions, profile lists,
reports, and deletes across selected communities. Its cache is process-local and
does not remove cold-start cost after a reload.

### Deeper Lesson

A component's optimized fast path provides no benefit when a global owner
starts the superseding heavy path concurrently. Loading policy must be
coordinated across route and root ownership.

### Potential Fixes

Proposed 2026-08-23 at `217e23abb`. Status: `Proposed`.

- Treat `/git` like `/explore` for initial full-preference suppression.
- Let the fast preferred-community list settle first.
- Start full authenticated preferences only when community mode requires them or
  in a later idle lane.
- Hydrate moderation/report evidence for visible communities rather than every
  preference candidate.

### Validation Needed

- Git startup in personal, starred, and community modes.
- Community selector correctness before and after full preference hydration.
- Request deduplication between fast and full paths.

### History

- 2026-08-23 `217e23abb`: finding recorded; no fix implemented yet.

## Finding 020: Several Interaction-Only Global Services Start Eagerly

Observed 2026-08-23 at `217e23abb`. Status: `Observed`.

### Symptom

Wallet initialization, notification audio, and update polling add module, I/O,
listener, and network work during cold startup although none is required to
navigate the current nexus page.

### Current Mechanism

Cashu implementation and confirmation UI are imported by the root, and an
existing wallet is initialized eagerly at `src/routes/+layout.svelte:53-62`,
`1125-1127`. Wallet initialization can open another IndexedDB and refresh state
through `src/app/core/cashu.ts:198-237`.

`NewNotificationSound` calls `audioElement.load()` during startup and discards
notification and visibility cleanup ownership at
`src/app/components/NewNotificationSound.svelte:10-35`.

App updates perform an immediate no-store version fetch and registration, then
repeat every 30 seconds and on focus, visibility, and online events at
`src/routes/+layout.svelte:735-805`. The anonymous `beforeunload` database-close
listener at `src/routes/+layout.svelte:1042-1043` cannot be removed during HMR.

Cashu initialization also retains a resolved initialization promise after an
internally caught failure, preventing a clean retry during the same session:
`src/app/core/cashu.ts:138-146`, `149-244`.

### Deeper Lesson

Application-lifetime ownership does not imply startup-time urgency. Optional
global services should initialize from explicit demand, persisted evidence, or a
lower-priority lifecycle stage.

### Potential Fixes

Proposed 2026-08-23 at `217e23abb`. Status: `Proposed`.

- Dynamically import Cashu implementation when a persisted seed is known, a
  wallet surface opens, or later idle time is available.
- Permit bounded wallet initialization retry after transient failure.
- Set notification audio to `preload="none"` and load only when enabled or first
  needed.
- Own and clean up notification and document listeners.
- Delay the first update check while preserving later periodic/focus checks.
- Store and remove the `beforeunload` handler during development teardown.

### Validation Needed

- Existing wallet and no-wallet cold starts.
- Wallet initialization failure followed by retry.
- Notification sound enabled/disabled and visibility transitions.
- Update discovery after delayed first registration.

### History

- 2026-08-23 `217e23abb`: grouped startup finding recorded; no fix implemented yet.
- 2026-08-23 `f82aad369`: notification-audio subset landed. Visibility and
  notification subscriptions are now mount-owned and removed on teardown,
  playback rejection is handled, and audio uses `preload="none"` without an
  eager `load()`. Cashu, update polling, and `beforeunload` work remain proposed.

## Finding 021: Community Hydration Bookkeeping Retains Unbounded Keys

Observed 2026-08-23 at `217e23abb`. Status: `Observed`.

### Symptom

Long-lived sessions can retain completed hydration and bootstrap-generation
metadata for communities and filter combinations that are no longer active.

### Current Mechanism

`completedCommunityBootstrap` is bounded, but
`completedCommunityHydrationKeys` and successful entries in
`communityBootstrapPromiseGenerations` are not equivalently bounded or removed:
`src/app/core/community-state.ts:386-403`, `3394-3497`.

Room hydration keys include serialized filters, relays, and permission state at
`src/routes/c/[community]/+page.svelte:307-317`, increasing retained key size and
invalidations.

### Deeper Lesson

Completion and deduplication metadata are caches and require the same explicit
size, lifetime, and canonical-key policy as event data.

### Potential Fixes

Proposed 2026-08-23 at `217e23abb`. Status: `Proposed`.

- Use bounded LRUs for hydration completion and generation metadata.
- Delete generation entries when their promise settles and no active owner
  remains.
- Replace full serialized filter objects with compact semantic keys or hashes.
- Record eviction behavior in tests for long-lived multi-community sessions.

### Validation Needed

- Navigation through more communities and permission generations than the
  intended cache bound.
- Correct reload after eviction.
- Heap snapshots showing released definitions and filter keys.

### History

- 2026-08-23 `217e23abb`: retention finding recorded; no fix implemented yet.

## Finding 022: Smaller Git And Community Hot Paths Compound Repository Bursts

Observed 2026-08-23 at `217e23abb`. Status: `Observed`.

### Symptom

Several individually smaller state and rendering issues add work or behavioral
instability during the same repository-update bursts as the larger findings.
They are unlikely to be the primary cold-start cause, but should remain in the
journal so they are not lost after higher-impact fixes land.

### Current Mechanism

The Git list imports `getInitialGitMode()` but determines its initial mode only
from current community context, then writes that result over the saved setting:
`src/routes/git/+page.svelte:145-151`, `430-439`, `471-492`. This can start a
different cold query path than the user previously selected.

Repository title-link navigation deliberately waits for a Svelte tick and an
animation frame before calling `goto()` at
`src/app/components/GitItem.svelte:134-147`. Other parts of the same card
navigate directly, creating inconsistent click latency during startup.

Community home scans all publication operations for each pending moderator
invite at `src/routes/c/[community]/+page.svelte:236-251`. The scan repeats when
publication state changes.

Client state imports `tailwindcss/colors` to select a small set of color values
at `src/app/core/state.ts:1`, `134-153`. If bundler tree-shaking is incomplete,
build-tool data can enter a client graph for a few constants.

### Deeper Lesson

After broad I/O and hydration bursts are controlled, repeated small scans and
intentional frame delays become visible in interaction metrics. Saved state must
also be consumed, not merely persisted, or it creates misleading cache and
query behavior.

### Potential Fixes

Proposed 2026-08-23 at `217e23abb`. Status: `Proposed`.

- Initialize Git mode from the saved mode unless an explicit community URL
  requires community mode.
- Do not overwrite saved mode until the user or explicit route intent changes
  it.
- Start card navigation immediately after synchronously painting intent state;
  use a synchronous flush only if feedback otherwise cannot paint.
- Index publication operations by owner and semantic key once per store update.
- Replace the handful of Tailwind runtime color references with literal
  application constants if bundle analysis confirms retention.

### Validation Needed

- Reload with each saved Git mode and with explicit community context.
- Compare click-to-navigation latency across every clickable card region.
- Measure publication-operation projection work with several pending invites.
- Confirm the client bundle changes before replacing Tailwind constants.

### History

- 2026-08-23 `217e23abb`: lower-priority findings grouped; no fix implemented yet.

## Related Historical Record

Cross-reference recorded 2026-08-23 at `217e23abb`.

`docs/architecture/deferred-performance-improvements.md` records findings from
the 2026-07 audit, committed as `e2bbff1f3` on 2026-07-24. Those findings remain
part of Budabit's performance history and include:

- Double serialization and lack of transferables in Git worker responses.
- Duplicate profile freshness and hydration mechanisms.
- Long lists rendered without windowing.
- Repeated Markdown parsing and sanitization.
- Backfills that do not use available negentropy/cache-first paths.
- Remaining unbounded caches and hot-path state.
- Missing manual chunk policy and root `ConfigProvider` graph pressure.

This journal does not duplicate the full earlier audit yet. When one of those
items is implemented or re-investigated, add a timestamped journal finding and
link its implementation and validation commits back to the original record.

## Comparative Study: GitWorkshop And ngit-indexer

Study recorded 2026-08-23 at `217e23abb`. Status: `Observed`.

Repositories inspected:

- `/home/johnd/Work/gitworkshop`
- `/home/johnd/Work/ngit-indexer`

### Transferable Lessons

`ngit-indexer` maintains a narrow persistent LMDB index for repository and
related discovery kinds, then serves existing indexed data while background
synchronization resumes. Relevant implementation is in
`ngit-indexer/src/main.rs:41-80`, `src/config.rs:32-38`, and
`src/nostr/builder.rs:253-277`.

GitWorkshop requests only 20 kind-30617 announcements for its initial browse
page: `gitworkshop/src/hooks/useRepositorySearch.ts:63-70`, `224-253`. It
renders real cards as soon as events arrive rather than waiting for every relay
to settle: `gitworkshop/src/pages/RepositoriesPage.tsx:141-180`.

Search uses server-side NIP-50 at
`gitworkshop/src/hooks/useRepositorySearch.ts:413-442`. Profile requests are
batched and cache-first at `gitworkshop/src/hooks/useLoadProfile.ts:5-31`, while
NIP-05 and path enrichment do not block card rendering at
`gitworkshop/src/hooks/usePrefetchNip05.ts:8-54` and
`gitworkshop/src/hooks/useRepoPath.ts:4-23`.

Pagination starts near a stable intersection observer at
`gitworkshop/src/pages/RepositoriesPage.tsx:101-139` and exposes content in
20-item display windows.

### Patterns Not To Copy Directly

- `ngit-indexer` currently performs full historical source recrawls after
  restart instead of using durable per-source reconciliation cursors:
  `ngit-indexer/src/sync/mod.rs:630-680`, `759-834`.
- Its timestamp-only historical cursor can stall or overlap heavily when many
  events share a timestamp: `ngit-indexer/src/sync/mod.rs:773-830`.
- Live subscriptions begin after historical passes, leaving a possible gap:
  `ngit-indexer/src/sync/mod.rs:654-721`.
- GitWorkshop performs repeated client-side repository grouping with known
  O(n^2) behavior: `gitworkshop/src/models/RepositoryListModel.ts:29-38` and
  `src/lib/nip34.ts:2648-2734`.
- Pagination completion uses a 600 ms inactivity heuristic and aggregate event
  counts rather than an authoritative per-source cursor:
  `gitworkshop/src/hooks/useRepositorySearch.ts:66-70`, `173-187`, `590-596`.
- Its module-level search cache is unbounded and can retain partial sessions
  whose pagination owner was torn down:
  `gitworkshop/src/hooks/useRepositorySearch.ts:105-125`, `328-378`, `558-582`.
- GitWorkshop statically imports unrelated routes in
  `gitworkshop/src/AppRouter.tsx:17-31`.

### Potential Budabit Direction

Proposed 2026-08-23 at `217e23abb`. Status: `Proposed`.

The near-term path does not require a new protocol or service:

- Query one trusted index relay for a small first page.
- Use NIP-50 for browse search rather than downloading a corpus.
- Render announcements progressively before full request completion.
- Keep profile and proof enrichment separate from repository identity.
- Persist bounded first-page and normalized-query records and revalidate them.
- Use a compound keyset cursor rather than timestamp alone.

If client-side reductions remain insufficient, a later index service could
return compact card-ready summaries over cacheable HTTP, with an opaque cursor
and optional live invalidation after first render. That service should open its
persistent snapshot immediately, maintain durable per-source cursors, subscribe
live before backfill, and avoid making raw event graph resolution part of the
mobile first-paint path.

This direction is not yet an accepted architecture policy or implementation
commit.

## Recommended Investigation Order

Order proposed 2026-08-23 at `217e23abb`. Status: `Proposed`.

1. Mount navigation before broad persistence hydration and make reads readonly
   and incremental.
2. Remove duplicate Git loads and accidental DM full-history startup.
3. Stop mounting hidden `CommunityMenu` on mobile.
4. Make notification shutdown real and delay network reconciliation.
5. Stage community room/live/history/delete/widget work in distinct lanes.
6. Remove Git broad preload and start visible scoped requests concurrently with
   cache hydration.
7. Gate stars, collections, profiles, and verification by mode and viewport.
8. Split root modules and delay full service-worker installation.
9. Add small index-backed discovery pages and bounded first-page/query caches.
10. Consider card-ready HTTP summaries only if measured client reductions are
    insufficient.

This order should be revised as fixes land and controlled measurements identify
different dominant costs.

## Improvement Timeline

| Date       | Commit      | Status   | Record                                                                                                                      |
| ---------- | ----------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-23 | `217e23abb` | Observed | Performance journal established with findings 001-022, prior-audit cross-reference, and the GitWorkshop/ngit-indexer study. |
