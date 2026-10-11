// The calendar's sources that no connection makes: the one weather source, made at start. Google
// Calendar's comes with Connect Gmail (one consent for both, src/sync/connect.ts), which finds the
// account's existing one on a reconnect, so there's exactly one per Google account; Todoist's is
// made by its OAuth callback.
import {eq} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {DEFAULT_SCHEDULES} from '../domain/sources.ts';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';

export function ensureCalendarSources(store: Store): number[] {
  return transaction(store, () => {
    if (store.db.select({id: t.sources.id}).from(t.sources).where(eq(t.sources.provider, 'weather')).get()) return [];
    const schedule = DEFAULT_SCHEDULES.weather;
    const created = [store.db.insert(t.sources).values({provider: 'weather', accountId: null, syncMode: schedule.mode, intervalSeconds: schedule.intervalSeconds, createdAt: isoNow(store)}).returning().get().id];
    noteLive(store, {type: 'health', sources: created});
    return created;
  });
}
