// Settings › AI's Jobs group (J8, board 39b, D315) through GET /api/jobs/ai: the three models by name,
// whether they can run, and this month's spend from the ledger in its three parts, counting only
// Jobs's calls since local midnight on the 1st. The seed's own usage is $3.85 (seed.ts JOBS_USAGE).
import type {AiPurpose} from '@setpoint/shared';
import {jobsAiSchema} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {signedIn, world} from '../../../tests/helpers.ts';
import {FAKE_KEYS} from '../../../tests/fakeModels.ts';
import * as t from '../../db/schema.ts';
import {seedSampleData} from '../../dev/sample.ts';
import {openDatabase} from '../../db/open.ts';
import {setSecret} from '../../secrets/store.ts';
import {jobsApi} from '../api.ts';

const call = (at: string, purpose: AiPurpose, dollars: number, input = 1000, output = 100) => ({
  at, provider: 'anthropic' as const, model: 'claude-haiku-5-5', purpose, messageId: null, inputTokens: input, outputTokens: output, costMicros: Math.round(dollars * 1_000_000),
});

describe('Settings › AI\'s Jobs group (39b)', () => {
  test('its three models by name, needing a key until Anthropic\'s is set', async () => {
    const w = world({seed: true});
    const c = await signedIn(w, {routes: [jobsApi(w.store)]});
    const before = jobsAiSchema.parse((await c.send('GET', '/api/jobs/ai')).body);
    expect(before.models).toEqual({emails: 'claude-haiku-5-5', finding: 'claude-sonnet-5-5', reading: 'claude-haiku-5-5'});
    expect(before.missing).toBe('Jobs needs an Anthropic key in Settings › AI.');
    setSecret(w.store, 'anthropic_api_key', FAKE_KEYS.anthropic);
    expect(jobsAiSchema.parse((await c.send('GET', '/api/jobs/ai')).body).missing).toBeNull();
  });

  test('this month\'s spend in its three parts, and nothing from last month or from mail and News', async () => {
    const w = world({seed: true});
    w.store.db.insert(t.aiUsage).values([
      // Sep 30, 11:59 PM in Los Angeles: last month.
      call('2026-10-01T06:59:00.000Z', 'jobs_emails', 9),
      // Oct 1, 12:00 AM: this month.
      call('2026-10-01T07:00:00.000Z', 'jobs_emails', 0.25, 1200, 80),
      call('2026-10-04T16:00:00.000Z', 'jobs_emails', 0.37, 900, 60),
      call('2026-10-05T16:00:00.000Z', 'jobs_finding_jds', 2.71, 24_000, 900),
      call('2026-10-06T16:00:00.000Z', 'jobs_reading_jds', 0.52, 5200, 380),
      call('2026-10-06T17:00:00.000Z', 'triage', 4),
      call('2026-10-06T18:00:00.000Z', 'news_stories', 5),
    ]).run();
    const c = await signedIn(w, {routes: [jobsApi(w.store)]});
    const {this_month: month} = jobsAiSchema.parse((await c.send('GET', '/api/jobs/ai')).body);
    expect(month.emails).toEqual({calls: 2, input_tokens: 2100, output_tokens: 140, cost_usd: 0.62});
    expect(month.finding_jds).toEqual({calls: 1, input_tokens: 24_000, output_tokens: 900, cost_usd: 2.71});
    expect(month.reading_jds).toEqual({calls: 1, input_tokens: 5200, output_tokens: 380, cost_usd: 0.52});
    expect(month).toMatchObject({calls: 4, input_tokens: 31_300, output_tokens: 1420});
    expect(month.cost_usd).toBeCloseTo(3.85);
  });

  test('`npm run seed`\'s usage this month: emails $0.62, finding JDs $2.71 and reading JDs $0.52', async () => {
    const database = openDatabase(':memory:');
    try {
      seedSampleData(database, {usage: true});
      const w = world();
      const store = {...w.store, sqlite: database.sqlite, db: database.db};
      const c = await signedIn({...w, store}, {routes: [jobsApi(store)]});
      const {this_month: month} = jobsAiSchema.parse((await c.send('GET', '/api/jobs/ai')).body);
      expect([month.emails.cost_usd, month.finding_jds.cost_usd, month.reading_jds.cost_usd]).toEqual([0.62, 2.71, 0.52]);
      expect(month.cost_usd).toBeCloseTo(3.85);
    } finally {
      database.sqlite.close();
    }
  });
});
