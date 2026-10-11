// Reminders and Time to Leave, sent through notify() (never ntfy directly). Each pass:
// 1. Time to Leave: routes from Home are checked for the day's events with a place and Time to Leave
//    (SV-31), on v1's cadence (src/domain/timeToLeave.ts), each answer kept only if Home, the place
//    and the start are still what was asked about; one due to go is checked once more first (v1's
//    refresh before deliver).
// 2. Reminders and Time to Leave that are due go out, each once (notify()'s dedupe key); one that
//    failed to send is tried again on later passes, within the grace.
// 3. The pass's moment is kept, so a restart catches up on what it missed (within the grace) and
//    an item moved into the past doesn't fire.
// Harvested from v1's `reminder-scheduler` and `time-to-leave-refresh-service` (see SV-6); v1's
// per-reminder rows, Discord sender and wake-time SQL aren't ported.
import type {ItemOut} from '@setpoint/shared';
import {and, eq, gte, like, lt} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {leaveText, REMINDER_GRACE_MS, reminderDue, reminderText, remindersOf} from '../domain/reminders.ts';
import {addDays, localDay} from '../domain/time.ts';
import {isPhysicalLocation, leaveAt, nextRouteCheck, plausibleRoute, retryRouteCheck, TIME_TO_LEAVE_HORIZON_MS, travelMinutes} from '../domain/timeToLeave.ts';
import type {Notifier} from '../notify/index.ts';
import {computeRoute} from '../providers/routes/index.ts';
import type {RoutesOptions} from '../providers/routes/index.ts';
import {joinLocation} from '../providers/gcal/normalize.ts';
import {itemsInRange} from '../queries/items.ts';
import {readSecret} from '../secrets/store.ts';
import {getSettings} from '../settings.ts';
import {isoNow, noteLive} from '../store.ts';
import type {Store} from '../store.ts';

const MARK = 'reminders';
// Route checks per pass, so a busy day can't spend a burst of calls.
export const ROUTE_CHECKS_PER_PASS = 10;

export interface ReminderSchedulerOptions {
  store: Store;
  notifier: Notifier;
  routes?: RoutesOptions;
}

type Estimate = typeof t.travelEstimates.$inferSelect;

export class ReminderScheduler {
  private readonly store: Store;
  private readonly notifier: Notifier;
  private readonly routes: RoutesOptions;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(options: ReminderSchedulerOptions) {
    this.store = options.store;
    this.notifier = options.notifier;
    this.routes = options.routes ?? {};
  }

  start(everyMs = 30_000) {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), everyMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass; a pass already running is joined rather than doubled. */
  tick(): Promise<void> {
    this.running ??= this.pass().catch(error => console.error('Reminders', error)).finally(() => (this.running = null));
    return this.running;
  }

  private lastPass(now: string): string {
    return this.store.db.select().from(t.scheduleMarks).where(eq(t.scheduleMarks.name, MARK)).get()?.at ?? now;
  }

  private async pass() {
    const {store} = this;
    const now = isoNow(store);
    const lastPass = this.lastPass(now);
    const settings = getSettings(store);
    const nowMs = Date.parse(now);
    const items = itemsInRange(store, addDays(localDay(nowMs - REMINDER_GRACE_MS, store.timeZone), -1), addDays(localDay(nowMs, store.timeZone), 30)).items;

    await this.timeToLeave(items, now);

    // Reminders that failed to send, still within the grace, are tried again.
    const retry = new Set(store.db.select({dedupe: t.notifications.dedupe}).from(t.notifications)
      .where(and(eq(t.notifications.state, 'failed'), like(t.notifications.dedupe, 'reminder:%'), gte(t.notifications.createdAt, new Date(nowMs - REMINDER_GRACE_MS).toISOString())))
      .all().map(row => row.dedupe));
    for (const item of items) {
      for (const reminder of remindersOf(item, {taskTime: settings.reminders.task_time, timeZone: store.timeZone})) {
        if (!reminderDue(reminder.at, now, lastPass, retry.has(reminder.key))) continue;
        await this.notifier.notify({
          kind: 'reminder', topic: 'reminders', ...reminderText(item, store.timeZone), dedupe: reminder.key,
          link: item.kind === 'task' ? {to: 'day', date: item.due_date!} : {to: 'item', id: item.id, occurrence_start: item.occurrence_start},
        });
      }
    }
    store.db.insert(t.scheduleMarks).values({name: MARK, at: now}).onConflictDoUpdate({target: t.scheduleMarks.name, set: {at: now}}).run();
  }

  // ---- Time to Leave ----

