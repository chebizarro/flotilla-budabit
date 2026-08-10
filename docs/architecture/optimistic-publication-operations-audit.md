# Optimistic Publication Operations Audit

## Status

This is the phase 8 inventory for the initial optimistic publication operations rollout. It was
last refreshed after phases 5 through 7 were migrated.

The migrated scope no longer relies on repository optimism. Remaining pre-confirmation admission is
limited to the excluded workflow classes documented below. Changing Welshman's default is deferred
to [Welshman Repository Admission Plan](./welshman-repository-admission-plan.md).

## Inventory Method

The production inventory covers `src/**/*.{ts,svelte}` and excludes tests and specs. It searches for:

- Literal `publishThunk(` calls.
- Cast calls such as `(publishThunk as any)(...)`.
- Direct `repository.publish(` calls.
- Indirect publication through shared command and Git helpers.
- Welshman thunk, inbound socket, local-adapter, and wrapped-event admission behavior.

Current counts:

| Inventory                                      | Count |
| ---------------------------------------------- | ----: |
| Literal application `publishThunk(` calls      |    57 |
| Cast-direct application `publishThunk` calls   |     3 |
| Effective direct application thunk calls       |    60 |
| Direct application `repository.publish(` calls |    71 |
| Welshman source `publishThunk(` calls          |    31 |
| Welshman source `repository.publish(` calls    |     5 |

Of the 60 application thunk calls, 16 force `optimistic: false`, 7 pass through an explicit
`optimistic` option, and 37 retain Welshman's optimistic default.

## Migrated Scope

All migrated publishers call `startPublication`, which creates exactly one `publishThunk` with
`optimistic: false`. `src/app/core/publication-operations.ts` contains the only repository commit for
these flows, after a qualifying ACK or tracker observation.

| Flow                                    | Publisher or projection                                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| Community room messages                 | `src/routes/c/[community]/rooms/[room]/+page.svelte`                                   |
| Ordinary reaction add/delete            | `src/app/core/commands.ts`, `src/app/core/reaction-operations.ts`                      |
| Community star/unstar                   | `src/app/components/community/CommunityStarButton.svelte`                              |
| Current community thread creation       | `src/routes/c/[community]/threads/create/+page.svelte`                                 |
| Compose-menu thread creation            | `src/app/components/ThreadCreate.svelte`                                               |
| Repository-activity thread creation     | `src/app/components/RepoActivityThreadCreate.svelte`                                   |
| Thread roots and comments               | `src/routes/c/[community]/threads/`, `src/app/core/authored-publication-operations.ts` |
| Goal comments and compose goal creation | `src/routes/c/[community]/goals/`, `src/app/components/GoalCreate.svelte`              |
| Calendar comments and compose creation  | `src/routes/c/[community]/calendar/`, `src/app/components/CalendarEventForm.svelte`    |
| Moderator invitation responses          | `src/routes/c/[community]/+page.svelte`                                                |
| Report-review labels                    | `src/app/components/community/CommunityContentReportCard.svelte`                       |

The migrated files contain no redundant outbound `repository.publish` call. Community stars and
ordinary reactions use rollback projections. Authored content uses retained projections with event
ID deduplication. Governance labels use no event preview and remain independently recoverable.

## Remaining Thunk Classification

### Safe Future Candidates

- `src/app/core/commands.ts`: legacy `publishReaction` is a default-optimistic single event with no
  production caller. Migrated reaction surfaces use `publishReactionOperation`.
- `src/app/core/commands.ts`: `publishComment` is a default-optimistic single event used only by
  `src/app/components/EventReply.svelte`, which has no static production component use.

These are the next narrow candidates if a live caller is established. They do not justify changing
the shared default.

### ACK-Gated Or Verified

These paths either create non-optimistic thunks and commit after ACK/readback, or pass
`optimistic: false` through a shared helper:

- `src/app/core/linked-publish.ts`: linked goal/calendar stage ownership.
- `src/app/core/event-edit-publish.ts`: edit replacement and delete stages.
- `src/routes/c/[community]/access/+page.svelte`: access governance events.
- `src/routes/c/[community]/badges/+page.svelte`: badge definitions/profile badges.
- `src/routes/c/[community]/moderation/+page.svelte`: selected-form verified publication branch.
- `src/app/components/community/CommunityRoomCreate.svelte`: room roots.
- `src/app/components/community/ModerationAction.svelte`: moderation reports and bans.
- `src/app/components/community/ModerationReportCard.svelte`: moderation report deletion.
- `src/app/components/CommunityBadgeAwardForm.svelte`: badge awards and revocations.
- `src/app/components/CalendarEventForm.svelte`: existing-event edit branch.
- `src/app/components/Chat.svelte`: encrypted direct messages.
- `src/app/components/Report.svelte`, `ReportItem.svelte`, `EventDeleteConfirm.svelte`, and
  `EventMenu.svelte`: report/delete confirmation flows.
- `src/app/core/commands.ts`: `publishReport` callers explicitly suppress optimism.
- `src/app/core/email-digest-state.ts`: verified email-digest publication.
- `src/app/core/community-renunciations.ts`: readback-verified renunciation.

Their manual repository commits are intentional post-confirmation admission.

### Compound Or Conditional

Generic child retry must not own these workflows:

