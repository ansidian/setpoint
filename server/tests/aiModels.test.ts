// The model clients against the fake Anthropic and OpenAI (tests/fakeModels.ts): request shapes
// v1 learned (forced tool, thinking off, cacheable prefix, prompt cache key and its retry), usage
// and the providers' refusals as the retry policy's kinds. Plus the ledger's cost table.
import {describe, expect, test} from 'vitest';
import {costMicros} from '../src/domain/aiCost.ts';
import {anthropicClient, openaiClient} from '../src/providers/ai/index.ts';
import type {ModelRequest} from '../src/providers/ai/index.ts';
import {ProviderError} from '../src/sync/errors.ts';
import {FAKE_KEYS, fakeModels} from './fakeModels.ts';

const TOOL = {name: 'submit_email_triage', description: 'Submit one triage decision.', schema: {type: 'object', properties: {lane: {type: 'string'}}, required: ['lane']}};
const request = (changes: Partial<ModelRequest> = {}): ModelRequest => ({
  model: 'claude-haiku-5-5', system: 'Sort one email.', tool: TOOL, input: 'From: Woodgrove Bank <no-reply@woodgrovebank.example>', maxOutputTokens: 1400, cacheKey: 'setpoint-triage:v1:cheap', ...changes,
});

async function refusalOf(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProviderError) return error;
    throw error;
  }
  throw new Error('Expected a refusal');
}

describe('anthropicClient', () => {
  test('asks with a forced tool, thinking off and the system and tool marked cacheable', async () => {
    const fake = await fakeModels();
    fake.answer(() => ({tool: {lane: 'fyi'}, usage: {input: 400, output: 60, cacheRead: 1800, cacheWrite: 200}}));
    const answer = await anthropicClient({apiKey: FAKE_KEYS.anthropic, baseUrl: fake.endpoints.anthropic}).call(request());
    const sent = fake.requests[0]!;
    expect(sent.headers['anthropic-version']).toBe('2023-06-01');
    expect(sent.body).toMatchObject({
      model: 'claude-haiku-5-5', max_tokens: 1400, thinking: {type: 'disabled'},
      system: [{type: 'text', text: 'Sort one email.', cache_control: {type: 'ephemeral'}}],
      tools: [{name: 'submit_email_triage', input_schema: TOOL.schema, cache_control: {type: 'ephemeral'}}],
      tool_choice: {type: 'tool', name: 'submit_email_triage'},
      messages: [{role: 'user', content: 'From: Woodgrove Bank <no-reply@woodgrovebank.example>'}],
    });
    // Input counts cache reads and writes too.
    expect(answer).toEqual({
      provider: 'anthropic', model: 'claude-haiku-5-5', toolInput: {lane: 'fyi'},
      usage: {inputTokens: 2400, outputTokens: 60, cachedTokens: 1800, cacheWriteTokens: 200},
    });
  });

  test.each<[string, Record<string, unknown>, Record<string, unknown> | undefined]>([
    // model, tool_choice, thinking (claude-api skill: the newest models refuse a forced tool, and
    // Sonnet 5.5 turns thinking off with between_tools; Opus 5.5 can't turn it off)
    ['claude-haiku-5-5', {type: 'tool', name: 'submit_email_triage'}, {type: 'disabled'}],
    ['claude-haiku-4-5', {type: 'tool', name: 'submit_email_triage'}, {type: 'disabled'}],
    ['claude-sonnet-5-5', {type: 'auto'}, {type: 'between_tools'}],
    ['claude-opus-5-5', {type: 'auto'}, undefined],
    ['claude-fable-5-1', {type: 'auto'}, undefined],
  ])('%s is asked as it accepts', async (model, toolChoice, thinking) => {
    const fake = await fakeModels();
    fake.answer(() => ({tool: {lane: 'fyi'}}));
    await anthropicClient({apiKey: FAKE_KEYS.anthropic, baseUrl: fake.endpoints.anthropic}).call(request({model}));
    expect(fake.requests[0]!.body.tool_choice).toEqual(toolChoice);
    expect(fake.requests[0]!.body.thinking).toEqual(thinking);
  });

  test('an answer without the tool call is no reading, not an error', async () => {
    const fake = await fakeModels();
    fake.answer(() => 'no_tool');
    expect((await anthropicClient({apiKey: FAKE_KEYS.anthropic, baseUrl: fake.endpoints.anthropic}).call(request())).toolInput).toBeNull();
    fake.answer(() => 'broken_arguments');
    expect((await anthropicClient({apiKey: FAKE_KEYS.anthropic, baseUrl: fake.endpoints.anthropic}).call(request())).toolInput).toBeNull();
  });

  test.each<[string, Parameters<Awaited<ReturnType<typeof fakeModels>>['answer']>[0] | null, string, string, number | null]>([
    // name, answer (null: a wrong key), kind, message, retry after
    ['a refused key needs a new key', null, 'auth', 'Anthropic: invalid x-api-key (401). Check the Anthropic key in Settings › AI.', null],
    ['429 waits for Retry-After', () => 'rate_limited', 'rate_limited', 'Anthropic: Number of request tokens has exceeded your per-minute rate limit (429)', 20_000],
    ['529 overloaded is transient', () => 'overloaded', 'transient', 'Anthropic: Overloaded (529)', null],
    ['500 is transient', () => 'server_error', 'transient', 'Anthropic: Internal server error (500)', null],
    ['400 is permanent', () => ({status: 400, body: {type: 'error', error: {type: 'invalid_request_error', message: 'max_tokens: too large'}}}), 'permanent', 'Anthropic: max_tokens: too large (400)', null],
    ['an answer that isn\'t its JSON is transient', () => 'not_json', 'transient', 'Anthropic answered with something that isn\'t its API\'s JSON (200).', null],
  ])('%s', async (_, answer, kind, message, retryAfterMs) => {
    const fake = await fakeModels();
    if (answer) fake.answer(answer);
    const error = await refusalOf(anthropicClient({apiKey: answer ? FAKE_KEYS.anthropic : 'sk-ant-wrong', baseUrl: fake.endpoints.anthropic}).call(request()));
    expect({kind: error.kind, message: error.message, retryAfterMs: error.retryAfterMs}).toEqual({kind, message, retryAfterMs});
  });

  test('a call that hangs times out as transient', async () => {
    const fake = await fakeModels();
    fake.answer(() => 'hang');
    const error = await refusalOf(anthropicClient({apiKey: FAKE_KEYS.anthropic, baseUrl: fake.endpoints.anthropic, timeoutMs: 50}).call(request()));
    expect([error.kind, error.message]).toEqual(['transient', 'Anthropic didn\'t answer in time.']);
  });

  test('nothing listening is transient', async () => {
    const fake = await fakeModels();
    await fake.close();
    expect((await refusalOf(anthropicClient({apiKey: FAKE_KEYS.anthropic, baseUrl: fake.endpoints.anthropic}).call(request()))).kind).toBe('transient');
  });
});

