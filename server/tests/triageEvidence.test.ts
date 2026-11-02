// Lane corrections kept in triage_evidence count toward the pattern prompts beside Done (decisions
// 27, 28): out of Attention as cleared unopened, into it as opened first.
import {eq} from 'drizzle-orm';
import {expect, test} from 'vitest';
import {setDone} from '../src/commands/mail.ts';
import * as t from '../src/db/schema.ts';
import {organisationKey} from '../src/domain/triageRules.ts';
import {currentPrompts} from '../src/triage/learning.ts';
import {world} from './helpers.ts';
import type {World} from './helpers.ts';

const ORGANISATION = 'Adatum Careers';

const correction = (w: World, at: string, fromLane: 'attention' | 'fyi' | 'noise', toLane: 'attention' | 'fyi' | 'noise') => w.store.db.insert(t.triageEvidence).values({
  source: 'v1_correction', organisation: ORGANISATION, organisationKey: organisationKey(ORGANISATION), type: 'newsletter', fromAddress: 'news@adatum.example',
  subject: 'Adatum Careers newsletter', fromLane, toLane, at, dedupe: at,
}).run();

test('corrections join Done in a prompt\'s run, and one back into Attention ends it', () => {
  const w = world({seed: true});
  const id = w.store.db.select().from(t.messages).where(eq(t.messages.subject, 'Final exam schedule · CS 101')).get()!.id;
  w.store.db.update(t.messages).set({organisation: ORGANISATION, type: 'newsletter', kind: 'career'}).where(eq(t.messages.id, id)).run();
  correction(w, '2026-09-01T16:00:00.000Z', 'attention', 'fyi');
  correction(w, '2026-09-02T16:00:00.000Z', 'attention', 'noise');
  correction(w, '2026-09-03T16:00:00.000Z', 'attention', 'fyi');
  // Between two lanes outside Attention says nothing.
  correction(w, '2026-09-04T16:00:00.000Z', 'fyi', 'noise');
  expect(currentPrompts(w.store)).toEqual([]);

  setDone(w.store, id, true);
  expect(currentPrompts(w.store)).toMatchObject([{organisation: ORGANISATION, type: 'newsletter', count: 4, message_ids: [id], kind: 'career'}]);

  correction(w, '2026-12-01T16:00:00.000Z', 'fyi', 'attention');
  expect(currentPrompts(w.store)).toEqual([]);
});
