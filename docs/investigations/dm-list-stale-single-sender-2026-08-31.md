# Investigation: DM list shows a single stale sender despite thousands of DMs

## Summary
(under investigation)

## Symptoms
- The DM/chat list in flotilla-budabit shows only **one sender**, from **months ago**
- User has dozens of distinct DM correspondents and thousands of messages
- Suggests DM discovery/sync is broken (not rendering): either giftwrap (NIP-17/NIP-59) sync window, relay selection (kind 10050 DM relays), decryption failures, or a load limit/filter bug

## Hypotheses
1. **Sync window / limit**: DM (kind 1059 giftwrap) subscription uses a narrow time window or tiny limit, so only old cached data shows
2. **Relay selection**: DM relays (NIP-17 kind 10050 inbox relays) not queried; only some default relay with stale data
3. **Decryption**: giftwrap unwrapping fails silently (signer/nip44 issues), so messages arrive but never become chats
4. **Local cache/repository filter**: chats derived from cached events only; new sync never triggered or is aborted (e.g., by the new relay-priority/budget scheduling work)
5. **Regression from recent refactors**: heavy recent work on relay request prioritization, publication operations, community bootstrap may have starved or dropped the DM sync path

## Background / Prior Research

### Explore probe 1 — DM data-flow wiring (verified chain)
- Chat list UI: `src/routes/chat/+layout.svelte:48-54` → `ChatSearchResults.svelte` → `chatSearch` store
- Store chain: `src/app/core/state.ts:334-339` `chatMessages` (repository events, **kind `DM_KIND = 4444`** only, state.ts:69) → `buildChatsById` (373-421, one-to-one counterparty grouping) → `chatsById` (424-426) → `chatSearch` (428-436, sorted by last_activity)
- Sync: `+layout.svelte:1560-1562` → `syncApplicationData()` → `syncDMs()` (`src/app/core/sync.ts:410-414`)
- `syncDMs` derives relays **exclusively from the user's kind-10050 messaging relay list** (`sync.ts:388-395`; welshman `messagingRelayLists.ts:14-21`); one `syncDMRelay` per relay URL
- Filters (`sync.ts:240-259`): `{kinds:[4444], "#p":[me]}` and `{kinds:[4444], authors:[me]}` with **`since: ago(WEEK,2)`** for normal sync; bootstrap fallback removes since and uses limit 200; live sub limit 0; negentropy w/ 3s timeout else loader
- Encryption: kind 4444 + NIP-44 content encryption directly (no giftwrap). Generic kind-1059 unwrap support exists in @welshman/app (`session.ts:307-349`) and `shouldUnwrap.set(true)` at `+layout.svelte:296-297`, **but the DM sync never requests kind 1059**

### Explore probe 2 — git archaeology (6 months)
- **`164b372b` (2026-03-22) is the inflection point**: removed WRAP/kind-1059 giftwrap sync entirely; replaced with kind-4444-only filters + two-week normal window; removed group-DM paths. This is the custom "NIP-4444" scheme (`docs/architecture/NIP-4444.md`)
- `48899e6d` (05-29): stopped enabling full-history sync when `/chat` is open; route now only refreshes relay lists
- `3efb5428` (07-09): cold-start bootstrap, unwindowed, limit 200/filter
- `a8a8dbf6` (07-10): unbounded full-history backfill when user gains their FIRST 10050 relay (transition empty→non-empty only)
- `a1255919` (08-23): waits for a real messaging-relay list instead of treating missing state as empty; loader fallback for negentropy relays
- `3289a655` (08-24): 3s negentropy budget then fallback
- `b967757b` (08-26): conversation batches 120→20
- No production code handles NIP-04 (kind 4) or NIP-17 (kind 1059→14) DMs into the chat list; no conversion layer exists

## Investigator Findings

### Verdict

The primary failure is **protocol invisibility**, compounded by a relay-list gate and bounded history recovery:

