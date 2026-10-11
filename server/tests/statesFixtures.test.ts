// F7's fixtures (src/dev/fixtures/states.ts): each gives its board the state it draws, through the
// same queries the API answers with.
import {describe, expect, test} from 'vitest';
import {FIXTURES} from '../src/dev/fixtures/index.ts';
import {inbox, indexing, mailCounts, trustedDomains} from '../src/queries/mail.ts';
import {accountList, sourceList} from '../src/queries/sources.ts';
import {getSettings} from '../src/settings.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {Adapters} from '../src/sync/registry.ts';
import {devProvider} from '../src/providers/dev/index.ts';
import {triageStatus} from '../src/triage/health.ts';
import {listRules, precision} from '../src/triage/learning.ts';
import {world} from './helpers.ts';

const seededWith = (...names: string[]) => {
  const w = world({seed: true});
  for (const name of names) FIXTURES[name]!.apply({sqlite: w.store.sqlite, db: w.store.db});
  return w;
};
const healthOf = (w: ReturnType<typeof world>, label: string) => accountList(w.store).find(account => account.label === label)!.health;

describe('F7\'s fixtures', () => {
  test('needs-reconnect: Business needs sign-in, and the others stay healthy', () => {
    const w = seededWith('needs-reconnect');
    expect(healthOf(w, 'Business').state).toBe('needs_reconnect');
    expect(accountList(w.store).filter(account => account.health.state !== 'healthy').map(account => account.label)).toEqual(['Business']);
  });

  test.each([
    ['stale-personal', 'Personal', '2026-10-07T04:14:00.000Z'],
    ['stale-icloud', 'iCloud', '2026-10-07T15:40:00.000Z'],
  ])('%s: %s is stale as of its last check, and the engine doesn\'t check it again', async (name, label, asOf) => {
    const w = seededWith(name);
    expect(healthOf(w, label)).toMatchObject({state: 'stale', as_of: asOf});
    const engine = new SyncEngine({store: w.store, adapters: new Adapters({}, devProvider({delayMs: 0}))});
    await engine.tick();
    await engine.settled();
    expect(healthOf(w, label).state).toBe('stale');
  });

  test('failing-work: Work\'s last check failed, with Gmail\'s words', () => {
    expect(healthOf(seededWith('failing-work'), 'Work')).toMatchObject({state: 'failing', as_of: '2026-10-07T16:06:00.000Z', reason: 'Gmail answered 503.'});
  });

  test('SV-20: stale-todoist is stale as of 8:40 AM and stays so; failing-weather failed at 9:00 AM in Pirate Weather\'s words', async () => {
    const w = seededWith('stale-todoist', 'failing-weather');
    const healthOfSource = (provider: string) => sourceList(w.store).find(source => source.provider === provider)!.health;
    expect(healthOfSource('todoist')).toMatchObject({state: 'stale', as_of: '2026-10-07T15:40:00.000Z'});
    expect(healthOfSource('weather')).toMatchObject({state: 'failing', as_of: '2026-10-07T15:30:00.000Z', reason: 'Pirate Weather answered 500 Internal Server Error.'});
    expect(sourceList(w.store).filter(source => source.provider === 'google_calendar').every(source => source.health.state === 'healthy')).toBe(true);
    const engine = new SyncEngine({store: w.store, adapters: new Adapters({}, devProvider({delayMs: 0}))});
    await engine.tick();
    await engine.settled();
    expect(healthOfSource('todoist').state).toBe('stale');
  });

  test('checked: Calendar and Todoist last checked 9:10 AM, Weather 9:00 AM', () => {
    const w = seededWith('checked');
    const at = (provider: string) => sourceList(w.store).filter(source => source.provider === provider).map(source => source.health.last_check_at);
    expect([...new Set(at('google_calendar')), ...at('todoist'), ...at('weather')]).toEqual(['2026-10-07T16:10:00.000Z', '2026-10-07T16:10:00.000Z', '2026-10-07T16:00:00.000Z']);
  });

  test('triage-down: down as of 9:09 AM, with two emails in Unsorted under Attention (21 unread)', () => {
    const w = seededWith('triage-down');
    expect(triageStatus(w.store)).toMatchObject({state: 'down', as_of: '2026-10-07T16:09:00.000Z', unsorted: 2});
    const groups = inbox(w.store).groups;
    expect(groups.map(group => group.group).slice(0, 3)).toEqual(['pinned', 'attention', 'unsorted']);
    expect(groups[2]!.rows.map(row => row.subject)).toEqual(['Online assessment · Data Analyst', 'Order confirmation']);
    expect(mailCounts(w.store).unread).toBe(21);
  });

  test('backfill: the first backfill is 62% through', () => {
    expect(indexing(seededWith('backfill').store).indexing).toEqual({progress: 0.62});
  });

  test('precision: 82% of 150 attention emails opened before Done, over 30 days', () => {
    const result = precision(seededWith('precision').store);
    expect([result.precision, result.done, result.days.length]).toEqual([0.82, 150, 30]);
  });

  test('mail-rules: three written rules in order, two learned, and 78 trusted domains', () => {
    const w = seededWith('mail-rules');
    expect(listRules(w.store).map(rule => [rule.origin, rule.lane, rule.kind])).toEqual([
      ['written', 'attention', null], ['written', 'fyi', 'money'], ['written', 'noise', null], ['learned', 'fyi', 'updates'], ['learned', 'fyi', 'updates'],
    ]);
    expect(trustedDomains(w.store)).toHaveLength(78);
  });

  test('ntfy: a server set up, and Home', () => {
    const settings = getSettings(seededWith('ntfy').store);
    expect([settings.notifications.ntfy_server, settings.notifications.topics.reminders, settings.calendar.home?.label]).toEqual(['https://ntfy.example.net', 'setpoint-reminders', 'Home']);
  });
});
