// A fake Anthropic on 127.0.0.1 for the browser checks (server/tests/fakeModels.ts is the full one):
// Anthropic's Messages API answering Alfred's turns with the tool calls a test scripts, so board 07
// can show Alfred answering, and Enter's reading of a search with invented readings of the seed's mail
// (`SEED_READINGS`). Setpoint reaches it through SETPOINT_DEV_AI_URL, which only a dev run accepts;
// with the key set, triage and the history pass ask it too, and are told it's overloaded, so they
// change nothing. No check reaches a real model provider.
import http from 'node:http';
import type {AddressInfo} from 'node:net';

export const FAKE_ANTHROPIC_KEY = 'sk-ant-browser-checks';

/** What Alfred's request carries: the latest question, and every tool result so far (parsed). */
export interface AlfredTurn {
  question: string;
  results: Record<string, unknown>[];
}

export type Call = {name: string; input: Record<string, unknown>};
type Block = {type: string; text?: string; content?: string};

/** How the fake reads a search: the tool's input, `keywords` the whole search unless it says, a late answer, or none. */
export interface FakeReading {
  organisations?: string[];
  types?: string[];
  is_date?: boolean;
  keywords?: string;
  delayMs?: number;
  fails?: boolean;
}

/** Readings of the seed's mail, by the plain words of a search. Any other reads as its words, with no filter. */
export const SEED_READINGS: Record<string, FakeReading> = {
  'northwind rejection march': {organisations: ['Northwind Talent'], types: ['rejection'], keywords: ''},
  'northwind rejection': {organisations: ['Northwind Talent'], types: ['rejection'], keywords: ''},
  'northwind': {organisations: ['Northwind Talent'], keywords: ''},
  'parkside renewal': {organisations: ['Parkside Apartments'], keywords: 'renewal'},
  'renewal': {organisations: ['Parkside Apartments'], keywords: 'renewal'},
  'google': {organisations: ['Google'], keywords: ''},
  'contoso policy': {organisations: ['Contoso Insurance'], keywords: 'policy'},
};