  private async timeToLeave(items: ItemOut[], now: string) {
    const {store} = this;
    const settings = getSettings(store);
    const nowMs = Date.parse(now);
    // Estimates for occurrences a day gone are dropped.
    store.db.delete(t.travelEstimates).where(lt(t.travelEstimates.occurrenceStart, new Date(nowMs - 86_400_000).toISOString())).run();
    const home = settings.calendar.home;
    if (!settings.time_to_leave.enabled || !home) return;
    const key = readSecret(store, 'places_api_key');
    if (!key) return;
    const buffer = settings.time_to_leave.buffer_minutes;
    // Only the events the user gave Time to Leave (SV-31).
    const upcoming = items.filter(item => item.kind === 'event' && item.leave_reminder && !item.all_day && item.starts_at && !item.read_only
      && Date.parse(item.starts_at) > nowMs && Date.parse(item.starts_at) - nowMs <= TIME_TO_LEAVE_HORIZON_MS
      && isPhysicalLocation(joinLocation(item.place, item.address)));
    let checks = 0;
    const touched: number[] = [];
    for (const item of upcoming) {
      const start = item.starts_at!;
      const destination = joinLocation(item.place, item.address);
      const inputs = JSON.stringify({home: [home.lat, home.lng], destination, start, buffer});
      let estimate = this.estimate(item.id, start);
      const stale = !estimate || estimate.inputs !== inputs;
      const checkDue = stale || (estimate!.nextCheckAt !== null && Date.parse(estimate!.nextCheckAt) <= nowMs);
      // About to go out on an estimate older than its leave time: check once more first.
      const beforeSending = !stale && estimate!.leaveAt !== null && Date.parse(estimate!.leaveAt) <= nowMs && (!estimate!.checkedAt || estimate!.checkedAt < estimate!.leaveAt) && !estimate!.error;
      if ((checkDue || beforeSending) && checks < ROUTE_CHECKS_PER_PASS) {
        checks += 1;
        estimate = await this.check(item, {key, home, destination, start, buffer, inputs, now, previous: stale ? null : estimate});
        if (estimate) touched.push(item.id);
      }
      if (estimate?.inputs !== inputs || !estimate.leaveAt) continue;
      if (Date.parse(estimate.leaveAt) > nowMs) continue;
      await this.notifier.notify({
        kind: 'time_to_leave', topic: 'reminders', ...leaveText(item, estimate.leaveAt, travelMinutes(estimate.durationSeconds!), store.timeZone),
        link: {to: 'item', id: item.id, occurrence_start: item.occurrence_start}, dedupe: `ttl:${item.id}@${start}`,
      });
    }
    if (touched.length) noteLive(store, {type: 'items', items: [...new Set(touched)], calendars: [], commands: []});
  }

  private estimate(itemId: number, start: string): Estimate | null {
    return this.store.db.select().from(t.travelEstimates).where(and(eq(t.travelEstimates.itemId, itemId), eq(t.travelEstimates.occurrenceStart, start))).get() ?? null;
  }

  /** Asks for the route and keeps the answer if nothing it depended on changed meanwhile. */
  private async check(item: ItemOut, ask: {key: string; home: {lat: number; lng: number}; destination: string; start: string; buffer: number; inputs: string; now: string; previous: Estimate | null}): Promise<Estimate | null> {
    const {store} = this;
    let values: Partial<Estimate>;
    try {
      const route = await computeRoute(this.routes, ask.key, {
        origin: ask.home, destination: ask.destination, now: ask.now,
        departAt: ask.previous?.leaveAt ?? new Date(Date.parse(ask.start) - ask.buffer * 60_000 - 30 * 60_000).toISOString(),
      });
      if (!plausibleRoute(route.durationSeconds, route.distanceMeters)) throw new Error(`The route to ${ask.destination} looks wrong (${Math.round(route.distanceMeters / 1000)} km).`);
      const leave = leaveAt(ask.start, route.durationSeconds, ask.buffer);
      values = {durationSeconds: route.durationSeconds, distanceMeters: route.distanceMeters, leaveAt: leave, checkedAt: isoNow(store), nextCheckAt: nextRouteCheck(isoNow(store), leave, ask.start), error: null};
    } catch (error) {
      // The last estimate stands; try again in at least 5 minutes.
      values = {
        durationSeconds: ask.previous?.durationSeconds ?? null, distanceMeters: ask.previous?.distanceMeters ?? null, leaveAt: ask.previous?.leaveAt ?? null,
        checkedAt: ask.previous?.checkedAt ?? null, nextCheckAt: retryRouteCheck(isoNow(store), ask.previous?.leaveAt ?? null, ask.start),
        error: error instanceof Error ? error.message : String(error),
      };
    }
    // Stale-result guard: Home, the place or the time changed while Google answered, or Time to Leave was taken off.
    const settings = getSettings(store);
    const current = store.db.select().from(t.items).where(eq(t.items.id, item.id)).get();
    const home = settings.calendar.home;
    const stillStart = current && (current.recurrence ? true : current.startsAt === ask.start);
    if (!current || current.cancelled || !current.leaveReminder || !home || !stillStart || joinLocation(current.place, current.address) !== ask.destination
      || home.lat !== ask.home.lat || home.lng !== ask.home.lng || settings.time_to_leave.buffer_minutes !== ask.buffer) return null;
    const row = {itemId: item.id, occurrenceStart: ask.start, inputs: ask.inputs, ...values};
    return store.db.insert(t.travelEstimates).values(row).onConflictDoUpdate({target: [t.travelEstimates.itemId, t.travelEstimates.occurrenceStart], set: row}).returning().get()!;
  }
}
