// The model provider over plain HTTPS (bring your own key, BRIEF.md › Settings › AI): Anthropic's
// Messages API, asked to answer through one forced tool. Triage uses it (B3); Alfred uses its
// conversation form at the end (B4). The base URL is configurable so tests point it at a fake on
// 127.0.0.1; no test or dev run reaches a real provider.
//
// Harvested from v1's `triage-model-client` (SV-4): the forced tool, thinking off on Anthropic
// (Sonnet 5 and Opus 5 think by default, which conflicts with a forced tool), the cacheable system
// and tool prefix, a long wedge-breaker timeout, and usage read from every answer. Refusals become
// ProviderErrors for the one retry policy: a refused key (401, 403) needs a new key, 429 waits
// (Retry-After), 529 (Anthropic overloaded), 5xx and timeouts are transient, the rest permanent.
// An answer without a usable tool call isn't an error: `toolInput` is null and triage treats it as
// unsure.
//
// The newest Claude models changed what a request may say (the claude-api skill's model notes,
// 2026-10): Claude Sonnet 5.5, Opus 5.5, Fable 5.1 and Mythos 5.1 refuse a forced `tool_choice` (400),
// so they get `auto` and the system prompt's instruction to answer with the tool; Sonnet 5.5 refuses
// `thinking: disabled` and turns thinking off with `between_tools` instead; Opus 5.5 and the Fable
// and Mythos models can't turn thinking off at all, so it's left out. Haiku 5.5 and older models keep
// v1's forced tool with thinking off.
//
// A call may also allow Claude's web search (Jobs's JD lookup, J3): the server tool goes beside the
// answer's tool, the model chooses when to answer (`auto`), a turn the API pauses (`pause_turn`) is
// sent back to go on, and the searches are counted for the ledger, which prices them.
import type {AiProvider} from '@setpoint/shared';
import {kindOfStatus, ProviderError} from '../../sync/errors.ts';

export interface AiEndpoints {
  anthropic: string;
}

export const AI_ENDPOINTS: AiEndpoints = {anthropic: 'https://api.anthropic.com'};

export interface ToolSpec {
  name: string;
  description: string;
  // JSON Schema for the tool's input.
  schema: Record<string, unknown>;
}

export interface ModelRequest {
  model: string;
  system: string;
  tool: ToolSpec;
  input: string;
  maxOutputTokens: number;
  // Anthropic only: Claude's web search (a server tool) beside the answer's tool, searching at most
  // this many times. The model then chooses when to answer (`auto`), and a turn the API pauses is
  // resumed until it does.
  webSearch?: {maxUses: number};
  signal?: AbortSignal;
}

/** Tokens as billed: `inputTokens` counts every input token, cached reads and cache writes included. */
export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  // Web searches run (billed per search, src/domain/aiCost.ts); only on a call that allowed them.
  webSearches?: number;
}

export interface ModelAnswer {
  provider: AiProvider;
  // The model that answered (a dated snapshot, as the provider names it).
  model: string;
  // The forced tool's input, or null when the answer had no usable tool call.
  toolInput: Record<string, unknown> | null;
  usage: ModelUsage;
}