export async function fakeAlfred(answer: (turn: AlfredTurn) => Call, {delayMs = 0, readings = SEED_READINGS}: {delayMs?: number; readings?: Record<string, FakeReading>} = {}) {
  let ids = 0;
  // Every search the model was asked to read, in turn.
  const read: string[] = [];
  const server = http.createServer((request, response) => {
    let raw = '';
    request.on('data', chunk => (raw += chunk));
    request.on('end', () => {
      const send = (status: number, body: unknown) => response.writeHead(status, {'content-type': 'application/json'}).end(JSON.stringify(body));
      if (request.url !== '/v1/messages' || request.headers['x-api-key'] !== FAKE_ANTHROPIC_KEY) {
        return send(401, {type: 'error', error: {type: 'authentication_error', message: 'invalid x-api-key'}});
      }
      const body = JSON.parse(raw) as {model: string; tools?: {name: string}[]; messages: {role: string; content: string | Block[]}[]};
      const blocks = (content: string | Block[]) => (typeof content === 'string' ? [{type: 'text', text: content}] : content);
      const overloaded = () => send(529, {type: 'error', error: {type: 'overloaded_error', message: 'Overloaded'}});
      const called = (call: Call, wait: number) => {
        ids += 1;
        // A slow model, so a check can watch the card while Alfred works, or the field while a reading comes.
        setTimeout(() => send(200, {
          id: `msg_${ids}`, type: 'message', role: 'assistant', model: body.model, stop_reason: 'tool_use', stop_sequence: null,
          content: [{type: 'tool_use', id: `toolu_${ids}`, name: call.name, input: call.input}],
          usage: {input_tokens: 900, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0},
        }), wait);
      };
      if (body.tools?.some(tool => tool.name === 'submit_reading')) {
        const search = /^Search: (.*)$/m.exec(blocks(body.messages[0]!.content).map(block => block.text).join(''))?.[1] ?? '';
        read.push(search);
        const {delayMs: wait = 0, fails = false, ...reading} = readings[search] ?? {};
        if (fails) return overloaded();
        return called({name: 'submit_reading', input: {organisations: [], types: [], is_date: true, keywords: search, ...reading}}, wait);
      }
      if (!body.tools?.some(tool => tool.name === 'answer')) return overloaded();
      const users = body.messages.filter(message => message.role === 'user');
      const question = blocks(users.at(-1)!.content).filter(block => block.type === 'text').map(block => block.text).join('')
        || [...users].reverse().map(message => blocks(message.content).filter(block => block.type === 'text').map(block => block.text).join('')).find(Boolean) || '';
      const results = body.messages.flatMap(message => blocks(message.content).filter(block => block.type === 'tool_result').map(block => JSON.parse(String(block.content)) as Record<string, unknown>));
      called(answer({question, results}), delayMs);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  // A check that fails before it closes the fake (Setpoint didn't start) mustn't keep its spec file
  // running: the socket alone doesn't hold the process open.
  server.unref();
  const {port} = server.address() as AddressInfo;
  return {url: `http://127.0.0.1:${port}`, read, close: () => new Promise<void>(resolve => {
    server.close(() => resolve());
    server.closeAllConnections();
  })};
}

const LEASE = 'When does my lease renewal need to be signed?';

/**
 * Board 07's Alfred, as BRIEF.md › Sample data has it: the lease question searches, reads the
 * renewal terms and answers "By Oct 31, 2026, per Parkside's Sep 30 email."; the follow-up "what's
 * the new rent?" answers from the email the thread read: "$2,140 a month, up from $2,060."
 */
export function leaseAlfred({question, results}: AlfredTurn): Call {
  type Row = {message_id: number; email: string};
  const read = results.find(result => typeof result.email === 'string' && (result.email as string).includes('Sign by: Oct 31, 2026')) as Row | undefined;
  const searched = results.find(result => 'searched' in result) as {results: Row[]} | undefined;
  if (/new rent/i.test(question) && read) {
    return {name: 'answer', input: {found: true, text: '$2,140 a month, up from $2,060.', source_ids: [read.message_id], emphasis: ['$2,140']}};
  }
  if (question.includes(LEASE)) {
    if (read) return {name: 'answer', input: {found: true, text: 'By Oct 31, 2026, per Parkside\'s Sep 30 email.', source_ids: [read.message_id], emphasis: ['Oct 31, 2026']}};
    const lease = searched?.results.find(row => row.email.includes('Subject: Lease renewal terms'));
    if (lease) return {name: 'get_email', input: {message_id: lease.message_id}};
    return {name: 'search_mail', input: {query: 'lease renewal'}};
  }
  if (!searched) return {name: 'search_mail', input: {query: question}};
  return {name: 'answer', input: {found: false, text: '', source_ids: []}};
}

/**
 * Search's checks: any question searches `northwind rejection` and answers with every result as a
 * source, so the sources hold the last-year fixture's Dec 20, 2025.
 */
export function rejectionsAlfred({results}: AlfredTurn): Call {
  const searched = results.find(result => 'searched' in result) as {results: {message_id: number}[]} | undefined;
  if (!searched) return {name: 'search_mail', input: {query: 'northwind rejection'}};
  return {name: 'answer', input: {found: true, text: 'Three Northwind rejections, newest first.', source_ids: searched.results.map(row => row.message_id), emphasis: ['Three Northwind rejections']}};
}

/**
 * Search's checks: a list question searches `the`, reads its first result, and answers in a line with
 * every result as a source, more than the card shows at first.
 */
export function listAlfred({results}: AlfredTurn): Call {
  const searched = results.find(result => 'searched' in result) as {results: {message_id: number}[]} | undefined;
  if (!searched) return {name: 'search_mail', input: {query: 'the'}};
  if (!results.some(result => typeof result.email === 'string')) return {name: 'get_email', input: {message_id: searched.results[0]!.message_id}};
  return {name: 'answer', input: {found: true, text: `${searched.results.length} emails, newest first.`, source_ids: searched.results.map(row => row.message_id), emphasis: []}};
}
