// A fake Anthropic and OpenAI on 127.0.0.1, answering as their APIs do: Anthropic's Messages API
// (a tool_use block, usage with cache reads and writes; 401 authentication_error, 429
// rate_limit_error with retry-after, 529 overloaded_error) and OpenAI's Responses API (a
// function_call with JSON arguments; 401 invalid_api_key, 429 rate_limit_exceeded, a 400 refusing
// prompt-cache fields). Tests answer each request themselves, or make it hang, leave out the tool
// call, or send broken arguments; for a conversation (Alfred) they answer with tool calls, text or a
// refusal, reading the transcript the request carries. No test reaches a real model provider.
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {onTestFinished} from 'vitest';

export const FAKE_KEYS = {anthropic: 'sk-ant-fake-key', openai: 'sk-fake-key'} as const;

export interface FakeRequest {
  provider: 'anthropic' | 'openai';
  model: string;
  // The system prompt (Anthropic) or instructions (OpenAI), and the email as sent.
  system: string;
  input: string;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  headers: http.IncomingHttpHeaders;
}

type FakeUsage = {input?: number; output?: number; cacheRead?: number; cacheWrite?: number};

export type FakeAnswer =
  | {tool: Record<string, unknown>; usage?: FakeUsage; model?: string}
  // A conversation's turn (Alfred): tool calls by name, with optional text and an Anthropic thinking
  // block (sent back verbatim on the next turn), or text alone to end the turn.
  | {calls: {name: string; input: unknown}[]; text?: string; thinking?: boolean; usage?: FakeUsage; model?: string}
  | {text: string; usage?: FakeUsage; model?: string}
  | 'refusal'
  | {status: number; body?: unknown; headers?: Record<string, string>}
  | 'overloaded' | 'rate_limited' | 'server_error' | 'hang' | 'no_tool' | 'broken_arguments' | 'not_json';

type Handler = (request: FakeRequest) => FakeAnswer;

const ERRORS = {
  anthropic: {
    auth: {type: 'error', error: {type: 'authentication_error', message: 'invalid x-api-key'}},
    rate: {type: 'error', error: {type: 'rate_limit_error', message: 'Number of request tokens has exceeded your per-minute rate limit'}},
    overloaded: {type: 'error', error: {type: 'overloaded_error', message: 'Overloaded'}},
    server: {type: 'error', error: {type: 'api_error', message: 'Internal server error'}},
  },
  openai: {
    auth: {error: {message: 'Incorrect API key provided.', type: 'invalid_request_error', param: null, code: 'invalid_api_key'}},
    rate: {error: {message: 'Rate limit reached for requests', type: 'requests', param: null, code: 'rate_limit_exceeded'}},
    overloaded: {error: {message: 'The engine is currently overloaded, please try again later', type: 'server_error', param: null, code: null}},
    server: {error: {message: 'The server had an error while processing your request.', type: 'server_error', param: null, code: null}},
  },
};

