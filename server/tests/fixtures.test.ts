// Board fixtures layered on the seed (SV decision D3): board 11b's busy Saturday, and the mail
// boards' (02, 03, 09, 10) plus the mail checks' expiring code. Each gives its board's state and
// counts, and leaves the rest of the seed as it was.
import {SEED_NOW} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {busySaturday} from '../src/dev/fixtures/busySaturday.ts';
import {FIXTURES} from '../src/dev/fixtures/index.ts';
import {inbox, mailCounts, messageDetail} from '../src/queries/mail.ts';
import {itemsInRange} from '../src/queries/items.ts';
import {currentPrompts} from '../src/triage/learning.ts';
import {world} from './helpers.ts';

describe('the busy-saturday fixture (board 11b)', () => {
  test('Sat, Oct 17 holds six events and two tasks; the rest of the seed is untouched', () => {
    const w = world({seed: true});
    const before = itemsInRange(w.store, '2026-10-01', '2026-11-01').items.length;
    busySaturday({sqlite: w.store.sqlite, db: w.store.db});
    const day = itemsInRange(w.store, '2026-10-17', '2026-10-18').items;
    expect(day.filter(item => item.kind === 'event').map(item => item.title)).toEqual(['Farmers market', 'Haircut', 'Lunch with Jo', 'Volunteer shift', 'Call Mom', 'Movie night']);
    expect(day.filter(item => item.kind === 'task').map(item => [item.title, item.project])).toEqual([['Grocery run', 'Home'], ['Laundry', 'Home']]);
    expect(itemsInRange(w.store, '2026-10-01', '2026-11-01').items.length).toBe(before + 8);
  });

  test('it needs the seed, and is listed for its board', () => {
    const w = world();
    expect(() => busySaturday({sqlite: w.store.sqlite, db: w.store.db})).toThrow(/npm run seed/);
    expect(FIXTURES['busy-saturday']!.board).toBe('11b');
  });
});

describe('the mail boards\' fixtures', () => {
  const seededWith = (name: string) => {
    const w = world({seed: true});
    FIXTURES[name]!.apply({sqlite: w.store.sqlite, db: w.store.db});
    return w;
  };
  const rowsOf = (w: ReturnType<typeof world>, group: string) => inbox(w.store).groups.find(item => item.group === group)?.rows ?? [];

  test('new-digest (09): four digests cleared unopened and a fifth that arrives now, unread in Attention: 4 attention, 20 unread, and a real prompt', () => {
    const w = seededWith('new-digest');
    const counts = mailCounts(w.store);
    expect([counts.attention, counts.unread]).toEqual([4, 20]);
    const attention = rowsOf(w, 'attention');
    expect(attention.map(row => [row.subject, row.received_at, row.unread])[0]).toEqual(['Northwind Engineering Digest · October 7', SEED_NOW, true]);
    expect(attention).toHaveLength(4);
    // The four Done digests are B3's run: a real pattern prompt, and the base seed has none.
    expect(currentPrompts(w.store).map(prompt => [prompt.organisation, prompt.type, prompt.count])).toEqual([['Northwind Engineering', 'newsletter', 4]]);
    expect(currentPrompts(world({seed: true}).store)).toEqual([]);
  });

  test('second-pin (10): two pins, Parkside first (pinned last)', () => {
    const w = seededWith('second-pin');
    expect(rowsOf(w, 'pinned').map(row => row.subject)).toEqual(['Lease renewal terms', 'Car registration renewal notice']);
    expect(mailCounts(w.store).unread).toBe(19);
  });

  test.each([
    ['coffee-html', 'The Contoso Coffee Journal · October', /cdn\.contosocoffee\.example/],
    ['recovery-html', 'Your recovery email was changed', /Check activity/],
    ['newsletter-html', 'The Contoso Coffee Journal · October', /files\.mailing\.example/],
  ] as const)('%s: the HTML body the board draws', (name, subject, html) => {
    const w = seededWith(name);
    const id = [...rowsOf(w, 'noise'), ...rowsOf(w, 'attention')].find(row => row.subject === subject)!.id;
    expect(messageDetail(w.store, id).body_html).toMatch(html);
    expect(mailCounts(w.store).unread).toBe(19);
  });

  test('code-expiring: the code leaves the Inbox 12 seconds after the seed\'s moment', () => {
    const w = seededWith('code-expiring');
    expect(rowsOf(w, 'security').some(row => row.code)).toBe(true);
    w.advance(12_000);
    expect(rowsOf(w, 'security').some(row => row.code)).toBe(false);
  });

  test.each([['coffee-html'], ['recovery-html'], ['newsletter-html'], ['new-digest'], ['second-pin'], ['code-expiring']])('%s needs the seed', name => {
    const w = world();
    expect(() => FIXTURES[name]!.apply({sqlite: w.store.sqlite, db: w.store.db})).toThrow(/npm run seed/);
  });
});

describe('the calendar change fixtures (F6)', () => {
  const seededWith = (name: string) => {
    const w = world({seed: true});
    FIXTURES[name]!.apply({sqlite: w.store.sqlite, db: w.store.db});
    return w;
  };
  const day = (w: ReturnType<typeof world>, date: string) => itemsInRange(w.store, date, `2026-10-${String(Number(date.slice(8)) + 1).padStart(2, '0')}`).items;

  test('no-dinner (13): Dinner with Sam isn\'t on Friday yet; the rest of Friday is', () => {
    const w = seededWith('no-dinner');
    expect(day(w, '2026-10-09').map(item => item.title)).toEqual(['Gym', 'Study group']);
    expect(FIXTURES['no-dinner']!.board).toBe('13');
  });

  test('failed-change (19b): Dinner with Sam on Saturday, failed in place with Google\'s words and Move back; Pay rent done and waiting', () => {
    const w = seededWith('failed-change');
    expect(day(w, '2026-10-09').map(item => item.title)).toEqual(['Gym', 'Study group']);
    const [dinner] = day(w, '2026-10-10');
    expect(dinner).toMatchObject({
      title: 'Dinner with Sam',
      command: {kind: 'item_update', state: 'failed', provider: 'google_calendar', can_retry: true, can_move_back: true, provider_message: 'The requested event was modified by another client. (409 Conflict)'},
    });
    expect(dinner!.command!.previous!.starts_at).toBe('2026-10-10T02:00:00.000Z');
    const rent = day(w, '2026-10-07').find(item => item.title === 'Pay rent')!;
    expect(rent).toMatchObject({done: true, command: {kind: 'item_complete', state: 'pending', provider: 'todoist'}});
  });
});
