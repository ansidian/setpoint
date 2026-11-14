// The Inbox's empty pane's numbers (SV-218, D465): how the mail day is going, as a table over the rule
// and over the seed through the API.
import {SEED_NOW} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import {setDone, trashMessage} from '../src/commands/mail.ts';
import * as t from '../src/db/schema.ts';
import {mailDay} from '../src/domain/inbox.ts';
import type {DayCandidate} from '../src/domain/inbox.ts';
import {mailDayOf} from '../src/queries/mail.ts';
import {signedIn, world} from './helpers.ts';

const NOW = '2026-10-07T16:12:00.000Z';
// Midnight in Los Angeles, the day NOW is in.
const DAY_START = '2026-10-07T07:00:00.000Z';
const email = (fields: Partial<DayCandidate>): DayCandidate => ({
  id: 1, accountId: 1, lane: 'fyi', kind: 'other', unread: true, receivedAt: '2026-10-07T15:00:00.000Z', organisation: null, fromName: 'A',
  pinnedAt: null, doneAt: null, trashedAt: null, codeExpiresAt: null, archivedAt: null, triagedAt: null, triageSource: null, ...fields,
});

describe('the mail day (SV-218)', () => {
  test.each([
    ['Done today counts; Done yesterday doesn\'t', [email({lane: 'attention', doneAt: '2026-10-07T08:00:00.000Z'}), email({lane: 'attention', doneAt: '2026-10-07T06:59:00.000Z'})],
      {done: 1, needYou: 0, overdue: 0}],
    ['Attention not Done needs the user, read or not', [email({lane: 'attention'}), email({lane: 'attention', unread: false})], {needYou: 2, overdue: 0}],
    ['over 24 hours since arriving is overdue; exactly 24 isn\'t', [email({lane: 'attention', receivedAt: '2026-10-06T16:11:00.000Z'}), email({lane: 'attention', receivedAt: '2026-10-06T16:12:00.000Z'})],
      {needYou: 2, overdue: 1}],
    ['sorted today to FYI and to Noise; Attention and Unsorted aren\'t counted', [
      email({triagedAt: '2026-10-07T09:00:00.000Z'}), email({lane: 'noise', triagedAt: '2026-10-07T09:00:00.000Z'}),
      email({lane: 'attention', triagedAt: '2026-10-07T09:00:00.000Z'}), email({lane: null}),
    ], {sortedFyi: 1, sortedNoise: 1, needYou: 1}],
    ['sorted before midnight, or by the pass over history, isn\'t today\'s', [
      email({triagedAt: '2026-10-07T06:00:00.000Z'}), email({triagedAt: '2026-10-07T09:00:00.000Z', triageSource: 'history'}),
    ], {sortedFyi: 0}],
    ['trashed mail counts nowhere', [email({lane: 'attention', trashedAt: NOW, doneAt: '2026-10-07T08:00:00.000Z'}), email({trashedAt: NOW, triagedAt: '2026-10-07T09:00:00.000Z'})],
      {done: 0, needYou: 0, sortedFyi: 0}],
  ] as const)('%s', (_, messages, day) => expect(mailDay([...messages], NOW, DAY_START)).toMatchObject(day));

  test('the route answers with the day\'s numbers', async () => {
    const w = world({seed: true, now: SEED_NOW});
    const c = await signedIn(w);
    const number = expect.any(Number);
    expect((await c.send('GET', '/api/mail/day')).body).toEqual({
      done: number, need_you: number, overdue: number, sorted_fyi: number, sorted_noise: number, total: number, bytes: number, oldest_at: expect.any(String),
    });
  });

  test('the size is every kept email\'s text and HTML plus its attachments; Done and Trash move the numbers', () => {
    const w = world({seed: true});
    const rows = w.store.db.select().from(t.messages).all();
    const text = rows.reduce((sum, row) => sum + Buffer.byteLength(row.bodyText) + Buffer.byteLength(row.bodyHtml ?? ''), 0);
    const attached = w.store.db.select().from(t.attachments).all().reduce((sum, row) => sum + row.sizeBytes, 0);
    expect(mailDayOf(w.store).bytes).toBe(text + attached);

    const attention = (subject: string) => w.store.db.select().from(t.messages).where(eq(t.messages.subject, subject)).get()!.id;
    setDone(w.store, attention('Your recovery email was changed'), true);
    trashMessage(w.store, attention('Final exam schedule · CS 101'), true);
    // 33 of the seed's mail, and its 7 USPS digests (SV-274), out of the Inbox but kept.
    expect(mailDayOf(w.store)).toMatchObject({done: 1, need_you: 1, total: 40});
  });
});
