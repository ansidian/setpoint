// Settings › Jobs's server side (J4; drawn in J8, board 39a; D310, D331): on or off, the accounts it
// reads, the history pass's progress or when it finished, and From history's count.
//
// - Turning Jobs on sets `enabled_at` (mail from then on is the live reader's) and starts the history
//   pass over what came before (./history.ts), once: it never re-reads or re-charges an email.
// - Off stops reading, the live reader and the pass alike; nothing read is undone.
// - On again reads, as history, whatever the listed accounts hold from before then that Jobs hasn't
//   read (mail that came while it was off among it); with nothing left, the last pass stands.
// - Accounts changed while it's on start the pass again, over what the new list hasn't had read
//   from before it was turned on; mail since then is the live reader's, whatever the list.
import type {JobsSettingsOut, JobsSettingsPatch} from '@setpoint/shared';
import {count, eq, isNull, and} from 'drizzle-orm';
import {invalid} from '../errors.ts';
import {isoNow, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {jobsDb} from './db.ts';
import {announceHistory, startHistory} from './history.ts';
import {historyStatus} from './historyState.ts';
import {existingAccounts} from './mail.ts';
import * as j from './schema.ts';

/** GET /api/jobs/settings. */
export function jobsSettings(store: Store): JobsSettingsOut {
  const db = jobsDb(store.sqlite);
  const settings = db.select().from(j.jobsSettings).get();
  return {
    enabled: settings?.enabled ?? false,
    accounts: settings?.accounts ?? [],
    history: historyStatus(store),
    from_history: db.select({n: count()}).from(j.jobsNeedsYou).where(and(eq(j.jobsNeedsYou.fromHistory, true), isNull(j.jobsNeedsYou.resolvedAt))).get()?.n ?? 0,
    applications: db.select({n: count()}).from(j.jobsApplications).get()?.n ?? 0,
  };
}

/** PATCH /api/jobs/settings: turns Jobs on or off and sets the accounts it reads. */
export function updateJobsSettings(store: Store, patch: JobsSettingsPatch): JobsSettingsOut {
  const db = jobsDb(store.sqlite);
  transaction(store, () => {
    const current = db.select().from(j.jobsSettings).get();
    if (patch.accounts) {
      const known = existingAccounts(store, patch.accounts.map(account => account.account_id));
      const unknown = patch.accounts.filter(account => !known.has(account.account_id));
      if (unknown.length) throw invalid('Jobs can only read mail\'s own accounts.', {accounts: unknown.map(account => account.account_id)});
    }
    const now = isoNow(store);
    const wasOn = current?.enabled ?? false;
    const enabled = patch.enabled ?? wasOn;
    const accounts = patch.accounts ?? current?.accounts ?? [];
    const turnedOn = enabled && !wasOn;
    const accountsChanged = patch.accounts !== undefined && JSON.stringify(patch.accounts) !== JSON.stringify(current?.accounts ?? []);
    if (!turnedOn && !accountsChanged && enabled === wasOn) return;
    // A row from before J4 has no `enabled_at` and reads `updated_at`: pin it before that moves.
    const enabledAt = turnedOn ? now : current?.enabledAt ?? current?.updatedAt ?? null;
    const values = {enabled, accounts, enabledAt, updatedAt: now};
    db.insert(j.jobsSettings).values({id: 1, ...values}).onConflictDoUpdate({target: j.jobsSettings.id, set: values}).run();
    if (enabled && (turnedOn || accountsChanged)) startHistory(store);
    // On or off, or what it reads: the page, the sidebar and Settings ask again.
    else announceHistory(store);
  });
  return jobsSettings(store);
}