export interface ModelClient {
  call(request: ModelRequest): Promise<ModelAnswer>;
}

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  // v1's 120 s: models legitimately run long; this breaks a wedged connection, it isn't a budget.
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0);

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/** A refusal in the provider's own words: "Anthropic: Overloaded (529)". */
async function refusal(response: Response): Promise<ProviderError> {
  let message = '';
  try {
    const body = JSON.parse(await response.text()) as {error?: {message?: string} | string};
    message = typeof body.error === 'string' ? body.error : body.error?.message ?? '';
  } catch {
    // Not JSON: the status says it.
  }
  const status = response.status;
  const said = `Anthropic: ${message || response.statusText || 'request refused'} (${status})`;
  if (status === 401 || status === 403) return new ProviderError('auth', `${said}. Check the Anthropic key in Settings › AI.`, {status});
  // Anthropic's "overloaded" status: transient, like a 5xx.
  if (status === 529) return new ProviderError('transient', said, {status, retryAfterMs: retryAfterMs(response)});
  return new ProviderError(kindOfStatus(status), said, {status, retryAfterMs: retryAfterMs(response)});
}

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    return await fetch(url, {
      method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new ProviderError('transient', 'Anthropic didn\'t answer in time.');
    }
    throw new ProviderError('transient', `Anthropic couldn't be reached: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function json(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body)) return body;
  } catch {
    // Below.
  }
  throw new ProviderError('transient', `Anthropic answered with something that isn't its API's JSON (${response.status}).`);
}

const NO_FORCED_TOOL = /^claude-(sonnet-5-5|opus-5-5|fable-5-1|mythos-5-1)\b/;
const THINKING_ALWAYS_ON = /^claude-(opus-5-5|fable-|mythos-)/;

/** How a model is asked to answer through the tool, and with thinking off where it can be. */
export function anthropicToolShape(model: string, tool: string): {tool_choice: Record<string, string>; thinking?: Record<string, string>} {
  const tool_choice: Record<string, string> = NO_FORCED_TOOL.test(model) ? {type: 'auto'} : {type: 'tool', name: tool};
  if (THINKING_ALWAYS_ON.test(model)) return {tool_choice};
  return {tool_choice, thinking: /^claude-sonnet-5-5\b/.test(model) ? {type: 'between_tools'} : {type: 'disabled'}};
}

/** Claude's web search, as the claude-api skill has it (2026-10): the version with dynamic filtering. */
export const WEB_SEARCH_TOOL = 'web_search_20260209';
// A paused turn (stop_reason `pause_turn`, the server's own loop running long) is sent back to go on,
// at most this many times.
const MAX_RESUMES = 4;

/** Anthropic's Messages API with the tool (forced where the model allows), thinking off where it can be, and the system and tool marked cacheable. */
export function anthropicClient({apiKey, baseUrl = AI_ENDPOINTS.anthropic, timeoutMs = DEFAULT_TIMEOUT_MS}: ClientOptions): ModelClient {
  return {
    async call(request) {
      const cache = {type: 'ephemeral'};
      const shape = anthropicToolShape(request.model, request.tool.name);
      const search = request.webSearch;
      const tool = {name: request.tool.name, description: request.tool.description, input_schema: request.tool.schema, cache_control: cache};
      const messages: unknown[] = [{role: 'user', content: request.input}];
      const total = {inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, webSearches: 0};
      for (let turn = 0; ; turn += 1) {
        const response = await post(`${baseUrl}/v1/messages`, {'x-api-key': apiKey, 'anthropic-version': '2023-06-01'}, {
          model: request.model,
          max_tokens: request.maxOutputTokens,
          system: [{type: 'text', text: request.system, cache_control: cache}],
          // With web search the model searches first, so it can't be made to answer at once.
          ...(search
            ? {tools: [{type: WEB_SEARCH_TOOL, name: 'web_search', max_uses: search.maxUses}, tool], tool_choice: {type: 'auto'}, ...(shape.thinking ? {thinking: shape.thinking} : {})}
            : {tools: [tool], ...shape}),
          messages,
        }, timeoutMs, request.signal);
        if (!response.ok) throw await refusal(response);
        const body = await json(response);
        const usage = isRecord(body.usage) ? body.usage : {};
        const cachedTokens = count(usage.cache_read_input_tokens);
        const cacheWriteTokens = count(usage.cache_creation_input_tokens);
        // Anthropic's input_tokens leaves out cache reads and writes; count them all as input.
        total.inputTokens += count(usage.input_tokens) + cachedTokens + cacheWriteTokens;
        total.outputTokens += count(usage.output_tokens);
        total.cachedTokens += cachedTokens;
        total.cacheWriteTokens += cacheWriteTokens;
        total.webSearches += count(isRecord(usage.server_tool_use) ? usage.server_tool_use.web_search_requests : 0);
        const content = Array.isArray(body.content) ? body.content : [];
        if (search && body.stop_reason === 'pause_turn' && turn < MAX_RESUMES) {
          messages.push({role: 'assistant', content});
          continue;
        }
        const block = content.find(item => isRecord(item) && item.type === 'tool_use' && item.name === request.tool.name);
        const {webSearches, ...tokens} = total;
        return {
          provider: 'anthropic',
          model: typeof body.model === 'string' ? body.model : request.model,
          toolInput: isRecord(block) && isRecord(block.input) ? block.input : null,
          usage: search ? {...tokens, webSearches} : tokens,
        };
      }
    },
  };
}

// ---- Conversations with tools (B4: Alfred) ----
//
// Alfred talks with a model over several turns: the model asks for tools, Setpoint runs them and
// sends back their results, until it answers. Same key, endpoint, refusals and usage as
// the one-shot call above; the tool choice is the model's own (`auto`, which every model accepts),
// and thinking is off where the model allows it, as above.
//
// The transcript is the provider's own message list, kept by the caller and only ever appended to:
// each turn's output goes back exactly as it came (thinking blocks included), which the newest
// models require.

export interface ToolCall {
  id: string;
  name: string;
  // Null when the arguments weren't a JSON object.
  input: Record<string, unknown> | null;
}

export interface ToolResult {
  id: string;
  output: string;
  error?: boolean;
}

export interface ConverseRequest {
  model: string;
  system: string;
  tools: ToolSpec[];
  transcript: unknown[];
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface ConverseTurn {
  provider: AiProvider;
  model: string;
  // Why the turn ended: it wants tools run, it's done, it ran out of room, or it declined.
  stop: 'tool_use' | 'end' | 'max_tokens' | 'refusal';
  text: string;
  toolCalls: ToolCall[];
  usage: ModelUsage;
  // The turn as the provider sent it, to append to the transcript.
  assistant: unknown[];
}

export interface ConversationClient {
  converse(request: ConverseRequest): Promise<ConverseTurn>;
  // A user turn: the last turn's tool results (if any), then what the user said.
  userTurn(text: string, results?: ToolResult[]): unknown[];
  // Tool results on their own, to continue after tool calls.
  toolResults(results: ToolResult[]): unknown[];
}

const anthropicResults = (results: ToolResult[]) => results.map(result => ({type: 'tool_result', tool_use_id: result.id, content: result.output, ...(result.error ? {is_error: true} : {})}));

export function anthropicConversation({apiKey, baseUrl = AI_ENDPOINTS.anthropic, timeoutMs = DEFAULT_TIMEOUT_MS}: ClientOptions): ConversationClient {
  return {
    async converse(request) {
      const {thinking} = anthropicToolShape(request.model, '');
      const response = await post(`${baseUrl}/v1/messages`, {'x-api-key': apiKey, 'anthropic-version': '2023-06-01'}, {
        model: request.model,
        max_tokens: request.maxOutputTokens,
        system: [{type: 'text', text: request.system, cache_control: {type: 'ephemeral'}}],
        tools: request.tools.map((tool, index) => ({
          name: tool.name, description: tool.description, input_schema: tool.schema,
          ...(index === request.tools.length - 1 ? {cache_control: {type: 'ephemeral'}} : {}),
        })),
        tool_choice: {type: 'auto'},
        ...(thinking ? {thinking} : {}),
        // The conversation so far is cached too, so each turn reads the last one's prefix.
        cache_control: {type: 'ephemeral'},
        messages: request.transcript,
      }, timeoutMs, request.signal);
      if (!response.ok) throw await refusal(response);
      const body = await json(response);
      const usage = isRecord(body.usage) ? body.usage : {};
      const cachedTokens = count(usage.cache_read_input_tokens);
      const cacheWriteTokens = count(usage.cache_creation_input_tokens);
      const content = Array.isArray(body.content) ? body.content.filter(isRecord) : [];
      const toolCalls = content.filter(block => block.type === 'tool_use').map(block => ({
        id: String(block.id), name: String(block.name), input: isRecord(block.input) ? block.input : null,
      }));
      const stopReason = body.stop_reason;
      return {
        provider: 'anthropic',
        model: typeof body.model === 'string' ? body.model : request.model,
        stop: stopReason === 'refusal' ? 'refusal' : stopReason === 'max_tokens' ? 'max_tokens' : toolCalls.length ? 'tool_use' : 'end',
        text: content.filter(block => block.type === 'text').map(block => String(block.text ?? '')).join(''),
        toolCalls,
        usage: {inputTokens: count(usage.input_tokens) + cachedTokens + cacheWriteTokens, outputTokens: count(usage.output_tokens), cachedTokens, cacheWriteTokens},
        assistant: [{role: 'assistant', content}],
      };
    },
    userTurn: (text, results = []) => [{role: 'user', content: results.length ? [...anthropicResults(results), {type: 'text', text}] : text}],
    toolResults: results => [{role: 'user', content: anthropicResults(results)}],
  };
}
