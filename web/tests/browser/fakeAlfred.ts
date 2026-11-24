// A fake Anthropic on 127.0.0.1 for the browser checks (server/tests/fakeModels.ts is the full one).
// It is Anthropic's Messages API, answering Alfred's turns with the tool calls a test scripts, so
// board 07 can show Alfred answering, and help me write's turns with the calls a `writer` scripts. It also answers a suggestion's reading of a search with
// invented readings of the seed's mail (`SEED_READINGS`), and a proposal's prefill with invented
// fields for the seed's mail (`SEED_PREFILLS`). Setpoint reaches it through SETPOINT_DEV_AI_URL, which only a
// dev run accepts. With the key set, triage and the history pass ask it too. The fake tells them
// it's overloaded, so they change nothing. No check reaches a real model provider.
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

/**
 * How the fake reads a search: the tool's input, `keywords` the whole search unless it says, an answer
 * `held` until the check lets it go (`release`), or none.
 */
export interface FakeReading {
  organisations?: string[];
  types?: string[];
  is_date?: boolean;
  keywords?: string;
  held?: boolean;
  fails?: boolean;
}

/**
 * How the fake prefills a proposal: the tool's input (the title the subject unless it says), an
 * answer `held` until the check lets it go (`release`), or none (`fails`).
 */
export interface FakePrefill {
  event?: Record<string, unknown>;
  task?: Record<string, unknown>;
  held?: boolean;
  fails?: boolean;
}

/** Prefills of the seed's mail, by subject. Any other email's is its subject as the title, and nothing else. */
export const SEED_PREFILLS: Record<string, FakePrefill> = {
  'Final exam schedule · CS 101': {
    event: {title: 'CS 101 final exam', date: '2026-12-09', start: '19:00', end: '21:00', place: 'Room 214'},
    task: {title: 'Study for the CS 101 final', due_date: '2026-12-08', due_time: null},
  },
  'Lease renewal terms': {
    event: {title: 'Lease renewal deadline', date: '2026-10-31', start: null, end: null, place: null},
    task: {title: 'Sign the lease renewal', due_date: '2026-10-31', due_time: null},
  },
  'Lab 5 posted': {
    event: {title: 'Lab 5 due', date: '2026-10-07', start: null, end: null, place: null},
    task: {title: 'Finish Lab 5', due_date: '2026-10-07', due_time: null},
  },
  'Your renters policy renewal is coming up': {
    event: {title: 'Renters policy renews', date: '2026-09-15', start: null, end: null, place: null},
    task: {title: 'Check the renters policy renewal', due_date: '2026-09-15', due_time: null},
  },
};

/** Readings of the seed's mail, by the plain words of a search. Any other reads as its words, with no filter. */
export const SEED_READINGS: Record<string, FakeReading> = {
  'northwind rejection march': {organisations: ['Northwind Talent'], types: ['rejection'], keywords: ''},
  'northwind rejection': {organisations: ['Northwind Talent'], types: ['rejection'], keywords: ''},
  'northwind': {organisations: ['Northwind Talent'], keywords: ''},
  'parkside renewal': {organisations: ['Parkside Apartments'], keywords: 'renewal'},
  'renewal': {organisations: ['Parkside Apartments'], keywords: 'renewal'},
  'google': {organisations: ['Google'], keywords: ''},
  'contoso policy': {organisations: ['Contoso Insurance'], keywords: 'policy'},
  'rent': {organisations: ['Parkside Apartments'], keywords: 'rent'},
  'application': {organisations: ['Northwind Talent'], keywords: 'application'},
};

/**
 * The fake, answering Alfred's turns with `answer`. With `held`, each of Alfred's turns waits until
 * the check lets it go, as does a reading marked `held`. So a check reads the card while Alfred
 * works, or the field while a reading comes, for as long as it needs rather than inside a window of
 * time. `release()` lets one go: the one held longest, or, with none held yet, the next to come.
 */