export async function fakeModels() {
  const requests: FakeRequest[] = [];
  const hanging: http.ServerResponse[] = [];
  let handler: Handler = () => ({status: 500, body: {error: {message: 'No answer set in the test'}}});
  let ids = 0;

  const send = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, {'content-type': 'application/json', ...headers});
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => {
      const provider = req.url === '/v1/messages' ? 'anthropic' : req.url === '/v1/responses' ? 'openai' : null;
      if (!provider || req.method !== 'POST') return send(res, 404, {error: {message: `No route ${req.method} ${req.url}`}});
      const body = JSON.parse(raw);
      const key = provider === 'anthropic' ? req.headers['x-api-key'] : req.headers.authorization?.replace(/^Bearer /, '');
      if (key !== FAKE_KEYS[provider]) return send(res, 401, ERRORS[provider].auth);
      if (provider === 'openai' && body.prompt_cache_key && /no-cache/.test(body.model)) {
        return send(res, 400, {error: {message: 'Unsupported parameter: \'prompt_cache_key\' is not supported with this model.', type: 'invalid_request_error', param: 'prompt_cache_key', code: 'unsupported_parameter'}});
      }
      const request: FakeRequest = {
        provider, model: body.model, headers: req.headers, body,
        system: provider === 'anthropic' ? body.system?.[0]?.text ?? '' : body.instructions ?? '',
        input: provider === 'anthropic' ? body.messages?.[0]?.content ?? '' : body.input ?? '',
      };
      requests.push(request);
      const answer = handler(request);
      const toolName = provider === 'anthropic' ? body.tools?.[0]?.name : body.tools?.[0]?.name;
      if (answer === 'hang') return void hanging.push(res);
      if (answer === 'not_json') return send(res, 200, '<html>Bad gateway</html>', {'content-type': 'text/html'});
      if (answer === 'rate_limited') return send(res, 429, ERRORS[provider].rate, {'retry-after': '20'});
      if (answer === 'overloaded') return send(res, provider === 'anthropic' ? 529 : 503, ERRORS[provider].overloaded);
      if (answer === 'server_error') return send(res, 500, ERRORS[provider].server);
      if (typeof answer === 'object' && 'status' in answer) return send(res, answer.status, answer.body ?? {}, answer.headers);
      if (answer === 'refusal' || (typeof answer === 'object' && !('tool' in answer))) {
        ids += 1;
        const turn = answer === 'refusal' ? {calls: [], text: ''} : {calls: 'calls' in answer ? answer.calls : [], text: answer.text ?? '', thinking: 'thinking' in answer && answer.thinking};
        const usage = answer === 'refusal' ? {} : answer.usage ?? {};
        const model = (answer === 'refusal' ? undefined : answer.model) ?? (provider === 'anthropic' ? body.model : `${body.model}-2026-10-01`);
        const input = usage.input ?? 900;
        const output = usage.output ?? 120;
        if (provider === 'anthropic') {
          const content = [
            ...(turn.thinking ? [{type: 'thinking', thinking: '', signature: `sig_${ids}`}] : []),
            ...(turn.text ? [{type: 'text', text: turn.text}] : []),
            ...turn.calls.map((call, index) => ({type: 'tool_use', id: `toolu_${ids}_${index}`, name: call.name, input: call.input})),
          ];
          return send(res, 200, {
            id: `msg_${ids}`, type: 'message', role: 'assistant', model, content, stop_sequence: null,
            stop_reason: answer === 'refusal' ? 'refusal' : turn.calls.length ? 'tool_use' : 'end_turn',
            usage: {input_tokens: input, output_tokens: output, cache_read_input_tokens: usage.cacheRead ?? 0, cache_creation_input_tokens: usage.cacheWrite ?? 0},
          });
        }
        const items = [
          ...(answer === 'refusal' ? [{type: 'message', id: `msg_${ids}`, role: 'assistant', content: [{type: 'refusal', refusal: 'I can\'t help with that.'}]}] : []),
          ...(turn.text ? [{type: 'message', id: `msg_${ids}`, role: 'assistant', content: [{type: 'output_text', text: turn.text}]}] : []),
          ...turn.calls.map((call, index) => ({type: 'function_call', id: `fc_${ids}_${index}`, call_id: `call_${ids}_${index}`, name: call.name, status: 'completed', arguments: JSON.stringify(call.input)})),
        ];
        return send(res, 200, {
          id: `resp_${ids}`, object: 'response', status: 'completed', model, output: items,
          usage: {input_tokens: input + (usage.cacheRead ?? 0), input_tokens_details: {cached_tokens: usage.cacheRead ?? 0}, output_tokens: output, output_tokens_details: {reasoning_tokens: 0}, total_tokens: input + output},
        });
      }
      const usage = typeof answer === 'object' ? answer.usage ?? {} : {};
      const model = (typeof answer === 'object' ? answer.model : undefined) ?? (provider === 'anthropic' ? body.model : `${body.model}-2026-10-01`);
      const input = usage.input ?? 900;
      const output = usage.output ?? 120;
      ids += 1;
      if (provider === 'anthropic') {
        const content = answer === 'no_tool'
          ? [{type: 'text', text: 'I think this email is an FYI.'}]
          : [{type: 'tool_use', id: `toolu_${ids}`, name: toolName, input: answer === 'broken_arguments' ? 'lane: fyi' : (answer as {tool: unknown}).tool}];
        return send(res, 200, {
          id: `msg_${ids}`, type: 'message', role: 'assistant', model, content, stop_reason: answer === 'no_tool' ? 'end_turn' : 'tool_use', stop_sequence: null,
          usage: {input_tokens: input, output_tokens: output, cache_read_input_tokens: usage.cacheRead ?? 0, cache_creation_input_tokens: usage.cacheWrite ?? 0},
        });
      }
      const output_ = answer === 'no_tool'
        ? [{type: 'message', id: `msg_${ids}`, role: 'assistant', content: [{type: 'output_text', text: 'I think this email is an FYI.'}]}]
        : [{type: 'function_call', id: `fc_${ids}`, call_id: `call_${ids}`, name: toolName, status: 'completed',
          arguments: answer === 'broken_arguments' ? '{"lane": "fyi",' : JSON.stringify((answer as {tool: unknown}).tool)}];
      return send(res, 200, {
        id: `resp_${ids}`, object: 'response', status: 'completed', model, output: output_,
        usage: {input_tokens: input + (usage.cacheRead ?? 0), input_tokens_details: {cached_tokens: usage.cacheRead ?? 0}, output_tokens: output, output_tokens_details: {reasoning_tokens: 0}, total_tokens: input + output},
      });
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = () => new Promise<void>(resolve => {
    for (const res of hanging.splice(0)) res.destroy();
    server.closeAllConnections();
    server.close(() => resolve());
  });
  onTestFinished(close);
  return {
    endpoints: {anthropic: base, openai: base},
    requests,
    answer(next: Handler) {
      handler = next;
    },
    close,
  };
}
