// A fake Anthropic on 127.0.0.1, answering as its Messages API does (a tool_use block, usage with
// cache reads and writes; 401 authentication_error, 429 rate_limit_error with retry-after, 529
// overloaded_error). Tests answer each request themselves, or make it hang, leave out the tool call,
// or send broken arguments; for a conversation (Alfred) they answer with tool calls, text or a
// refusal, reading the transcript the request carries. No test reaches a real model provider.
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {onTestFinished} from 'vitest';

// `openai` stands for a key stored while OpenAI was a provider, which nothing reads now.
export const FAKE_KEYS = {anthropic: 'sk-ant-fake-key', openai: 'sk-fake-key'} as const;

export interface FakeRequest {
  model: string;
  // The system prompt, and the email as sent.
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
  auth: {type: 'error', error: {type: 'authentication_error', message: 'invalid x-api-key'}},
  rate: {type: 'error', error: {type: 'rate_limit_error', message: 'Number of request tokens has exceeded your per-minute rate limit'}},
  overloaded: {type: 'error', error: {type: 'overloaded_error', message: 'Overloaded'}},
  server: {type: 'error', error: {type: 'api_error', message: 'Internal server error'}},
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
      if (req.url !== '/v1/messages' || req.method !== 'POST') return send(res, 404, {error: {message: `No route ${req.method} ${req.url}`}});
      const body = JSON.parse(raw);
      if (req.headers['x-api-key'] !== FAKE_KEYS.anthropic) return send(res, 401, ERRORS.auth);
      const request: FakeRequest = {model: body.model, headers: req.headers, body, system: body.system?.[0]?.text ?? '', input: body.messages?.[0]?.content ?? ''};
      requests.push(request);
      const answer = handler(request);
      const toolName = body.tools?.[0]?.name;
      if (answer === 'hang') return void hanging.push(res);
      if (answer === 'not_json') return send(res, 200, '<html>Bad gateway</html>', {'content-type': 'text/html'});
      if (answer === 'rate_limited') return send(res, 429, ERRORS.rate, {'retry-after': '20'});
      if (answer === 'overloaded') return send(res, 529, ERRORS.overloaded);
      if (answer === 'server_error') return send(res, 500, ERRORS.server);
      if (typeof answer === 'object' && 'status' in answer) return send(res, answer.status, answer.body ?? {}, answer.headers);
      if (answer === 'refusal' || (typeof answer === 'object' && !('tool' in answer))) {
        ids += 1;
        const turn = answer === 'refusal' ? {calls: [], text: ''} : {calls: 'calls' in answer ? answer.calls : [], text: answer.text ?? '', thinking: 'thinking' in answer && answer.thinking};
        const usage = answer === 'refusal' ? {} : answer.usage ?? {};
        const model = (answer === 'refusal' ? undefined : answer.model) ?? body.model;
        const content = [
          ...(turn.thinking ? [{type: 'thinking', thinking: '', signature: `sig_${ids}`}] : []),
          ...(turn.text ? [{type: 'text', text: turn.text}] : []),
          ...turn.calls.map((call, index) => ({type: 'tool_use', id: `toolu_${ids}_${index}`, name: call.name, input: call.input})),
        ];
        return send(res, 200, {
          id: `msg_${ids}`, type: 'message', role: 'assistant', model, content, stop_sequence: null,
          stop_reason: answer === 'refusal' ? 'refusal' : turn.calls.length ? 'tool_use' : 'end_turn',
          usage: {input_tokens: usage.input ?? 900, output_tokens: usage.output ?? 120, cache_read_input_tokens: usage.cacheRead ?? 0, cache_creation_input_tokens: usage.cacheWrite ?? 0},
        });
      }
      const usage = typeof answer === 'object' ? answer.usage ?? {} : {};
      const model = (typeof answer === 'object' ? answer.model : undefined) ?? body.model;
      ids += 1;
      const content = answer === 'no_tool'
        ? [{type: 'text', text: 'I think this email is an FYI.'}]
        : [{type: 'tool_use', id: `toolu_${ids}`, name: toolName, input: answer === 'broken_arguments' ? 'lane: fyi' : (answer as {tool: unknown}).tool}];
      return send(res, 200, {
        id: `msg_${ids}`, type: 'message', role: 'assistant', model, content, stop_reason: answer === 'no_tool' ? 'end_turn' : 'tool_use', stop_sequence: null,
        usage: {input_tokens: usage.input ?? 900, output_tokens: usage.output ?? 120, cache_read_input_tokens: usage.cacheRead ?? 0, cache_creation_input_tokens: usage.cacheWrite ?? 0},
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
    endpoints: {anthropic: base},
    requests,
    answer(next: Handler) {
      handler = next;
    },
    close,
  };
}