export async function fakeAlfred(answer: (turn: AlfredTurn) => Call, {held = false, readings = SEED_READINGS, prefills = SEED_PREFILLS, prefillDelayMs = 0, writer}: {
  held?: boolean;
  readings?: Record<string, FakeReading>;
  prefills?: Record<string, FakePrefill>;
  // A dev run's pause before each prefill answers, as a model's (checks hold instead).
  prefillDelayMs?: number;
  writer?: (turn: AlfredTurn) => Call;
} = {}) {
  let ids = 0;
  // Every search the model was asked to read, in turn.
  const read: string[] = [];
  // Every email a proposal's prefill was asked about, by subject, in turn.
  const prefilled: string[] = [];
  // Every help-me-write request's opening turn (what the draft reads), in turn.
  const drafts: string[] = [];
  // The answers held, each going when it's let go, and how many were let go before they came.
  const holding: (() => void)[] = [];
  let letGo = 0;
  const release = () => {
    const next = holding.shift();
    if (next) next();
    else letGo += 1;
  };
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
      const called = (call: Call, hold: boolean) => {
        ids += 1;
        const id = ids;
        const go = () => send(200, {
          id: `msg_${id}`, type: 'message', role: 'assistant', model: body.model, stop_reason: 'tool_use', stop_sequence: null,
          content: [{type: 'tool_use', id: `toolu_${id}`, name: call.name, input: call.input}],
          usage: {input_tokens: 900, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0},
        });
        if (!hold) go();
        else if (letGo > 0) {
          letGo -= 1;
          go();
        } else holding.push(go);
      };
      if (body.tools?.some(tool => tool.name === 'submit_reading')) {
        const search = /^Search: (.*)$/m.exec(blocks(body.messages[0]!.content).map(block => block.text).join(''))?.[1] ?? '';
        read.push(search);
        const {held: hold = false, fails = false, ...reading} = readings[search] ?? {};
        if (fails) return overloaded();
        return called({name: 'submit_reading', input: {organisations: [], types: [], is_date: true, keywords: search, ...reading}}, hold);
      }
      const prefillTool = body.tools?.find(tool => tool.name === 'prefill_event' || tool.name === 'prefill_task')?.name;
      if (prefillTool) {
        const subject = /^Subject: (.*)$/m.exec(blocks(body.messages[0]!.content).map(block => block.text).join(''))?.[1] ?? '';
        prefilled.push(subject);
        const event = prefillTool === 'prefill_event';
        const {held: hold = false, fails = false, ...given} = prefills[subject] ?? {};
        const input = (event ? given.event : given.task) ?? (event ? {title: subject, date: null, start: null, end: null, place: null} : {title: subject, due_date: null, due_time: null});
        const answerIt = () => (fails ? overloaded() : called({name: prefillTool, input}, hold));
        if (prefillDelayMs) setTimeout(answerIt, prefillDelayMs);
        else answerIt();
        return;
      }
      if (writer && body.tools?.some(tool => tool.name === 'write_draft')) {
        // Help me write: the question is the opening turn, which carries the email, its history and the ask.
        const opening = blocks(body.messages[0]!.content).map(block => block.text ?? '').join('');
        if (body.messages.length === 1) drafts.push(opening);
        const results = body.messages.flatMap(message => blocks(message.content).filter(block => block.type === 'tool_result').map(block => JSON.parse(String(block.content)) as Record<string, unknown>));
        return called(writer({question: opening, results}), held);
      }
      if (!body.tools?.some(tool => tool.name === 'answer')) return overloaded();
      const users = body.messages.filter(message => message.role === 'user');
      const question = blocks(users.at(-1)!.content).filter(block => block.type === 'text').map(block => block.text).join('')
        || [...users].reverse().map(message => blocks(message.content).filter(block => block.type === 'text').map(block => block.text).join('')).find(Boolean) || '';
      const results = body.messages.flatMap(message => blocks(message.content).filter(block => block.type === 'tool_result').map(block => JSON.parse(String(block.content)) as Record<string, unknown>));
      called(answer({question, results}), held);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  // A check that fails before it closes the fake (Setpoint didn't start) mustn't keep its spec file
  // running. The socket alone doesn't hold the process open.
  server.unref();
  const {port} = server.address() as AddressInfo;
  return {url: `http://127.0.0.1:${port}`, read, drafts, prefilled, release, close: () => new Promise<void>(resolve => {
    server.close(() => resolve());
    server.closeAllConnections();
  })};
}

const LEASE = 'When does my lease renewal need to be signed?';

/**
 * Board 07's Alfred. The lease question searches, reads the renewal terms and answers "By Oct 31,
 * 2026, per Parkside's Sep 30 email.". The follow-up "what's the new rent?" answers from the email
 * the thread read: "$2,140 a month, up from $2,060."
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

export const ADD_QUESTION = 'add dentist Tuesday at 3';
export const MOVE_QUESTION = 'move dentist to Thursday';
export const AMEND_QUESTION = 'remind me 30 min before, weekly, on Classes';

/**
 * The calendar's Alfred, on the seed's week: "add dentist Tuesday at 3" proposes Dentist on Tue Oct
 * 13 at 3 PM from the words alone. "move dentist to Thursday" searches the calendar for the dentist
 * and proposes moving the one it finds to Thu Oct 8. The follow-up "remind me 30 min before, weekly,
 * on Classes" proposes Dentist again with them, saying what changed. Anything else is board 07's.
 */
