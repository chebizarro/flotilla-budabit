import type { NostrEvent, WidgetBridge } from 'budabit-sdk';
import { normalizeRelays, record } from './context.js';
import { verifiedEvent } from './trust.js';
import { matchFilter, type Filter } from 'nostr-tools';

export interface QueryResult {
  events: NostrEvent[];
  /** Every required relay reached a bounded, host-confirmed end of results. */
  complete: boolean;
  errors?: string[];
  /** Relays (required or not) that did not reach a confirmed end of results. */
  incompleteRelays: string[];
}
export interface QueryOptions {
  /**
   * Relays whose completeness gates `complete`. Others are best-effort: their
   * events are still merged, but a timeout there does not make discovery
   * partial. Defaults to every queried relay.
   */
  required?: string[];
}
export const QUERY_PAGE_SIZE = 100;
const MAX_PAGES = 5;
/**
 * Required relays get a second attempt before they can block publication, but
 * only after a transport failure or an empty timed-out answer: an incomplete
 * page bound is a real result and is not retried.
 */
const REQUIRED_RELAY_ATTEMPTS = 2;

interface RelayResult {
  events: NostrEvent[];
  complete: boolean;
  errors?: string[];
}

/** Per-relay inclusive cursors avoid skipping events at a shared second boundary. */
export async function queryAll(
  bridge: WidgetBridge,
  relays: string[],
  filter: Record<string, unknown>,
  signal?: AbortSignal,
  options: QueryOptions = {}
): Promise<QueryResult> {
  const activeRelays = normalizeRelays(relays).slice(0, 8);
  if (!activeRelays.length) throw new Error('No valid query relays');
  // Only relays actually queried can be required; with none left, all of them are.
  const requiredList = normalizeRelays(options.required ?? []).filter((relay) =>
    activeRelays.includes(relay)
  );
  const required = new Set(requiredList.length ? requiredList : activeRelays);

  const queryRelay = async (relay: string): Promise<RelayResult> => {
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
          return { events: [...events.values()], complete: false };
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
  };

  const results = await Promise.all(
    activeRelays.map(async (relay) => {
      const attempts = required.has(relay) ? REQUIRED_RELAY_ATTEMPTS : 1;
      const merged = new Map<string, NostrEvent>();
      let last: RelayResult = { events: [], complete: false };
      for (let attempt = 0; attempt < attempts; attempt++) {
        last = await queryRelay(relay);
        for (const event of last.events) merged.set(event.id, event);
        if (last.complete || (!last.errors && last.events.length > 0)) break;
      }
      return { relay, events: [...merged.values()], complete: last.complete, errors: last.errors };
    })
  );
  const merged = new Map(results.flatMap((r) => r.events).map((e) => [e.id, e]));
  return {
    events: [...merged.values()],
    complete: results.every((r) => r.complete || !required.has(r.relay)),
    errors: results.flatMap((r) => r.errors ?? []),
    incompleteRelays: results.filter((r) => !r.complete).map((r) => r.relay),
  };
}
