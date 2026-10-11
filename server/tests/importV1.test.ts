// v1's rules and lane corrections, read from the file B7's export will write (an invented one here):
// rules that decided a lane become written rules, what v2 can't do is reported, corrections become
// evidence toward pattern prompts, and a second import adds nothing.
import fs from 'node:fs';
import {eq} from 'drizzle-orm';
import {expect, test} from 'vitest';
import {setDone} from '../src/commands/mail.ts';
import * as t from '../src/db/schema.ts';
import {upsertMessages} from '../src/sync/mailMirror.ts';
import {importV1Triage} from '../src/triage/importV1.ts';
import {currentPrompts, listRules} from '../src/triage/learning.ts';
import {triageWorld} from './triageWorld.ts';

const FILE = JSON.parse(fs.readFileSync(new URL('./fixtures/v1-triage-export.json', import.meta.url), 'utf8'));

test('v1\'s export imports as written rules and prompt evidence, once', () => {
  const world = triageWorld({anthropic: 'http://127.0.0.1:9', openai: 'http://127.0.0.1:9'});
  const report = importV1Triage(world.store, FILE);
  expect(report).toEqual({
    rules: {
      imported: 4, disabled: ['Body-only receipt (never turned on)'],
      skipped: [
        {name: 'Weak security to the model', why: 'it only sent mail to a model, which v2 always does'},
        {name: 'Return audit', why: 'an audit in v1: it never decided a lane'},
        {name: 'Broad promo words', why: 'v2 rules have no any_includes or all_includes'},
      ],
    },
    corrections: {imported: 5, already: 0, ignored: 1, toward_prompts: 4},
  });
  const rules = listRules(world.store).filter(rule => rule.imported);
  expect(rules.map(rule => ({match: rule.match, lane: rule.lane, kind: rule.kind, enabled: rule.enabled}))).toEqual([
    {match: {from_domains: ['registrar.contosou.example'], subject_includes: ['deadline', 'registration']}, lane: 'attention', kind: 'updates', enabled: true},
    {match: {from_domains: ['woodgrovebank.example'], subject_regex: 'statement', none_includes: ['past due', 'declined']}, lane: 'fyi', kind: 'money', enabled: true},
    {match: {from_name_includes: ['proseware'], body_includes: ['thank you for your payment']}, lane: 'fyi', kind: 'money', enabled: false},
    {match: {from_addresses: ['news@fabrikam.example']}, lane: 'noise', kind: null, enabled: true},
  ]);

  // Three newsletters corrected out of Attention in v1, and one cleared unopened in v2: a prompt.
  expect(currentPrompts(world.store)).toEqual([]);
  const [id] = upsertMessages(world.store, world.accountId('Jobs'), [world.fetched({subject: 'Adatum Careers newsletter · October'})], {backfill: true}).inserted;
  world.store.db.update(t.messages).set({backfill: false, lane: 'attention', organisation: 'Adatum Careers', type: 'newsletter', kind: 'career'}).where(eq(t.messages.id, id!)).run();
  setDone(world.store, id!, true);
  const adatum = currentPrompts(world.store).find(prompt => prompt.organisation === 'Adatum Careers');
  expect(adatum).toMatchObject({type: 'newsletter', count: 4, message_ids: [id], kind: 'career'});

  // Again: the same rules, replaced by name, and the corrections already there.
  const again = importV1Triage(world.store, FILE);
  expect(again.corrections).toEqual({imported: 0, already: 5, ignored: 1, toward_prompts: 0});
  expect(listRules(world.store).filter(rule => rule.imported)).toHaveLength(4);
});

test('a file that isn\'t v1\'s export is refused, naming the problem', () => {
  const world = triageWorld({anthropic: 'http://127.0.0.1:9', openai: 'http://127.0.0.1:9'});
  expect(() => importV1Triage(world.store, {...FILE, version: 2})).toThrow(/version/);
  expect(world.store.db.select().from(t.triageRules).all()).toEqual([]);
});