export function calendarAlfred(turn: AlfredTurn): Call {
  const {question, results} = turn;
  const asked = question.split('The user\'s question: ').at(-1)!.trim();
  const ready = results.some(result => result.ready === true);
  const done = {name: 'answer', input: {found: true, text: 'Ready for you to review.', source_ids: []}};
  if (asked === AMEND_QUESTION) {
    // The thread's second proposal: the first question's result is ready too.
    if (results.filter(result => result.ready === true).length > 1) return {name: 'answer', input: {found: true, text: 'Added a 30 min reminder, made it weekly and moved it to Classes.', source_ids: []}};
    return {name: 'propose_item', input: {owner_instruction: asked, kind: 'event', title: 'Dentist', date: '2026-10-13', start_time: '15:00', reminders: [30], repeat: 'weekly', calendar: 'Classes'}};
  }
  if (asked === ADD_QUESTION) {
    return ready ? done : {name: 'propose_item', input: {owner_instruction: asked, kind: 'event', title: 'Dentist', date: '2026-10-13', start_time: '15:00'}};
  }
  if (asked === MOVE_QUESTION) {
    if (ready) return done;
    const found = results.find(result => 'searched' in result && Array.isArray(result.results)) as {results: {key: string}[]} | undefined;
    if (!found) return {name: 'search_calendar', input: {query: 'dentist'}};
    return {name: 'propose_change', input: {owner_instruction: asked, key: found.results[0]!.key, date: '2026-10-08'}};
  }
  return leaseAlfred(turn);
}

export const KUBERNETES_QUESTION = 'which applications require Kubernetes?';
export const FIX_QUESTION = 'sort out my Needs you';
export const NEEDS_YOU_QUESTION = 'what\'s waiting in Needs you?';
export const WHY_QUESTION = 'why this one?';

type NeedsYouRow = {needs_you_id: number; kind: string; could_be?: {application_id: number; role: string}[]};

/**
 * Jobs' Alfred: "which applications require Kubernetes?" searches the user's applications for
 * kubernetes, the seed's Woodgrove Bank posting naming it, and answers citing each one found. "sort
 * out my Needs you" reads Needs you and proposes two fixes, one call each: the Humongous rejection
 * assigned to the Claims application, and Wide World Importers' email tracked. "what's waiting in
 * Needs you?" reads it and answers with no fix. "why this one?" answers about the fix on screen.
 * Anything else is board 07's.
 */
export function jobsAlfred(turn: AlfredTurn): Call {
  const {question, results} = turn;
  const asked = question.split('The user\'s question: ').at(-1)!.trim();
  const listed = results.find(result => Array.isArray(result.needs_you)) as {needs_you: NeedsYouRow[]} | undefined;
  if (asked === WHY_QUESTION) {
    const fix = /looking at your proposed fix \d+ of \d+, "(.*?)"(, which they applied)?, so/.exec(question)?.[1];
    return {name: 'answer', input: {found: true, text: fix ? `About ${fix}: its email names that role.` : 'Which fix?', source_ids: []}};
  }
  if (asked === FIX_QUESTION) {
    if (!listed) return {name: 'list_needs_you', input: {}};
    const ready = results.filter(result => result.ready === true).length;
    const assign = listed.needs_you.find(item => item.kind === 'update_to_assign')!;
    const track = listed.needs_you.find(item => item.kind === 'email_to_track')!;
    const fixes = [
      {action: 'assign', needs_you_id: assign.needs_you_id, application_id: assign.could_be!.find(row => row.role.includes('Claims'))!.application_id},
      {action: 'track', needs_you_id: track.needs_you_id},
    ];
    if (ready < fixes.length) return {name: 'propose_fix', input: {owner_instruction: asked, ...fixes[ready]}};
    return {name: 'answer', input: {found: true, text: 'Two fixes for Needs you, ready to apply.', source_ids: []}};
  }
  if (asked === NEEDS_YOU_QUESTION) {
    if (!listed) return {name: 'list_needs_you', input: {}};
    return {name: 'answer', input: {found: true, text: `${listed.needs_you.length} things wait in Needs you.`, source_ids: []}};
  }
  if (asked !== KUBERNETES_QUESTION) return leaseAlfred(turn);
  const found = results.find(result => Array.isArray(result.results) && !('searched' in result)) as {results: {application_id: number}[]} | undefined;
  if (!found) return {name: 'search_jobs', input: {query: 'kubernetes'}};
  return {name: 'answer', input: {found: true, text: 'One application lists Kubernetes, Woodgrove Bank\'s.', source_ids: [], application_ids: found.results.map(row => row.application_id)}};
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