1. **PROVED — legacy NIP-04/NIP-17 DMs cannot become chats.** Standard kind-4 events and unwrapped kind-14 rumors never satisfy the kind-4444-only chat projection. There is no converter or migration path.
2. **PROVED, with an important correction — there is a desktop IndexedDB migration cliff, but it does not explain the identity of the one visible sender.** Old kind-14/15 rumor rows can still be physically present and hydrate into the repository, but they remain invisible. A currently visible chat row must be backed by at least one kind-4444 event.
3. **PROVED — a missing, empty, or permanently unresolved kind-10050 list produces no DM subscriptions and no chat-specific error state.** The app can remain indefinitely on cached repository contents.
4. **PROVED — buildChatsById intentionally drops non-one-to-one participant sets, but it does not drop self-chats.** Missing p tags have asymmetric behavior: inbound events are dropped; outbound events become self-chats.
5. **PARTIAL — multiple authors do publish kind 4444, but broad ecosystem adoption cannot be established from source or relay samples.** Current Budabit always authors bare kind-4444 events and cannot interoperate with ordinary NIP-04/NIP-17 senders. A bounded live sample showed sparse use on the Budabit relay and highly concentrated use on a public relay.

### 1. Legacy invisibility and the unwrap destination

- The only chat source queries the shared repository with filters for DM_KIND only, where DM_KIND is 4444 (src/app/core/state.ts:69,334-339). buildChatsById independently rejects any event whose kind is not 4444 (src/app/core/state.ts:373-383). A kind-4 or kind-14 event therefore cannot reach the chat list even if it is already in memory.
- Global relay intake sends an incoming kind-1059 WRAP to unwrapAndStore instead of publishing the outer wrap to the repository (packages/welshman/packages/app/src/index.ts:53-79). shouldUnwrap is globally enabled (src/routes/+layout.svelte:296-297). The unwrap queue decrypts the wrap and passes the rumor unchanged to wrapManager.add (packages/welshman/packages/app/src/session.ts:315-348).
- WrapManager.add **does publish the unwrapped rumor into the repository** and copies relay provenance (packages/welshman/packages/net/src/wrapManager.ts:56-71). This is the same singleton repository used by chat state: app core exports Repository.get() (packages/welshman/packages/app/src/core.ts:1-5), whose singleton is constructed at packages/welshman/packages/net/src/repository.ts:153-159.
- The unwrap implementation validates the rumor but does not convert its kind. Welshman defines NIP-17 DIRECT_MESSAGE = 14, WRAP = 1059, and wrapped kinds 14/15 (packages/welshman/packages/util/src/Kinds.ts:39-55,207-211). Thus a normal NIP-17 rumor reaches the exact repository observed by chat state **as kind 14**, then is excluded by the 4444 filter. Only an anomalous giftwrap containing a kind-4444 rumor could pass the kind check.
- Current persistence also excludes standard DM kinds. The durable event allowlist contains DM_KIND/4444 but not 4, 14, or 1059 (src/app/util/storage.ts:57-91). The event adapter observes only that allowlist for new writes (src/app/util/storage.ts:189-240), and the current adapter set has no WrapManager adapter (src/app/util/storage.ts:426-434). Newly unwrapped kind-14 rumors are consequently memory-only and disappear on reload.
- Exhaustive production-source scans of src/** and packages/** found no filter, template, projection, converter, or migration mapping kind 4/14/1059 to 4444. The only DIRECT_MESSAGE/DEPRECATED_DIRECT_MESSAGE production references are kind declarations and generic Welshman wrapping machinery; the DM-related “backfill” is only the existing kind-4444 history loader (src/app/core/sync.ts:266-278). The “NIP 17” block in packages/welshman/packages/app/src/commands.ts:135-153 only edits a kind-10050 relay list; it does not author or ingest NIP-17 messages.

**Answer to the WrapManager question:** yes, an unwrapped rumor lands in the same in-memory repository that buildChatsById ultimately observes. No, a standard kind-14 rumor can never become a visible chat because both the upstream projection and the grouping helper require kind 4444. It is also not currently persisted.

### 2. Migration cliff and the stale visible sender

The durable-projection cliff occurred in two stages, earlier than the final March 22 sync removal:

- Immediately before 30640260 (2026-03-03), desktop persistence explicitly included DIRECT_MESSAGE and DIRECT_MESSAGE_FILE in its content kinds (30640260^:src/app/util/storage.ts:60-79). The pre-change chat projection queried and grouped kinds 14/15 (30640260^:src/app/core/state.ts:537-543,572-606). The old storage configuration also persisted WrapManager metadata (30640260^:src/app/util/storage.ts:241-269).
- Commit 30640260 switched persistence/chat projection to kind 4444. Commit 164b372b later removed the remaining giftwrap sync. Consequently, pre-March-3 unwrapped kind-14/15 rumors could be durable on desktop; messages unwrapped after the storage switch were no longer durable/visible, even before the final sync removal.
- The main database stayed flotilla-9gl, version 1 before 30640260, at 30640260, at 164b372b, and today (src/app/core/storage.ts:32; historical line 34 at those refs). Object stores are deleted only inside the IndexedDB version-upgrade callback (src/lib/indexeddb.ts:69-105), so removing the WrapManager adapter without a version bump did not run a schema cleanup.
- More importantly, current startup hydration calls table.getAll() and merges **every existing event row** into the repository without applying the current persistence-kind allowlist (src/app/util/storage.ts:120-135,189-194). There is no age/count/byte pruning for the main events store. Rows are deleted only when a routed repository removal is persisted (src/app/util/storage.ts:195-240) or the whole database is cleared on logout (src/app/core/commands.ts:507-514). Old kind-14/15 rows can therefore survive and hydrate indefinitely on desktop while remaining invisible to chat state.
- Mobile/touch-classified devices are stricter: content gets durable rank only on non-mobile unless specially allowed (src/app/util/storage.ts:101-118), and the mobile content allowlist contains only event-time/thread/zap-goal kinds, not messages or 4444 (src/app/util/storage-events.ts:26-28,142-143). isMobile includes touch/coarse-pointer devices (src/lib/html.ts:123-127).

**Implication for the symptom:** the surviving legacy rows explain why old correspondents/messages can exist physically yet vanish from the UI, but they cannot produce the one visible sender. Any visible sender today must have a kind-4444 event. On desktop, that can be an old persisted 4444 row; on a currently mobile-classified device it must have been loaded in the current session (unless it was written under an earlier classification/build). The stale sender's visible messages are therefore kind 4444, not ordinary pre-migration kind 4/14.

### 3. Silent no-sync when kind 10050 is absent or unresolved

- On pubkey activation the app requests the user relay list and force-loads the messaging relay list (src/app/core/sync.ts:354-372). Entering /chat causes at most one additional force-load per pubkey (src/app/core/sync.ts:374-386).
- The subscription then returns immediately while userMessagingRelayList is undefined (src/app/core/sync.ts:388). No DM relay subscription, recent backfill, bootstrap, or fallback relay is created. If a real list resolves with no relay tags, subscribeAll explicitly unsubscribes everything and returns (src/app/core/sync.ts:305-320).
- The “wait for a real list” behavior has no timeout-to-fallback or periodic retry in syncDMs. Welshman's cached makeLoadItem only retries when called again and uses exponential backoff after failures (packages/welshman/packages/store/src/repository.ts:534-593); it does not schedule its own retry. The two forceLoadUserMessagingRelayList calls in sync are fire-and-forget and have no local catch (src/app/core/sync.ts:364-369,379-386). A permanently absent/unreachable list therefore leaves state undefined and DM sync inert.
- There is an additional history edge: if state first hydrates as an explicit empty list and later becomes non-empty, hasObservedMessagingRelays enables the unbounded first-relay backfill (src/app/core/sync.ts:305-331). If state stays undefined and later resolves directly to a non-empty list, hasObservedMessagingRelays is still false, so it receives only normal/bootstrap behavior, not full-history backfill. Tests explicitly lock in no full-history backfill for a persisted list that hydrates after undefined (src/app/core/sync.test.ts:322-360) and full backfill only for explicit empty-to-non-empty (src/app/core/sync.test.ts:391-418).
- The chat list exposes no messaging-relay status. It renders conversations from chatSearch, a generic “Loading recent conversations...” state, and an empty-state message (src/app/components/ChatSearchResults.svelte:46-87; src/routes/chat/+layout.svelte:27,38-59; src/routes/chat/+page.svelte:59-74). There is no chat banner/toast for an absent or failed kind-10050 list. The global unhandled-rejection handler only recognizes app-shell asset failures (src/routes/+layout.svelte:1373-1393); performance diagnostics can record a rejection but do not inform the user (src/app/core/performance-diagnostics.ts:1048-1064).

**Verdict:** silent no-sync is a real failure mode. With no usable kind-10050 event, the apparent chat list is just whatever kind-4444 rows happen to remain in the repository.

### 4. Exact buildChatsById drops

Participant extraction is uniq([event.pubkey, ...all p-tags]); the helper requires the local pubkey to be present, then accepts zero or one other unique participant (src/app/core/state.ts:353-371). The loop also requires a loaded local pubkey and kind 4444 (src/app/core/state.ts:373-389). Therefore:

- **All events are omitted while the local pubkey is unavailable.**
- **All non-4444 events are omitted**, even if the helper is called directly with them.
- **Events not involving self are omitted.** For an inbound event, a missing/self-absent p tag means participants contain only the external author, so the event is dropped.
- **Multi-party events are omitted whenever more than one unique participant remains after removing self.** This includes an outbound event with two recipients and an inbound event whose author plus another p-tagged party are both non-self.
- **Outbound missing-p events are not omitted.** Because the author is self and there are zero “others,” the helper treats the event as a self-chat (src/app/core/state.ts:360-367,391-403).
- **Self-chats are intentionally retained, not dropped.** An event authored by self with p=self, or an outbound malformed event with no p, is grouped under the user's own pubkey. Duplicate p tags do not create a group because uniq de-duplicates them.

This projection is a strict one-to-one model. It cannot recover the group-DM behavior removed in March, and malformed tags can either discard inbound messages or misclassify outbound messages as a self-chat.

### 5. Are other Budabit users sending kind 4444?

Static proof:

- The only shipped DM authoring path NIP-44-encrypts plaintext directly, creates makeEvent(DM_KIND) with exactly one recipient p tag, signs it, publishes it, and inserts the acknowledged event into the repository (src/app/components/Chat.svelte:130-200). Conversation loads likewise request only 4444 (src/app/components/Chat.svelte:243-283).
- Sending is blocked when inbox relays cannot be resolved, with explicit compose errors (src/app/components/Chat.svelte:130-141). The local draft says both sender and recipient must have kind-10050 inbox relays and intentionally uses no giftwrap/seal/rumor (docs/architecture/NIP-4444.md:1-18,53-79).
- No package/extension contains another 4444 authoring path. A non-Budabit client must independently implement this project-local draft; ordinary NIP-04/NIP-17 output is not bridged.

Bounded live probe on 2026-08-31 (90-day nostr-tools SimplePool.querySync, per-relay/per-kind limit 500, aggregate counts only; no IDs/content retained):

- wss://relay.budabit.club: 8 kind-4444 events from 4 unique authors, dated 2026-06-12 through 2026-08-16; zero returned for kinds 4, 1059, and 14.
- wss://nos.lol: the 500-result cap was reached for kind 4444 from only 6 authors (all in an approximately 14-hour August 6-7 burst) and for kind 4 from 36 authors in the most recent sampled window; kind 1059 returned 144 events from 104 authors; kind 14 returned zero. The concentrated 4444 burst could be application traffic or spam and must not be treated as 500 conversations.

Relay events carry no reliable client identifier, inbox relays vary per user, retention/filter policies differ, and published kind-14 counts are not a valid proxy for giftwrapped NIP-17 because the rumor normally lives inside kind 1059. The probe therefore **disproves only the strongest claim that nobody else sends 4444**: multiple authors do. It does not prove those authors are Budabit clients or establish ecosystem-wide prevalence. Combined with the source trace, the defensible conclusion is that current Budabit-to-compatible-client traffic can appear, while the user's ordinary NIP-04/NIP-17 history cannot.

### Root-cause statement

The single stale chat is not a renderer bug and is not an old kind-14 rumor accidentally surfacing. The list is a projection of **only locally present kind-4444 events**. The user's dozens of legacy/NIP-17 correspondents are structurally invisible; missing or unresolved kind-10050 relay discovery can prevent any fresh 4444 ingestion; the bounded bootstrap may recover only 200 events per filter; and full-history recovery is limited to a narrow explicit empty-to-non-empty relay-list transition. The one visible sender is the only counterparty for whom an admissible kind-4444 event is currently present.

## Investigation Log

## Root Cause
(pending)

## Recommendations
(pending)

## Preventive Measures
(pending)