- `src/routes/c/[community]/goals/create/+page.svelte`: original plus targeting event.
- `src/routes/c/[community]/calendar/create/+page.svelte`: original plus targeting event.
- `src/routes/c/[community]/git/+page.svelte`: repository announcement plus association.
- `src/routes/c/[community]/permalinks/+page.svelte`: permalink plus association.
- `src/routes/c/[community]/moderation/+page.svelte`: definition, profile-list, and review chains.
- `src/app/util/permalink-publishing.ts`: personal/community permalink fanout.
- `src/app/components/RepoCollectButton.svelte`: collection star and community targeting changes.
- `src/app/components/DemoDayApplyModal.svelte`: room post, optional note, and topic-list update.
- `src/routes/git/[id=naddr]/+layout.svelte`: repository collection targeting and related Git
  workflow stages.
- `src/app/core/commands.ts`: `publishDelete` is a mixed helper; ACK-gated callers explicitly pass
  `optimistic: false`, while excluded compound callers preserve their existing behavior.

Default optimism and repeated `repository.publish` calls in these files are intentional legacy
workflow behavior for this boundary. Some manual calls are repository-deduped after the thunk has
already admitted the event; they can be removed only as part of a workflow-owned cleanup that proves
stage ordering and failure behavior remain unchanged.

### Direct Git And Repository Transport

- `src/app/core/git-commands.ts`: issue, pull request, comment, label, status, repository
  announcement/state, permalink, role-label, and custom pool publication.
- `src/routes/git/+page.svelte`: successful repository transaction hydration.
- `src/routes/git/[id=naddr]/+layout.svelte`: successful fork and repository transaction hydration.
- `src/app/core/commands.ts`: `broadcastUserData` rebroadcasts already-canonical signed events.

`publishRepoEventWithRelayOutcomesUsingPool` deliberately supports `publishLocally: true`, admitting
the signed event before custom transport. This is the primary intentional pre-transport canonical
admission and remains owned by direct Git recovery, not publication operations.

### Settings And Local-First Snapshots

Exact retry of these replaceable snapshots can restore stale intent:

- `src/routes/settings/blossom/+page.svelte`: Blossom server list.
- `src/routes/settings/content/+page.svelte`: mute list.
- `src/app/core/commands.ts`: relay policy, messaging relay policy, and app settings.
- `src/app/core/repo-watch.ts`: repository-watch state.
- `src/app/core/git-requests.ts`: encrypted Git authentication backup.
- `src/app/core/git-commands.ts`: GRASP server list and extension settings.
- `src/app/components/DemoDayApplyModal.svelte`: followed-topic snapshot.

These paths intentionally preserve current local-first behavior until a settings-specific fresh
snapshot API exists.

### Extensions And Wrapped Events

- `src/app/extensions/widget-targeting.ts`: widget event plus targeting publication.
- `src/app/extensions/bridge.ts`: generic `nostr:publish` and shared configuration; three calls use
  `(publishThunk as any)` and must remain in future inventories.
- `src/app/core/git-commands.ts`: extension settings.
- `src/app/components/Chat.svelte`: wrapped direct messages remain separately ACK-gated.

`packages/welshman/packages/net/src/wrapManager.ts` admits a wrapped rumor even when its thunk uses
`optimistic: false`. Wrapped outbound admission therefore needs an explicit policy at the wrap
manager layer before it can use generic publication operations.

## Repository Admission Classification

The 71 application `repository.publish` occurrences are classified as follows:

| Purpose                                                    | Count |
| ---------------------------------------------------------- | ----: |
| Publication-operation confirmed commit                     |     1 |
| ACK-gated, readback-verified, or transaction-result commit |    30 |
| Legacy duplicate outbound admission in excluded workflows  |    18 |
| Inbound relay or cache admission                           |    17 |
| Direct Git local-first/result hydration                    |     3 |
| Intentional local-only admission                           |     2 |

### Inbound Relay And Cache Admission

These calls admit relay-observed or loaded canonical events and are not outbound optimism:

- `src/routes/c/[community]/+page.svelte` and `+layout.svelte`.
- `src/routes/c/[community]/calendar/+page.svelte`.
- `src/routes/git/[id=naddr]/+layout.svelte`.
- `src/routes/git/[id=naddr]/issues/+page.svelte`.
- `src/routes/git/[id=naddr]/commits/[commitid]/+page.svelte`.
- `src/app/core/community-deletes.ts`.
- `src/app/core/event-activity-io.ts`.
- `src/app/core/requests.ts`.
- `src/app/core/community-state.ts` loader and refresh paths.
- `src/app/components/Zap.svelte` for relay-observed zap receipts.

Welshman's global socket listener also admits ordinary relay events, so some callback insertions are
deduplicated safety calls. They are harmless cleanup candidates, not pre-ACK outbound state.

### Intentional Local-Only Usage

- `src/app/util/notification-events.ts` owns a private bounded `Repository` for notification
  replacement, attribution, and pruning. It is not the canonical application repository.
- `src/app/core/community-state.ts` `setActiveCommunityDefinition` admits a supplied definition while
  synchronizing the active in-memory community session.
- `packages/welshman/packages/net/src/adapter.ts` `LocalAdapter` intentionally admits an event before
  returning a local relay `OK`.

## Default Decision

Welshman's `Thunk.enqueue` remains optimistic unless `optimistic: false` is supplied. Flipping that
default now would affect the 37 remaining default-optimistic application calls, 31 Welshman helper
calls, settings snapshots, compound workflow staging, and direct transport. It would not fix wrapped
rumor admission.

No repository-admission enum is introduced by this rollout. Any change to the boolean or its default
must follow the separate admission plan and include caller-by-caller migration and wrapped-event
tests.
