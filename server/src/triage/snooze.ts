// Snoozed mail's return, run the way a rule's delayed trash is: a pass every minute. Each pass:
// 1. returns each email whose snooze has ended (src/commands/mail.ts returnFromSnooze). One with a
//    change of its own waiting stays due for the next pass. A thread's new mail made it due at
//    once, or returned it already.
// 2. notifies each email returned in the last hour as its arrival would have: Attention and FYI
//    under their switches, Noise and Unsorted silent, and not once it's been read, Done, trashed,
//    archived or snoozed again. A conversation snoozed whole returns whole, so it notifies once, for
//    its newest email back. Each return is sent once (notify()'s dedupe key), and one that failed to
//    send is tried again on later passes within the hour.
// The snooze's end is stored on the email, so a restart returns everything that fell due while the
// server was down.
import {and, eq, gte, inArray, isNotNull, isNull, lte} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {returnFromSnooze} from '../commands/mail.ts';
import {conversationKey} from '../domain/inbox.ts';
import type {Notifier} from '../notify/index.ts';
import {isoNow} from '../store.ts';
import type {Store} from '../store.ts';

// As with new mail, a return older than this is too late to be news.
const NOTIFY_WITHIN_MS = 60 * 60_000;

/** A returned email's notification: who it's from, and that it's back. */
export const snoozeReturnText = (row: {fromName: string; fromAddress: string; subject: string; snippet: string}) =>
  ({title: row.fromName || row.fromAddress, body: `Back from snooze · ${row.subject || row.snippet}`});

export class SnoozeScheduler {
  private readonly store: Store;
  private readonly notifier: Notifier | null;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(options: {store: Store; notifier?: Notifier | null}) {
    this.store = options.store;
    this.notifier = options.notifier ?? null;
  }

  start(everyMs = 60_000) {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), everyMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. A pass already running is joined rather than doubled. */
  tick(): Promise<void> {
    this.running ??= this.pass().catch(error => console.error('Snooze', error)).finally(() => (this.running = null));
    return this.running;
  }

  private async pass() {
    const {store} = this;
    const due = store.db.select({id: t.messages.id}).from(t.messages).where(lte(t.messages.snoozedUntil, isoNow(store))).all();
    for (const {id} of due) returnFromSnooze(store, id);
    if (!this.notifier) return;

    const since = new Date(store.now().getTime() - NOTIFY_WITHIN_MS).toISOString();
    const returned = store.db.select().from(t.messages).where(and(
      gte(t.messages.returnedAt, since), isNotNull(t.messages.returnedAt), eq(t.messages.received, true), eq(t.messages.unread, true),
      inArray(t.messages.lane, ['attention', 'fyi']), isNull(t.messages.doneAt), isNull(t.messages.trashedAt), isNull(t.messages.archivedAt), isNull(t.messages.snoozedUntil),
    )).all();
    // One per conversation and return: its newest email back.
    const newest = new Map<string, (typeof returned)[number]>();
    for (const row of returned) {
      const key = `${conversationKey(row)}\n${row.returnedAt}`;
      const was = newest.get(key);
      if (!was || row.receivedAt > was.receivedAt || (row.receivedAt === was.receivedAt && row.id > was.id)) newest.set(key, row);
    }
    for (const row of newest.values()) {
      await this.notifier.notify({
        kind: 'mail', topic: 'mail', lane: row.lane as 'attention' | 'fyi', ...snoozeReturnText(row),
        link: {to: 'message', id: row.id}, dedupe: `snooze:${row.id}@${row.returnedAt}`,
      });
    }
  }
}