describe('openaiClient', () => {
  test('asks the Responses API with a forced function, unstored, with a 24-hour prompt cache key', async () => {
    const fake = await fakeModels();
    fake.answer(() => ({tool: {lane: 'noise'}, usage: {input: 700, output: 40, cacheRead: 1200}}));
    const answer = await openaiClient({apiKey: FAKE_KEYS.openai, baseUrl: fake.endpoints.openai}).call(request({model: 'gpt-5.4-mini'}));
    expect(fake.requests[0]!.headers.authorization).toBe(`Bearer ${FAKE_KEYS.openai}`);
    expect(fake.requests[0]!.body).toMatchObject({
      model: 'gpt-5.4-mini', store: false, prompt_cache_key: 'setpoint-triage:v1:cheap', prompt_cache_retention: '24h',
      instructions: 'Sort one email.', input: 'From: Woodgrove Bank <no-reply@woodgrovebank.example>', max_output_tokens: 1400, reasoning: {effort: 'low'},
      tools: [{type: 'function', name: 'submit_email_triage', parameters: TOOL.schema, strict: false}],
      tool_choice: {type: 'function', name: 'submit_email_triage'},
    });
    expect(answer).toEqual({
      provider: 'openai', model: 'gpt-5.4-mini-2026-10-01', toolInput: {lane: 'noise'},
      usage: {inputTokens: 1900, outputTokens: 40, cachedTokens: 1200, cacheWriteTokens: 0},
    });
  });

  test('a model that refuses the cache fields is asked once more without them (v1)', async () => {
    const fake = await fakeModels();
    fake.answer(() => ({tool: {lane: 'fyi'}}));
    const answer = await openaiClient({apiKey: FAKE_KEYS.openai, baseUrl: fake.endpoints.openai}).call(request({model: 'gpt-no-cache'}));
    expect(answer.toolInput).toEqual({lane: 'fyi'});
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]!.body.prompt_cache_key).toBeUndefined();
    expect(fake.requests[0]!.body.store).toBe(false);
  });

  test('broken function arguments are no reading', async () => {
    const fake = await fakeModels();
    fake.answer(() => 'broken_arguments');
    expect((await openaiClient({apiKey: FAKE_KEYS.openai, baseUrl: fake.endpoints.openai}).call(request({model: 'gpt-5.4-mini'}))).toolInput).toBeNull();
  });

  test.each<[string, Parameters<Awaited<ReturnType<typeof fakeModels>>['answer']>[0] | null, string, string]>([
    ['a refused key', null, 'auth', 'OpenAI: Incorrect API key provided. (401). Check the OpenAI key in Settings › AI.'],
    ['429', () => 'rate_limited', 'rate_limited', 'OpenAI: Rate limit reached for requests (429)'],
    ['503 overloaded', () => 'overloaded', 'transient', 'OpenAI: The engine is currently overloaded, please try again later (503)'],
  ])('%s', async (_, answer, kind, message) => {
    const fake = await fakeModels();
    if (answer) fake.answer(answer);
    const error = await refusalOf(openaiClient({apiKey: answer ? FAKE_KEYS.openai : 'sk-wrong', baseUrl: fake.endpoints.openai}).call(request({model: 'gpt-5.4-mini'})));
    expect([error.kind, error.message]).toEqual([kind, message]);
  });
});

