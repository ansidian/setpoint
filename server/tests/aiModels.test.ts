// The model client against the fake Anthropic (tests/fakeModels.ts): request shapes v1 learned
// (forced tool, thinking off, cacheable prefix), usage and the provider's refusals as the retry
// policy's kinds. Plus the ledger's cost table, and what a model saved for OpenAI now reads as.
import {describe, expect, test} from 'vitest';
import {chooseAlfredModel} from '../src/alfred/models.ts';
import {costMicros} from '../src/domain/aiCost.ts';
import {anthropicClient} from '../src/providers/ai/index.ts';
import type {ModelRequest} from '../src/providers/ai/index.ts';
import {ProviderError} from '../src/sync/errors.ts';
import {chooseTriageModels} from '../src/triage/models.ts';
import {FAKE_KEYS, fakeModels} from './fakeModels.ts';

const TOOL = {name: 'submit_email_triage', description: 'Submit one triage decision.', schema: {type: 'object', properties: {lane: {type: 'string'}}, required: ['lane']}};
const request = (changes: Partial<ModelRequest> = {}): ModelRequest => ({
  model: 'claude-haiku-5-5', system: 'Sort one email.', tool: TOOL, input: 'From: Woodgrove Bank <no-reply@woodgrovebank.example>', maxOutputTokens: 1400, ...changes,
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

describe('anthropicClient with web search', () => {
  const SEARCH_TOOL = {name: 'submit_search', description: 'Submit what was found.', schema: {type: 'object', properties: {found: {type: 'string'}}, required: ['found']}};
  // Claude's answer in the web search tool's real shape (the claude-api skill, 2026-10): its query, the
  // results (encrypted, to send back), then the answer's tool; searches billed in server_tool_use.
  const searched = (stop: string, content: unknown[], searches: number) => ({status: 200, body: {
    id: `msg_${stop}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: stop, stop_sequence: null, content,
    usage: {input_tokens: 3000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 0, server_tool_use: {web_search_requests: searches}},
  }});
  const query = [
    {type: 'text', text: 'I\'ll search for it.'},
    {type: 'server_tool_use', id: 'srvtoolu_01', name: 'web_search', input: {query: 'Fabrikam data analyst Atlanta'}},
    {type: 'web_search_tool_result', tool_use_id: 'srvtoolu_01', content: [
      {type: 'web_search_result', url: 'https://fabrikam.example/careers/data-analyst-2291', title: 'Data Analyst | Fabrikam', encrypted_content: 'EqgfCioIARgB', page_age: 'September 29, 2026'},
    ]},
  ];

  test('asks with the web search tool beside the answer\'s, the model choosing, and resumes a paused turn', async () => {
    const fake = await fakeModels();
    let turn = 0;
    fake.answer(() => {
      turn += 1;
      return turn === 1
        ? searched('pause_turn', query, 1)
        : searched('tool_use', [{type: 'text', text: 'Found it.'}, {type: 'tool_use', id: 'toolu_02', name: 'submit_search', input: {found: 'yes'}}], 1);
    });
    const answer = await anthropicClient({apiKey: FAKE_KEYS.anthropic, baseUrl: fake.endpoints.anthropic}).call(request({
      model: 'claude-sonnet-5-5', tool: SEARCH_TOOL, maxOutputTokens: 2000, webSearch: {maxUses: 5},
    }));
    expect(fake.requests[0]!.body).toMatchObject({
      tools: [{type: 'web_search_20260209', name: 'web_search', max_uses: 5}, {name: 'submit_search', input_schema: SEARCH_TOOL.schema}],
      tool_choice: {type: 'auto'}, thinking: {type: 'between_tools'},
      messages: [{role: 'user', content: 'From: Woodgrove Bank <no-reply@woodgrovebank.example>'}],
    });
    // The paused turn goes back exactly as it came, to go on.
    expect(fake.requests[1]!.body.messages).toEqual([{role: 'user', content: 'From: Woodgrove Bank <no-reply@woodgrovebank.example>'}, {role: 'assistant', content: query}]);
    expect(answer).toEqual({
      provider: 'anthropic', model: 'claude-sonnet-5-5', toolInput: {found: 'yes'},
      usage: {inputTokens: 7000, outputTokens: 400, cachedTokens: 1000, cacheWriteTokens: 0, webSearches: 2},
    });
  });

  test('a turn that keeps pausing ends after four resumes, with no answer', async () => {
    const fake = await fakeModels();
    fake.answer(() => searched('pause_turn', query, 1));
    const answer = await anthropicClient({apiKey: FAKE_KEYS.anthropic, baseUrl: fake.endpoints.anthropic}).call(request({
      model: 'claude-sonnet-5-5', tool: SEARCH_TOOL, maxOutputTokens: 2000, webSearch: {maxUses: 5},
    }));
    expect(fake.requests).toHaveLength(5);
    expect(answer.toolInput).toBeNull();
    expect(answer.usage.webSearches).toBe(5);
  });
});

describe('costMicros', () => {
  test.each<[string, string, [number, number, number, number], number | null]>([
    // name, model, [input, output, cached, cache writes], micro-dollars
    ['Haiku 5.5: $0.10 in, $0.50 out per million', 'claude-haiku-5-5', [10_000, 2000, 0, 0], 1000 + 1000],
    ['Haiku 5.5 cache reads at $0.01', 'claude-haiku-5-5', [10_000, 0, 5000, 0], 500 + 50],
    ['Haiku 5.5 over 100K prompt tokens: 5× everything', 'claude-haiku-5-5', [200_000, 1000, 0, 0], (20_000 + 500) * 5],
    ['Sonnet 5.5: $2 in, $0.20 cached, $10 out', 'claude-sonnet-5-5', [3000, 100, 1000, 0], 4000 + 200 + 1000],
    ['Opus 5.5: $4 in, $20 out', 'claude-opus-5-5', [1000, 100, 0, 0], 4000 + 2000],
    ['Haiku 4.5: $1 in, $5 out per million', 'claude-haiku-4-5', [1000, 200, 0, 0], 2000],
    ['a dated snapshot prices as its model', 'claude-haiku-4-5-20251001', [1000, 200, 0, 0], 2000],
    ['cache reads at a tenth, writes at 1.25×', 'claude-sonnet-4-6', [3000, 100, 1800, 200], 1000 * 3 + 1800 * 0.3 + 200 * 3.75 + 100 * 15],
    ['an unknown model has no cost', 'claude-future-9', [1000, 200, 0, 0], null],
  ])('%s', (_, model, [inputTokens, outputTokens, cachedTokens, cacheWriteTokens], micros) => {
    expect(costMicros(model, {inputTokens, outputTokens, cachedTokens, cacheWriteTokens})).toBe(micros);
  });

  test('web searches add $10 per 1,000 to the tokens', () => {
    expect(costMicros('claude-sonnet-5-5', {inputTokens: 3000, outputTokens: 100, cachedTokens: 0, cacheWriteTokens: 0, webSearches: 3})).toBe(6000 + 1000 + 30_000);
  });
});

describe('a model saved while OpenAI was a provider', () => {
  const ai = {triage_model: 'gpt-5.4-mini', triage_strong_model: 'gpt-5.5', history_model: 'o4-mini', alfred_model: 'chatgpt-4o-latest'};

  test('reads as no choice: with the key, Claude\'s defaults', () => {
    const keys = {anthropic: true, openai: false};
    expect(chooseTriageModels(ai, keys)).toEqual({
      cheap: {provider: 'anthropic', model: 'claude-sonnet-5-5'}, strong: {provider: 'anthropic', model: 'claude-opus-5-5'}, history: {provider: 'anthropic', model: 'claude-haiku-5-5'}, missing: null,
    });
    expect(chooseAlfredModel(ai, keys)).toEqual({choice: {provider: 'anthropic', model: 'claude-opus-5-5'}, missing: null});
  });

  test('without the key, nothing to ask, and it asks for Anthropic\'s', () => {
    const keys = {anthropic: false, openai: false};
    expect(chooseTriageModels(ai, keys)).toEqual({cheap: null, strong: null, history: null, missing: 'Triage has no model to ask: add an Anthropic key in Settings › AI.'});
    expect(chooseAlfredModel(ai, keys)).toEqual({choice: null, missing: 'Alfred needs an Anthropic key in Settings › AI.'});
  });
});
