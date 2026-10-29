// Where Jobs's reading of mail stands (J2): what it reads (on, the accounts it lists, mail received
// since it was turned on), and its health, kept as triage's is (src/triage/health.ts): down while its
// last model call failed or there was no key to call with, as of its last success. Emails wait while
// it's down, counted for the page ("5 emails not read yet, Anthropic unreachable since 8:52 AM,
// retrying"), and are read once it's back.
import {eq} from 'drizzle-orm';
import type {ProviderErrorKind} from '../domain/retry.ts';
import {isoNow, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {jobsDb} from './db.ts';
import {emailsWaiting} from './mail.ts';
import type {ReadWindow} from './mail.ts';
import * as j from './schema.ts';

/** What Jobs reads as mail arrives: null while it's off. Mail from before it was turned on is J4's. */
export function readWindow(store: Store): ReadWindow | null {
  const settings = jobsDb(store.sqlite).select().from(j.jobsSettings).get();
  if (!settings?.enabled) return null;
  return {accounts: settings.accounts, from: settings.enabledAt ?? settings.updatedAt};
}

type Row = typeof j.jobsReader.$inferSelect;

function row(store: Store): Row {
  return jobsDb(store.sqlite).select().from(j.jobsReader).where(eq(j.jobsReader.id, 1)).get()
    ?? {id: 1, lastSuccessAt: null, lastFailureAt: null, failingSince: null, lastError: null, lastErrorKind: null};
}

const isDown = (health: Row) => health.lastFailureAt !== null && (health.lastSuccessAt === null || health.lastFailureAt > health.lastSuccessAt);

function save(store: Store, values: Partial<Row>) {
  jobsDb(store.sqlite).insert(j.jobsReader).values({id: 1, ...values}).onConflictDoUpdate({target: j.jobsReader.id, set: values}).run();
}

/** A model answered. Returns true when that ended a spell of being down. */
export function recordReadSuccess(store: Store): boolean {
  return transaction(store, () => {
    const wasDown = isDown(row(store));
    save(store, {lastSuccessAt: isoNow(store), failingSince: null});
    return wasDown;
  });
}

/** A model call failed, or none could be made. Returns true when reading just went down. */
export function recordReadFailure(store: Store, kind: ProviderErrorKind, reason: string): boolean {
  return transaction(store, () => {
    const health = row(store);
    const wasDown = isDown(health);
    const now = isoNow(store);
    save(store, {lastFailureAt: now, failingSince: wasDown ? health.failingSince ?? now : now, lastError: reason, lastErrorKind: kind});
    return !wasDown;
  });
}

/** The page's reading line: how many emails wait, and whether the AI is down and since when. */
export function readingStatus(store: Store) {
  const window = readWindow(store);
  const health = row(store);
  const down = isDown(health);
  return {
    waiting: window ? emailsWaiting(store, window) : 0,
    state: down ? 'down' as const : 'healthy' as const,
    since: down ? health.failingSince : null,
    reason: down ? health.lastError : null,
    // A refused or missing key waits for Settings › AI; anything else is retried.
    retrying: down && health.lastErrorKind !== 'auth' && health.lastErrorKind !== 'permanent',
  };
}