describe('costMicros', () => {
  test.each<[string, 'anthropic' | 'openai', string, [number, number, number, number], number | null]>([
    // name, provider, model, [input, output, cached, cache writes], micro-dollars
    ['Haiku 5.5: $0.10 in, $0.50 out per million', 'anthropic', 'claude-haiku-5-5', [10_000, 2000, 0, 0], 1000 + 1000],
    ['Haiku 5.5 cache reads at $0.01', 'anthropic', 'claude-haiku-5-5', [10_000, 0, 5000, 0], 500 + 50],
    ['Haiku 5.5 over 100K prompt tokens: 5× everything', 'anthropic', 'claude-haiku-5-5', [200_000, 1000, 0, 0], (20_000 + 500) * 5],
    ['Sonnet 5.5: $2 in, $0.20 cached, $10 out', 'anthropic', 'claude-sonnet-5-5', [3000, 100, 1000, 0], 4000 + 200 + 1000],
    ['Opus 5.5: $4 in, $20 out', 'anthropic', 'claude-opus-5-5', [1000, 100, 0, 0], 4000 + 2000],
    ['Haiku 4.5: $1 in, $5 out per million', 'anthropic', 'claude-haiku-4-5', [1000, 200, 0, 0], 2000],
    ['a dated snapshot prices as its model', 'anthropic', 'claude-haiku-4-5-20251001', [1000, 200, 0, 0], 2000],
    ['cache reads at a tenth, writes at 1.25×', 'anthropic', 'claude-sonnet-4-6', [3000, 100, 1800, 200], 1000 * 3 + 1800 * 0.3 + 200 * 3.75 + 100 * 15],
    ['OpenAI cached input', 'openai', 'gpt-5.4-mini', [2000, 100, 1000, 0], Math.round(1000 * 0.75 + 1000 * 0.075 + 100 * 4.5)],
    ['an OpenAI dated snapshot', 'openai', 'gpt-5.5-2026-04-23', [100, 10, 0, 0], 800],
    ['an unknown model has no cost', 'anthropic', 'claude-future-9', [1000, 200, 0, 0], null],
  ])('%s', (_, provider, model, [inputTokens, outputTokens, cachedTokens, cacheWriteTokens], micros) => {
    expect(costMicros(provider, model, {inputTokens, outputTokens, cachedTokens, cacheWriteTokens})).toBe(micros);
  });
});
