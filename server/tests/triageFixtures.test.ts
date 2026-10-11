// B3's Done-when: the recorded fixture set triages to its expected lanes with the models faked at
// the HTTP boundary, through the real worker, pipeline, rules and policy, for either provider.
import type {AiProvider} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import {describe, expect, test, vi} from 'vitest';
import * as t from '../src/db/schema.ts';
import {setSecret} from '../src/secrets/store.ts';
import {updateSettings} from '../src/settings.ts';
import {upsertMessages} from '../src/sync/mailMirror.ts';
import {createRule} from '../src/triage/learning.ts';
import {DEFAULT_TRIAGE_MODELS} from '../src/triage/models.ts';
import {FAKE_KEYS, fakeModels} from './fakeModels.ts';
import type {FakeAnswer} from './fakeModels.ts';
import {FIXTURE_RULES, TRIAGE_FIXTURES} from './fixtures/triageEmails.ts';
import type {Recorded} from './fixtures/triageEmails.ts';
import {triageWorld} from './triageWorld.ts';

// Real HTTP round trips to the fake, dozens per test: generous under a loaded machine.
vi.setConfig({testTimeout: 30_000});

const answerOf = (recorded: Recorded | undefined, subject: string, tier: string): FakeAnswer => {
  if (recorded === undefined) throw new Error(`The ${tier} model wasn't expected for "${subject}"`);
  return typeof recorded === 'string' ? recorded : {tool: {...recorded}};
};

describe.each<AiProvider>(['anthropic', 'openai'])('the recorded fixture set, with %s\'s models faked', provider => {
  test('every email ends in its expected lane, kind, protection and code, asking the expected models', async () => {
    const fake = await fakeModels();
    const world = triageWorld(fake.endpoints);
    setSecret(world.store, provider === 'anthropic' ? 'anthropic_api_key' : 'openai_api_key', FAKE_KEYS[provider]);
    for (const rule of FIXTURE_RULES) createRule(world.store, {...rule, enabled: true});
    const models = DEFAULT_TRIAGE_MODELS[provider];
    fake.answer(request => {
      const subject = /^Subject: (.*)$/m.exec(request.input)?.[1] ?? '';
      const fixture = TRIAGE_FIXTURES.find(candidate => candidate.subject === subject);
      if (!fixture) throw new Error(`No fixture for "${subject}"`);
      const tier = request.model === models.cheap ? 'cheap' : 'strong';
      return answerOf(tier === 'cheap' ? fixture.cheap : fixture.strong, subject, tier);
    });

    const ids = new Map<string, number>();
    for (const [index, fixture] of TRIAGE_FIXTURES.entries()) {
      const [id] = upsertMessages(world.store, world.accountId(fixture.account), [world.fetched({
        providerId: `fixture-${index + 1}`, fromName: fixture.from[0], fromAddress: fixture.from[1], subject: fixture.subject, bodyText: fixture.body,
      })]).inserted;
      ids.set(fixture.name, id!);
    }
    await world.drain();

    for (const fixture of TRIAGE_FIXTURES) {
      const id = ids.get(fixture.name)!;
      const row = world.message(id);
      const asked = fake.requests.filter(request => request.input.includes(`Subject: ${fixture.subject}\n`)).map(request => (request.model === models.cheap ? 'cheap' : 'strong'));
      const {expect: wanted} = fixture;
      const got = {
        lane: row.lane, source: row.triageSource, tiers: asked, protected: row.protected, code: row.code,
        ...('kind' in wanted ? {kind: row.kind} : {}), ...('type' in wanted ? {type: row.type} : {}), ...('organisation' in wanted ? {organisation: row.organisation} : {}),
      };
      expect(got, fixture.name).toEqual({protected: false, code: null, ...wanted});
      // The policy's invariants hold on every row.
      if (row.protected) expect(row.lane, fixture.name).toBe('attention');
      if (row.code) expect(row.lane, fixture.name).not.toBe('attention');
      expect(row.lane === 'noise' ? row.kind === null : row.kind !== null, fixture.name).toBe(true);
    }

    // Every call is in the ledger with its tokens and cost; triage is healthy and nothing is Unsorted.
    const ledger = world.store.db.select().from(t.aiUsage).all();
    expect(ledger).toHaveLength(fake.requests.length);
    expect(ledger.every(entry => entry.provider === provider && entry.purpose === 'triage' && entry.inputTokens > 0 && entry.outputTokens > 0 && entry.costMicros > 0 && entry.messageId !== null)).toBe(true);
    expect(world.status()).toMatchObject({state: 'healthy', unsorted: 0});
    expect(world.store.db.select().from(t.messages).where(eq(t.messages.triageSource, 'rule')).all().length).toBeGreaterThan(0);
  });
});

test('a code row expires after Settings › Mail\'s code expiry', async () => {
  const fake = await fakeModels();
  const world = triageWorld(fake.endpoints);
  setSecret(world.store, 'anthropic_api_key', FAKE_KEYS.anthropic);
  updateSettings(world.store, {mail: {code_expiry_minutes: 5}});
  fake.answer(() => ({tool: {lane: 'fyi', kind: 'security', organisation: 'Contoso', via: null, type: 'verification_code', key_date: null, summary: null, security: null, protected_class: null, confidence: 0.9}}));
  const [id] = upsertMessages(world.store, world.accountId('Personal'), [world.fetched({subject: 'Your verification code', bodyText: 'Your verification code is 004719.', receivedAt: '2026-10-07T16:08:00.000Z'})]).inserted;
  await world.drain();
  expect(world.message(id!)).toMatchObject({code: '004719', codeExpiresAt: '2026-10-07T16:13:00.000Z', lane: 'fyi', kind: 'security'});
});
