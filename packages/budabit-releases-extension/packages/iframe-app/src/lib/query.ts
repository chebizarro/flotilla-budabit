import type { NostrEvent, WidgetBridge } from 'budabit-sdk';
import { normalizeRelays, record } from './context.js';
import { verifiedEvent } from './trust.js';
import { matchFilter, type Filter } from 'nostr-tools';

export interface QueryResult {
  events: NostrEvent[];
  /** Every queried relay reached EOSE within the page bound. */
  complete: boolean;
  /** Relays whose bounded response completed; their view of history is fully known. */
  completedRelays: string[];
  /** Relays that timed out, failed, or overflowed the page bound. */
  incompleteRelays: string[];
  errors?: string[];
}
export const QUERY_PAGE_SIZE = 100;
const MAX_PAGES = 5;

/** Name the relays the host reports as not having answered, so an incomplete result is actionable. */
function hostOutcomes(response: Record<string, unknown>): string[] | undefined {
  const list = (key: string) =>
    Array.isArray(response[key]) ? response[key].filter((r): r is string => typeof r === 'string') : [];
  const errors = [
    ...list('timedOutRelays').map((r) => `${r}: no EOSE before the host timeout`),
    ...list('failedRelays').map((r) => `${r}: connection failed or subscription closed`),
  ];
  return errors.length ? errors : undefined;
}

/** Per-relay inclusive cursors avoid skipping events at a shared second boundary. */
export async function queryAll(
  bridge: WidgetBridge,
  relays: string[],
  filter: Record<string, unknown>,
  signal?: AbortSignal
): Promise<QueryResult> {
  const activeRelays = normalizeRelays(relays).slice(0, 8);
  if (!activeRelays.length) throw new Error('No valid query relays');
  const results = await Promise.all(
    activeRelays.map(async (relay) => {
      const events = new Map<string, NostrEvent>();
      let until = typeof filter.until === 'number' ? filter.until : undefined;
      try {
        for (let page = 0; page < MAX_PAGES; page++) {
          signal?.throwIfAborted();
          const requestFilter = {
            ...filter,
            limit: QUERY_PAGE_SIZE,
            ...(until === undefined ? {} : { until }),
          };
          const response = record(
            await bridge.request('nostr:query', { relays: [relay], filter: requestFilter })
          );
          signal?.throwIfAborted();
          if (typeof response.error === 'string') throw new Error(response.error);
          if (!Array.isArray(response.events)) throw new Error('Invalid query response');
          const batch = response.events
            .map(verifiedEvent)
            .filter((e): e is NostrEvent => !!e && matchFilter(requestFilter as Filter, e));
          for (const event of batch) events.set(event.id, event);
          if (response.status !== 'ok' || response.complete !== true)
            return { events: [...events.values()], complete: false, errors: hostOutcomes(response) };
          if (response.events.length < QUERY_PAGE_SIZE)
            return { events: [...events.values()], complete: true };
          if (!batch.length) return { events: [...events.values()], complete: false };
          const oldest = Math.min(...batch.map((e) => e.created_at));
          // A full second cannot be safely traversed with NIP-01's timestamp-only cursor.
          if (until !== undefined && oldest >= until)
            return { events: [...events.values()], complete: false };
          until = oldest;
        }
        return { events: [...events.values()], complete: false };
      } catch (error) {
        signal?.throwIfAborted();
        return {
          events: [...events.values()],
          complete: false,
          errors: [
            `${relay.split(/[?#]/, 1)[0]}: ${error instanceof Error ? error.message : String(error)}`,
          ],
        };
      }
    })
  );
  const merged = new Map(results.flatMap((r) => r.events).map((e) => [e.id, e]));
  return {
    events: [...merged.values()],
    complete: results.every((r) => r.complete),
    completedRelays: activeRelays.filter((_, i) => results[i]?.complete),
    incompleteRelays: activeRelays.filter((_, i) => !results[i]?.complete),
    errors: results.flatMap((r) => r.errors ?? []),
  };
}
