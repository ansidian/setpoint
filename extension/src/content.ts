// Setpoint on job boards' content script (SV-174, SV-202): a chip saying whether Setpoint's Jobs has
// an application to a job on LinkedIn or Indeed, each read by its own readers (boards.ts). In the job
// pane (and on a job's own page) it follows the title and says "Not applied" or why it can't answer
// too; on the list's cards it follows the company, smaller, and only when there's an application, as
// mail's rows show Applied before. The boards draw all of it without loading a page, rebuilding the
// pane for each job and the cards for each page of results, so a MutationObserver places chips
// wherever they're missing, asking Setpoint once for all the postings it hasn't asked about yet. A
// page it should read but can't shows the toolbar's badge (watch.ts).
import {boardOf} from './boards.ts';
import {draw, HOST} from './chip.ts';
import type {Posting, Unread} from './posting.ts';
import type {Asked, CheckReply, Message} from './reply.ts';
import {watch} from './watch.ts';
import {chipFor, todayOf} from './words.ts';
import type {Answer, Place} from './words.ts';

/** A message to the service worker; undefined when it doesn't answer, as after the extension is reloaded. */
function send(message: Message): Promise<unknown> {
  try {
    return chrome.runtime.sendMessage(message).catch(() => undefined);
  } catch {
    // The extension was reloaded or removed under this page.
    return Promise.resolve(undefined);
  }
}

const openOptions = () => void send({type: 'options'});

// The manifest runs this only on the boards' hosts.
const board = boardOf(location.hostname);

// ---- Asking, once per posting while the page is open ----

const keyOf = (posting: Asked) => `${posting.company}\n${posting.title}`;
// Each posting's answer, or why there's none. A failure is forgotten, so it's asked again when the
// posting is next drawn.
const answers = new Map<string, Promise<Answer>>();

/** Each posting's answer, asking Setpoint in one message about those not asked yet. */
function ask(postings: Posting[]): Promise<Answer>[] {
  const fresh = [...new Map(postings.filter(posting => !answers.has(keyOf(posting))).map(({company, title}) => [keyOf({company, title}), {company, title}])).values()];
  if (fresh.length) {
    const reply = send({type: 'check', postings: fresh}) as Promise<CheckReply | undefined>;
    fresh.forEach((posting, index) => {
      const key = keyOf(posting);
      answers.set(key, reply.then((got): Answer => {
        const answer = got?.ok ? got.data.postings[index] : undefined;
        if (got?.ok && answer) return {ok: true, origin: got.origin, enabled: got.data.enabled, posting: answer};
        answers.delete(key);
        return got && !got.ok ? got : {ok: false, reason: 'unreachable', detail: 'reload this page'};
      }));
    });
  }
  return postings.map(posting => answers.get(keyOf(posting)) ?? Promise.resolve({ok: false, reason: 'unreachable'}));
}

// ---- Placing ----

// A card's line with nothing to show (or still asked about): the job it was decided for, so it isn't
// asked about again until the board draws another job there.
const quiet = new WeakMap<Element, string>();

const drawnOn = (line: Element) => line.querySelector<HTMLElement>(`:scope > ${HOST}`);
const placed = (posting: Posting) => drawnOn(posting.line)?.dataset.job === posting.jobId || quiet.get(posting.line) === posting.jobId;

/** Draws a posting's chip now (the pane's "Setpoint…") and again once it's answered. */
function place(posting: Posting, answer: Promise<Answer>, where: Place): void {
  const {line, jobId} = posting;
  drawnOn(line)?.remove();
  const show = (got: Answer | null) => {
    const chip = chipFor(got, posting.company, where, todayOf());
    if (!chip) {
      drawnOn(line)?.remove();
      quiet.set(line, jobId);
      return;
    }
    quiet.delete(line);
    let host = drawnOn(line);
    if (!host) {
      host = document.createElement(HOST);
      line.append(host);
    }
    host.dataset.job = jobId;
    draw(host, chip, where, openOptions);
  };
  show(null);
  void answer.then(got => {
    // The board may have drawn another job on this line meanwhile; that one has its own.
    if (line.isConnected && placed(posting)) show(got);
  });
}

// ---- The badge ----

let unreadSince: number | null = null;
let shown: Unread | null = null;
let again: ReturnType<typeof setTimeout> | undefined;

/** Tells the service worker when the badge changes, and reads again when it may come to show. */
function report(unread: Unread | null): void {
  const next = watch(unreadSince, unread, Date.now());
  unreadSince = next.since;
  clearTimeout(again);
  if (next.again !== null) again = setTimeout(refresh, next.again);
  if (next.badge !== shown) {
    shown = next.badge;
    if (board) void send({type: 'page', board: board.name, unread: shown});
  }
}

function refresh(): void {
  if (!board) return;
  const page = board.readPage(new URL(location.href));
  report(page.unread);
  const postings = [
    ...(page.pane ? [{posting: page.pane, where: 'pane' as const}] : []),
    ...page.cards.map(posting => ({posting, where: 'card' as const})),
  ].filter(({posting}) => !placed(posting));
  if (!postings.length) return;
  const asked = ask(postings.map(({posting}) => posting));
  postings.forEach(({posting, where}, index) => {
    const answer = asked[index];
    if (answer) place(posting, answer, where);
  });
}

let queued = false;
new MutationObserver(() => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    refresh();
  });
}).observe(document.documentElement, {childList: true, subtree: true, characterData: true});
refresh();
