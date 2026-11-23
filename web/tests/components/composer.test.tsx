// The composer in the reading pane: its recipients as chips (a comma, Enter or leaving makes an
// address one; Backspace takes the last back; a paste of several makes each one), suggestions while
// typing, Cc and Bcc on ⌘⇧B, the reply's quote folded behind "…" and trimmed in place, a forward's
// email in full with its attachments to take off, the user's own files (attached by the button, a
// drop or a paste, chips after a forward's originals, refused past 25 MB, waited for by Send, taken
// back by Discard's Undo and carried by the reply-type menu), a failed send's words with Try again, the draft saved as it's typed, once after a pause or at once on
// Esc, and the reply-type menu, its kinds and Edit subject. Popped out into a window and docked
// back, it is one composer: what's typed, a recipient, the open fold and the caret carry across, and
// the window's title folds it. The window's × docks a reply over its own email and closes it
// anywhere else, as Esc does. The store's rules around windows: Undo brings a send back where it
// was, an email shown opens no second composer for a draft in a window, docking saves the pane's
// one as it gives way, a draft's row docks its window, a docked new message gives the pane to an
// email shown, and windows that don't fit fold and hide by when each was touched.
// The server is faked at `fetch`: each test answers what the composer asks and reads what it
// saved. Send's toast and Undo, and a window over other pages, are the browser journeys'
// (browser/composer.spec.ts).
import type {AccountOut, DraftFileOut, DraftOut, DraftRowOut, FromOut, MessageOut, Recipient} from '@setpoint/shared';
import {SEED_NOW} from '@setpoint/shared';
import {afterEach, expect, onTestFinished, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {clearCache, setCached} from '../../src/api/client.ts';
import {FROM_PATH} from '../../src/api/drafts.ts';
import {messagePath} from '../../src/api/mail.ts';
import {ComposerRoot, ComposerSlot, ComposerWindows} from '../../src/app/compose/Composer.tsx';
import {ToastPill} from '../../src/app/ToastPill.tsx';
import {dismissToast} from '../../src/app/toast.ts';
import {navigate} from '../../src/app/router.ts';
import {composerHost} from '../../src/app/compose/place.ts';
import {closeComposerAt, dock, DRAFT_SAVE_MS, newMessage, openComposers, openDraft, showEmail, startComposer, useComposers, useOpenComposer} from '../../src/app/compose/composer.ts';

const SAM: Recipient = {name: 'Sam Lee', address: 'sam.lee@example.com'};
const JUNE: Recipient = {name: 'June Park', address: 'june.park@example.org'};
const RAVI: Recipient = {name: 'Ravi Menon', address: 'ravi.menon@example.org'};
const THEO: Recipient = {name: 'Theo Walsh', address: 'theo.walsh@example.org'};
const EMAIL = 21;

const FROM: FromOut = {accounts: [{account_id: 2, addresses: [{address: 'user@example.com', name: null, primary: true}]}], default_account_id: 2};
const ACCOUNTS = [{id: 2, label: 'Personal', colour: 'cool', address: 'user@example.com', provider: 'gmail', position: 0} as AccountOut];
const MESSAGE = {
  id: EMAIL, account_id: 2, from_name: 'Sam Lee', from_address: SAM.address, subject: 'Dinner Friday?', received_at: '2026-10-05T19:40:00Z',
  body_text: 'Hey! Dinner Friday? Blue Door at 7?\n\nSam', body_html: null, to: [{name: 'User', address: 'user@example.com'}, JUNE], cc: [RAVI],
  attachments: [], remote_content: {domain: 'example.com', trust_domain: 'example.com', sender_authenticated: true, trusted: false, load: false, reason: 'not_trusted'},
} as unknown as MessageOut;

let nextId = 1;
const draftOf = (fields: Partial<DraftOut>): DraftOut => ({
  id: nextId++, kind: 'reply', message_id: EMAIL, from: {account_id: 2, address: 'user@example.com'}, to: [SAM], cc: [], bcc: [],
  subject: 'Re: Dinner Friday?', body: [], quote: null, removed_attachments: [], files: [], write: null, created_at: SEED_NOW, updated_at: SEED_NOW, send: null, ...fields,
});

/**
 * The server, faked at fetch: the draft to start (and `others`, started by their kind), From, the
 * accounts, the email, people for any query, and the saves it got. `failSaves` refuses that many
 * saves next (they're still in `saves`, not in `landed`), `sends` counts Send and `discarded` the
 * drafts deleted.
 */
function server(draft: DraftOut, people: Recipient[] = [], message: MessageOut = MESSAGE, others: DraftOut[] = []) {
  const saves: Record<string, unknown>[] = [];
  const landed: Record<string, unknown>[] = [];
  const asked: string[] = [];
  const discarded: number[] = [];
  const started = new Set<number>();
  // `holdStart` keeps the answers to starting a draft until `releaseStart` (all of them) or
  // `releaseNextStart` (the oldest), as a slow server would; `refuseStart` refuses those let go.
  // `startsAnswered` counts the answers given.
  let holding = false;
  const heldStarts: (() => void)[] = [];
  const fake = Object.assign(fileRoutes(id => [draft, ...others].find(one => one.id === id)), {
    saves, landed, asked, discarded, failSaves: 0, sends: 0, refuseStart: false, startsAnswered: 0,
    holdStart() {
      holding = true;
    },
    releaseStart() {
      holding = false;
      for (const open of heldStarts.splice(0)) open();
    },
    releaseNextStart() {
      heldStarts.shift()?.();
    },
  });
  const answer = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}}));
  vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
    const url = new URL(String(input), location.href);
    const method = init?.method ?? 'GET';
    const files = fake.answerFiles(url, method, init, answer);
    if (files) return files;
    const other = others.find(one => url.pathname === `/api/mail/drafts/${one.id}`);
    if (url.pathname === '/api/mail/drafts' && method === 'POST') {
      // The draft, or the next of `others` of the kind asked for, each started once.
      const kind = (JSON.parse(String(init?.body)) as {kind: string}).kind;
      const next = kind === draft.kind ? undefined : others.find(one => one.kind === kind && !started.has(one.id));
      if (next) started.add(next.id);
      const reply = () => {
        fake.startsAnswered += 1;
        return fake.refuseStart ? answer({error: {code: 'unavailable', message: 'Setpoint is restarting.'}}, 503) : answer(next ?? draft, 201);
      };
      return holding ? new Promise<void>(open => heldStarts.push(open)).then(reply) : reply();
    }
    if (other && method === 'GET') return answer(other);
    if (other && method === 'DELETE') {
      discarded.push(other.id);
      other.files = [];
      return Promise.resolve(new Response(null, {status: 204}));
    }
    if (other && method === 'PATCH') {
      saves.push({draft: other.id, ...JSON.parse(String(init?.body)) as Record<string, unknown>});
      return answer({id: other.id, updated_at: SEED_NOW});
    }
    if (url.pathname === `/api/mail/drafts/${draft.id}` && method === 'DELETE') {
      discarded.push(draft.id);
      // Its files are released, for Undo to take.
      draft.files = [];
      return Promise.resolve(new Response(null, {status: 204}));
    }
    if (url.pathname === `/api/mail/drafts/${draft.id}` && method === 'GET') return answer(draft);
    if (url.pathname === `/api/mail/drafts/${draft.id}` && method === 'PATCH') {
      const saved = JSON.parse(String(init?.body)) as Record<string, unknown>;
      saves.push(saved);
      if (fake.failSaves > 0) {
        fake.failSaves -= 1;
        return answer({error: {code: 'unavailable', message: 'Setpoint is restarting.'}}, 503);
      }
      landed.push(saved);
      return answer({id: draft.id, updated_at: SEED_NOW});
    }
    if (url.pathname === `/api/mail/drafts/${draft.id}/send` && method === 'POST') {
      fake.sends += 1;
      return answer({...draft, send: {state: 'held', send_at: SEED_NOW, error: null}});
    }
    if (url.pathname === `/api/mail/drafts/${draft.id}/undo` && method === 'POST') return answer({...draft, send: null});
    if (url.pathname === '/api/mail/from') return answer(FROM);
    if (url.pathname === '/api/accounts') return answer(ACCOUNTS);
    if (url.pathname === `/api/mail/messages/${EMAIL}`) return answer(message);
    if (url.pathname === '/api/mail/drafts') return answer({drafts: [], count: 0});
    if (url.pathname === '/api/mail/people') {
      asked.push(url.searchParams.get('q') ?? '');
      return answer({people});
    }
    return answer({error: {code: 'not_found', message: 'No such thing.'}}, 404);
  });
  return fake;
}

/**
 * The draft files' routes, faked: an upload is answered as the server would (`hold` keeps the
 * answers until `release`, `failUploads` refuses that many), a removal (`failRemoves` refuses that
 * many) and a take are recorded, and
 * `refuseTakes` answers a take as over the limit. Any file uploaded, or on a draft, can be taken. The
 * drafts' own files change with each, as the server's do.
 */
function fileRoutes(draftOf: (id: number) => DraftOut | undefined) {
  let nextFile = 100;
  let gate: {promise: Promise<void>; open: () => void} | null = null;
  const known = new Map<number, DraftFileOut>();
  const routes = {
    uploads: [] as {draft: number; name: string; type: string; size: number}[],
    removed: [] as {draft: number; id: number}[],
    takes: [] as {draft: number; ids: number[]}[],
    failUploads: 0,
    failRemoves: 0,
    refuseTakes: false,
    known,
    hold() {
      let open = () => {};
      gate = {promise: new Promise<void>(resolve => (open = resolve)), open};
    },
    release() {
      gate?.open();
      gate = null;
    },
    answerFiles(url: URL, method: string, init: RequestInit | undefined, answer: (body: unknown, status?: number) => Promise<Response>): Promise<Response> | null {
      const match = /^\/api\/mail\/drafts\/(\d+)\/files(?:\/(\d+|take))?$/.exec(url.pathname);
      if (!match) return null;
      const draft = Number(match[1]);
      const row = draftOf(draft);
      if (!match[2] && method === 'POST') {
        const body = init?.body as Blob;
        routes.uploads.push({draft, name: url.searchParams.get('name') ?? '', type: body.type, size: body.size});
        const waiting = gate?.promise ?? Promise.resolve();
        return waiting.then(() => {
          if (routes.failUploads > 0) {
            routes.failUploads -= 1;
            return answer({error: {code: 'unavailable', message: 'Setpoint is restarting.'}}, 503);
          }
          const file: DraftFileOut = {id: nextFile++, filename: url.searchParams.get('name') ?? '', mime_type: body.type, size_bytes: body.size};
          known.set(file.id, file);
          if (row) row.files = [...row.files, file];
          return answer(file, 201);
        });
      }
      if (match[2] === 'take' && method === 'POST') {
        const {ids} = JSON.parse(String(init?.body)) as {ids: number[]};
        routes.takes.push({draft, ids});
        if (routes.refuseTakes) return answer({error: {code: 'too_large', message: 'Attachments can total 25 MB, and these would be 26 MB.'}}, 413);
        for (const file of [draftOf(draft)?.files ?? []].flat()) known.set(file.id, file);
        const taken = ids.flatMap(id => (known.has(id) ? [known.get(id)!] : []));
        if (row) row.files = [...row.files.filter(file => !ids.includes(file.id)), ...taken];
        return answer({files: row?.files ?? taken});
      }
      if (match[2] && method === 'DELETE') {
        routes.removed.push({draft, id: Number(match[2])});
        if (routes.failRemoves > 0) {
          routes.failRemoves -= 1;
          return answer({error: {code: 'unavailable', message: 'Setpoint is restarting.'}}, 503);
        }
        if (row) row.files = row.files.filter(file => file.id !== Number(match[2]));
        return Promise.resolve(new Response(null, {status: 204}));
      }
      return null;
    },
  };
  return routes;
}

/** The reading pane on the email, the windows' row beside it, and the composers mounted once, as the app has them. */
function Pane() {
  const open = useOpenComposer();
  useComposers();
  return (
    <div style={{position: 'relative', height: 760, width: 1300, display: 'flex'}}>
      <div className="pane" style={{height: 700, width: 680}}><ComposerSlot open={open} messageId={EMAIL} /></div>
      <ComposerWindows />
      <ComposerRoot />
      <ToastPill />
    </div>
  );
}

/** Starts the draft as R, A or F does, and waits for the composer to have it. */
async function compose(draft: DraftOut, people: Recipient[] = [], message = MESSAGE, others: DraftOut[] = []) {
  const fake = server(draft, people, message, others);
  await render(<Pane />);
  startComposer({kind: draft.kind as 'reply', message_id: EMAIL});
  await expect.poll(() => openComposers().map(one => one.draftId)).toEqual([draft.id]);
  await expect.element(page.getByRole('textbox', {name: 'Message'})).toBeVisible();
  return fake;
}

const chips = (field: string) => [...document.querySelectorAll(`.composer .cmp-row:has(input[aria-label="${field}"]) .cmp-chip`)].map(chip => chip.firstChild?.textContent);
const field = (name: string) => page.getByRole('textbox', {name, exact: true});

/**
 * Holds the save's timer, so a check never waits out DRAFT_SAVE_MS on the real clock, nor saves
 * half of what's typed when a letter comes late. `saveNow` is the moment after the last change.
 */
const holdSaves = () => vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
const saveNow = () => vi.advanceTimersByTime(DRAFT_SAVE_MS);

afterEach(() => {
  vi.useRealTimers();
  for (const one of openComposers()) closeComposerAt(one.key);
  dismissToast();
  clearCache();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

test('Reply all opens with its people as chips, Cc and Bcc shown because it has Cc, and the caret in the body', async () => {
  await compose(draftOf({kind: 'reply_all', to: [SAM, JUNE], cc: [RAVI]}));
  expect(chips('To')).toEqual(['Sam Lee', 'June Park']);
  expect(chips('Cc')).toEqual(['Ravi Menon']);
  await expect.element(field('Bcc')).toBeVisible();
  // A reply's subject is the server's: no field for it.
  expect(document.querySelector('.composer input[aria-label="Subject"]')).toBeNull();
  await expect.element(page.getByRole('button', {name: /Personal/})).toHaveTextContent('Personaluser@example.com');
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Message');
});

test('in To, a comma or Enter makes an address a chip, Backspace takes the last back, and a paste of several makes each one', async () => {
  const {saves} = await compose(draftOf({to: []}));
  // With no one to send to, the caret starts in To.
  expect(document.activeElement?.getAttribute('aria-label')).toBe('To');
  await userEvent.keyboard('june.park@example.org,');
  await userEvent.keyboard('Ravi Menon <ravi.menon@example.org>{Enter}');
  expect(chips('To')).toEqual(['june.park@example.org', 'Ravi Menon']);
  await userEvent.keyboard('{Backspace}');
  expect(chips('To')).toEqual(['june.park@example.org']);
  await userEvent.click(field('To'));
  const pasted = new DataTransfer();
  pasted.setData('text/plain', 'Sam Lee <sam.lee@example.com>; theo.walsh@example.org, not one');
  document.querySelector('.composer input[aria-label="To"]')!.dispatchEvent(new ClipboardEvent('paste', {clipboardData: pasted, bubbles: true, cancelable: true}));
  await expect.poll(() => chips('To')).toEqual(['june.park@example.org', 'Sam Lee', 'theo.walsh@example.org']);
  await expect.element(field('To')).toHaveValue('not one');
  // Words that aren't an address stay as typed, marked, once the caret leaves.
  await userEvent.click(page.getByRole('textbox', {name: 'Message'}));
  await expect.element(field('To')).toHaveClass('invalid');
  await expect.poll(() => saves.at(-1)?.to).toEqual([{name: null, address: 'june.park@example.org'}, SAM, {name: null, address: 'theo.walsh@example.org'}]);
});

test('typing asks for people from the user\'s mail; ↓ and Enter pick one, and one already there isn\'t offered', async () => {
  const {asked} = await compose(draftOf({to: [SAM]}), [SAM, THEO, JUNE]);
  await userEvent.click(field('To'));
  await userEvent.keyboard('t');
  const offered = page.getByRole('listbox', {name: 'Suggestions'});
  await expect.element(offered).toBeVisible();
  expect(asked.at(-1)).toBe('t');
  expect([...document.querySelectorAll('.cmp-people [role="option"]')].map(option => option.textContent)).toEqual(['Theo Walshtheo.walsh@example.org', 'June Parkjune.park@example.org']);
  await userEvent.keyboard('{ArrowDown}{Enter}');
  expect(chips('To')).toEqual(['Sam Lee', 'June Park']);
  await expect.element(field('To')).toHaveValue('');
});

test('⌘⇧B shows Cc and Bcc on a reply without them; left empty, they stay when the caret leaves, and ⌘⇧B hides them again', async () => {
  await compose(draftOf({}));
  expect(document.querySelector('.composer input[aria-label="Cc"]')).toBeNull();
  await userEvent.keyboard('{Meta>}{Shift>}b{/Shift}{/Meta}');
  await expect.element(field('Cc')).toHaveFocus();
  await expect.element(field('Bcc')).toBeVisible();
  await userEvent.click(page.getByRole('textbox', {name: 'Message'}));
  await expect.element(page.getByRole('textbox', {name: 'Message'})).toHaveFocus();
  await expect.element(field('Cc')).toBeVisible();
  await expect.element(field('Bcc')).toBeVisible();
  await userEvent.keyboard('{Meta>}{Shift>}b{/Shift}{/Meta}');
  await expect.poll(() => document.querySelector('.composer input[aria-label="Cc"]')).toBeNull();
  // The button does it too, and a Cc kept keeps them.
  await userEvent.click(page.getByRole('button', {name: 'Cc Bcc'}));
  await expect.element(field('Cc')).toHaveFocus();
  await userEvent.keyboard('june.park@example.org,');
  await userEvent.click(page.getByRole('textbox', {name: 'Message'}));
  expect(chips('Cc')).toEqual(['june.park@example.org']);
  await expect.element(field('Bcc')).toBeVisible();
});

test('⌘⇧B from an empty Cc hides the rows with the caret in To; with words typed in Cc, it keeps them', async () => {
  await compose(draftOf({}));
  await userEvent.keyboard('{Meta>}{Shift>}b{/Shift}{/Meta}');
  await expect.element(field('Cc')).toHaveFocus();
  await userEvent.keyboard('{Meta>}{Shift>}b{/Shift}{/Meta}');
  await expect.poll(() => document.querySelector('.composer input[aria-label="Cc"]')).toBeNull();
  await expect.element(field('To')).toHaveFocus();
  await userEvent.keyboard('{Meta>}{Shift>}b{/Shift}{/Meta}');
  await expect.element(field('Cc')).toHaveFocus();
  await userEvent.keyboard('june');
  await userEvent.keyboard('{Meta>}{Shift>}b{/Shift}{/Meta}');
  await expect.element(field('Cc')).toHaveFocus();
  await expect.element(field('Cc')).toHaveValue('june');
});

test('Tab from To goes to Subject, past the Cc Bcc button', async () => {
  await compose(draftOf({kind: 'new', message_id: null, to: [], subject: ''}));
  await expect.element(field('To')).toHaveFocus();
  await userEvent.keyboard('{Tab}');
  await expect.element(field('Subject')).toHaveFocus();
});

test('with Cc and Bcc showing, Tab from To goes through them to Subject', async () => {
  await compose(draftOf({kind: 'new', message_id: null, to: [], cc: [RAVI], subject: ''}));
  await userEvent.click(field('To'));
  await userEvent.keyboard('{Tab}');
  await expect.element(field('Cc')).toHaveFocus();
  await userEvent.keyboard('{Tab}');
  await expect.element(field('Bcc')).toHaveFocus();
  await userEvent.keyboard('{Tab}');
  await expect.element(field('Subject')).toHaveFocus();
});

test('the quote folds behind "…"; opened, it shows its line and the email, and a trim is saved as the quote', async () => {
  const {saves} = await compose(draftOf({}));
  holdSaves();
  expect(document.querySelector('.cmp-quote-text')).toBeNull();
  await userEvent.click(page.getByRole('button', {name: 'Show the quoted email'}));
  await expect.element(page.getByText('On Oct 5, 2026, Sam Lee wrote:')).toBeVisible();
  const quote = page.getByRole('textbox', {name: 'Quoted email'});
  await expect.element(quote).toHaveTextContent('Hey! Dinner Friday? Blue Door at 7?Sam');
  // Trimmed to its last paragraph.
  const element = document.querySelector<HTMLElement>('.cmp-quote-text')!;
  element.firstElementChild!.remove();
  element.dispatchEvent(new InputEvent('input', {bubbles: true}));
  saveNow();
  await expect.poll(() => saves.at(-1)?.quote).toEqual([{type: 'paragraph', runs: [{text: 'Sam', marks: [], href: null}]}]);
  await userEvent.click(page.getByRole('button', {name: 'Hide the quoted email'}));
  expect(document.querySelector('.cmp-quote-text')).toBeNull();
});

test('the draft saves once a moment after the last letter, with the text as it then is; Esc closes it and saves at once', async () => {
  const {saves} = await compose(draftOf({}));
  holdSaves();
  await userEvent.keyboard('Count me in');
  // Not before the moment is up.
  vi.advanceTimersByTime(DRAFT_SAVE_MS - 1);
  expect(saves).toEqual([]);
  vi.advanceTimersByTime(1);
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0]).toEqual({body: [{type: 'paragraph', runs: [{text: 'Count me in', marks: [], href: null}]}]});
  await userEvent.keyboard('.');
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('.composer')).toBeNull();
  await expect.poll(() => saves.length).toBe(2);
  expect(saves[1]).toEqual({body: [{type: 'paragraph', runs: [{text: 'Count me in.', marks: [], href: null}]}]});
});

test('a send the provider refused shows its words with Try again', async () => {
  await compose(draftOf({to: [{name: null, address: 'nobody@refused.example'}], send: {state: 'failed', send_at: null, error: '550 5.1.1 Recipient address rejected'}}));
  await expect.element(page.getByText('550 5.1.1 Recipient address rejected')).toBeVisible();
  await expect.element(page.getByRole('button', {name: 'Try again'})).toBeVisible();
});

test('a forward shows its email in full: its header lines, its attachments as chips that × takes off, and its words', async () => {
  const message = {...MESSAGE, attachments: [
    {id: 31, filename: 'Menu.pdf', mime_type: 'application/pdf', size_bytes: 184 * 1024, previewable: true},
    {id: 32, filename: 'Map.png', mime_type: 'image/png', size_bytes: 12 * 1024, previewable: true},
  ]} as MessageOut;
  const {saves} = await compose(draftOf({kind: 'forward', to: [], subject: 'Fwd: Dinner Friday?'}), [], message);
  holdSaves();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('To');
  await expect.element(page.getByText('---------- Forwarded message ---------')).toBeVisible();
  await expect.element(page.getByText('From: Sam Lee <sam.lee@example.com>')).toBeVisible();
  expect(document.querySelector('.cmp-forward .mailtext')?.textContent).toBe('Hey! Dinner Friday? Blue Door at 7?Sam');
  expect([...document.querySelectorAll('.cmp-file')].map(file => file.textContent)).toEqual(['Menu.pdf184 KB', 'Map.png12 KB']);
  // Nothing folds it.
  expect(document.querySelector('.cmp-fold')).toBeNull();
  await userEvent.click(page.getByRole('button', {name: 'Remove Map.png'}));
  expect([...document.querySelectorAll('.cmp-file')].map(file => file.textContent)).toEqual(['Menu.pdf184 KB']);
  saveNow();
  await expect.poll(() => saves.at(-1)?.removed_attachments).toEqual([32]);
});

test('a change whose save failed stays owed: it goes out again with the next save, the failure said until it lands', async () => {
  const fake = await compose(draftOf({kind: 'reply_all', to: [SAM, JUNE]}));
  fake.failSaves = 1;
  holdSaves();
  await userEvent.click(page.getByRole('button', {name: 'Remove June Park'}));
  saveNow();
  await expect.element(page.getByText(/^Failed to save the draft, Setpoint is restarting/)).toBeVisible();
  expect(fake.landed).toEqual([]);
  // The next save carries it, under what was typed since.
  await userEvent.click(page.getByRole('textbox', {name: 'Message'}));
  await userEvent.keyboard('Hi');
  saveNow();
  await expect.poll(() => fake.landed.length).toBe(1);
  expect(fake.landed[0]).toEqual({to: [SAM], body: [{type: 'paragraph', runs: [{text: 'Hi', marks: [], href: null}]}]});
  await expect.poll(() => document.querySelector('.composer .cmp-failed')).toBeNull();
});

test('Send never sends while a change is owed and its save fails again: the composer stays with the failure', async () => {
  const fake = await compose(draftOf({kind: 'reply_all', to: [SAM, JUNE]}));
  fake.failSaves = 2;
  holdSaves();
  await userEvent.click(page.getByRole('button', {name: 'Remove June Park'}));
  saveNow();
  await expect.element(page.getByText(/^Failed to save the draft/)).toBeVisible();
  await userEvent.click(page.getByRole('textbox', {name: 'Message'}));
  await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
  // Its second try was refused too: nothing was sent, and the composer is back with what the user had.
  await expect.poll(() => fake.saves.length).toBe(2);
  await expect.element(page.getByRole('textbox', {name: 'Message'})).toBeVisible();
  expect(fake.sends).toBe(0);
  expect(chips('To')).toEqual(['Sam Lee']);
  expect(fake.saves[1]).toEqual({to: [SAM]});
});

const inWindow = () => document.querySelector('.cmp-window .composer');
const inPane = () => document.querySelector('.pane .composer');

/** The reader shows `open` on the Inbox (none: the list alone), the address as it was again after the test. */
function reading(open: number | null) {
  const was = `${window.location.pathname}${window.location.search}`;
  onTestFinished(() => window.history.replaceState(null, '', was));
  navigate({page: 'inbox', open});
}

test('popped out and docked again, it is one composer: what\'s typed, a recipient, the open fold and the caret carry across', async () => {
  await compose(draftOf({}));
  await userEvent.keyboard('Count me in');
  await userEvent.click(page.getByRole('button', {name: 'Cc Bcc'}));
  await userEvent.keyboard('june.park@example.org,');
  await userEvent.click(page.getByRole('button', {name: 'Show the quoted email'}));
  await userEvent.click(page.getByRole('textbox', {name: 'Message'}));
  await userEvent.keyboard('{End}');

  await userEvent.click(page.getByRole('button', {name: 'Pop out'}));
  await expect.poll(inWindow).not.toBeNull();
  expect(inPane()).toBeNull();
  const kept = () => [
    document.querySelector('.composer .desc-edit')?.textContent,
    chips('Cc'),
    document.querySelector('.cmp-quote-text')?.textContent,
    document.activeElement?.getAttribute('aria-label'),
  ];
  const before = ['Count me in', ['june.park@example.org'], 'Hey! Dinner Friday? Blue Door at 7?Sam', 'Message'];
  expect(kept()).toEqual(before);
  expect(document.querySelector('.cmp-window .cmp-title-text')?.textContent).toBe('Re: Dinner Friday?');
  // The caret stays where it was: typing goes on at the end.
  await userEvent.keyboard('.');

  // Over its own email, the window's × puts it back under it.
  reading(EMAIL);
  await userEvent.click(page.getByRole('button', {name: 'Back in the reading pane'}));
  await expect.poll(inPane).not.toBeNull();
  expect(inWindow()).toBeNull();
  expect(kept()).toEqual(['Count me in.', ...before.slice(1)]);
});

test('the window\'s title folds it to its bar and brings it back; Esc in the window closes it, the draft saved', async () => {
  const {saves} = await compose(draftOf({}));
  await userEvent.keyboard('Count me in');
  await userEvent.click(page.getByRole('button', {name: 'Pop out'}));
  await expect.poll(inWindow).not.toBeNull();
  // Folded to its bar (the stylesheet, not loaded here, hides the rest).
  await userEvent.click(page.getByRole('button', {name: 'Minimize the window'}));
  await expect.poll(() => document.querySelector('.cmp-window')?.classList.contains('min')).toBe(true);
  await userEvent.click(page.getByRole('button', {name: 'Open the window'}));
  await expect.poll(() => document.querySelector('.cmp-window')?.classList.contains('min')).toBe(false);
  await userEvent.click(page.getByRole('textbox', {name: 'Message'}));
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('.composer')).toBeNull();
  await expect.poll(() => saves.at(-1)?.body).toEqual([{type: 'paragraph', runs: [{text: 'Count me in', marks: [], href: null}]}]);
});

test.each([
  ['a new message', 'new', null, 'Hike', 'kept'],
  ['a new message with nothing written', 'new', null, '', 'discarded'],
  ['a reply with no email shown', 'reply', null, 'Count me in', 'kept'],
  ['a reply with another email shown', 'reply', 99, 'Count me in', 'kept'],
  ['a reply with nothing written, another email shown', 'reply', 99, '', 'discarded'],
] as const)('the window\'s × on %s closes it: the draft %s', async (_, kind, shown, words, outcome) => {
  const draft = kind === 'new' ? draftOf({kind: 'new', message_id: null, to: [], subject: ''}) : draftOf({});
  // A new message is one of the server's `others`, its saves named by draft.
  const {saves, discarded} = kind === 'new' ? server(draftOf({}), [], MESSAGE, [draft]) : server(draft);
  await render(<Pane />);
  reading(shown);
  if (kind === 'new') newMessage();
  else startComposer({kind: 'reply', message_id: EMAIL}, {floating: true});
  await expect.poll(inWindow).not.toBeNull();
  if (words && kind === 'new') await userEvent.fill(page.getByRole('textbox', {name: 'Subject'}), words);
  if (words && kind === 'reply') {
    await userEvent.click(page.getByRole('textbox', {name: 'Message'}));
    await userEvent.keyboard(words);
  }
  await userEvent.click(page.getByRole('button', {name: 'Close', exact: true}));
  expect(openComposers()).toEqual([]);
  if (outcome === 'discarded') {
    await expect.poll(() => discarded).toEqual([draft.id]);
  } else {
    await expect.poll(() => saves.at(-1)).toEqual(kind === 'new' ? {draft: draft.id, subject: words} : {body: paragraph(words)});
    expect(discarded).toEqual([]);
  }
});

test('the window\'s × on a reply only re-addressed keeps it: a recipient changed is something written', async () => {
  const draft = draftOf({});
  const {saves, discarded} = server(draft);
  await render(<Pane />);
  reading(99);
  startComposer({kind: 'reply', message_id: EMAIL}, {floating: true});
  await expect.poll(inWindow).not.toBeNull();
  await userEvent.click(field('To'));
  await userEvent.keyboard('june.park@example.org,');
  await userEvent.click(page.getByRole('button', {name: 'Close', exact: true}));
  expect(openComposers()).toEqual([]);
  await expect.poll(() => saves.at(-1)?.to).toEqual([SAM, {name: null, address: JUNE.address}]);
  expect(discarded).toEqual([]);
});

test('the window\'s × on a reply with nothing written, over its own email, docks it there: nothing is discarded', async () => {
  const draft = draftOf({});
  const {discarded} = server(draft);
  await render(<Pane />);
  reading(EMAIL);
  startComposer({kind: 'reply', message_id: EMAIL}, {floating: true});
  await expect.poll(inWindow).not.toBeNull();
  await userEvent.click(page.getByRole('button', {name: 'Back in the reading pane'}));
  await expect.poll(() => openComposers().map(one => [one.draftId, one.floating])).toEqual([[draft.id, false]]);
  expect(discarded).toEqual([]);
});

test('a closing tab discards its open drafts with nothing written at once, and saves the rest as a last request', async () => {
  const empty = draftOf({});
  const written = draftOf({kind: 'new', message_id: null, to: [], subject: ''});
  const fresh = draftOf({kind: 'new', message_id: null, to: [], subject: ''});
  const {saves, discarded} = server(empty, [], MESSAGE, [written, fresh]);
  const keepalive: string[] = [];
  const answer = vi.mocked(window.fetch).getMockImplementation()!;
  vi.mocked(window.fetch).mockImplementation((input, init) => {
    if (init?.keepalive) keepalive.push(`${init.method} ${new URL(String(input), location.href).pathname}`);
    return answer(input, init);
  });
  await render(<Pane />);
  reading(EMAIL);
  startComposer({kind: 'reply', message_id: EMAIL});
  newMessage();
  newMessage();
  await expect.poll(() => openComposers().map(one => one.draftId).sort()).toEqual([empty.id, written.id, fresh.id].sort());
  const subjectOf = (draftId: number) => composerHost(openComposers().find(one => one.draftId === draftId)!.key).querySelector<HTMLInputElement>('input[aria-label="Subject"]');
  await expect.poll(() => subjectOf(written.id)).not.toBeNull();
  holdSaves();
  await userEvent.fill(subjectOf(written.id)!, 'Hike');
  window.dispatchEvent(new PageTransitionEvent('pagehide'));
  await expect.poll(() => [...discarded].sort()).toEqual([empty.id, fresh.id].sort());
  await expect.poll(() => saves.at(-1)).toEqual({draft: written.id, subject: 'Hike'});
  expect(keepalive.sort()).toEqual([`DELETE /api/mail/drafts/${empty.id}`, `DELETE /api/mail/drafts/${fresh.id}`, `PATCH /api/mail/drafts/${written.id}`].sort());
});

test('a reply\'s window says what its × will do as the reader moves: back under its own email, else Close', async () => {
  await compose(draftOf({}));
  reading(EMAIL);
  await userEvent.click(page.getByRole('button', {name: 'Pop out'}));
  const button = () => document.querySelector('.cmp-title .ibtn');
  await expect.poll(() => [button()?.getAttribute('aria-label'), button()?.getAttribute('data-tip')]).toEqual(['Back in the reading pane', 'Back in the reading pane']);
  reading(99);
  await expect.poll(() => [button()?.getAttribute('aria-label'), button()?.getAttribute('data-tip')]).toEqual(['Close', 'Close']);
  // The list alone, as while a selection's stack is up: no one email is shown.
  reading(null);
  await expect.poll(() => button()?.getAttribute('aria-label')).toBe('Close');
});

test('the reply-type menu\'s Edit subject turns a reply into a forward that keeps its recipients and words, its subject a field, the menu gone, the caret in the body', async () => {
  const reply = draftOf({});
  const forward = draftOf({kind: 'forward', to: [], subject: 'Fwd: Dinner Friday?'});
  const {saves, discarded} = await compose(reply, [], MESSAGE, [forward]);
  await userEvent.keyboard('Count me in');
  await userEvent.click(page.getByRole('button', {name: 'Reply, change'}));
  await userEvent.click(page.getByRole('menuitem', {name: 'Edit subject'}));
  await expect.element(page.getByRole('textbox', {name: 'Subject'})).toHaveValue('Fwd: Dinner Friday?');
  await expect.element(page.getByRole('textbox', {name: 'Message'})).toHaveFocus();
  expect(document.querySelector('.cmp-type')).toBeNull();
  expect(chips('To')).toEqual(['Sam Lee']);
  expect(document.querySelector('.composer .desc-edit')?.textContent).toBe('Count me in');
  expect(saves.find(one => one.draft === forward.id)).toMatchObject({to: [SAM], body: [{type: 'paragraph', runs: [{text: 'Count me in', marks: [], href: null}]}]});
  await expect.poll(() => discarded).toEqual([reply.id]);
});

test('on the phone every field of the composer\'s sheet is at least 16 px, so Safari doesn\'t zoom in as one takes the caret', async () => {
  await page.viewport(390, 844);
  onTestFinished(() => page.viewport(1280, 800));
  const reply = draftOf({kind: 'reply_all', to: [SAM, JUNE], cc: [RAVI]});
  const forward = draftOf({kind: 'forward', to: [], subject: 'Fwd: Dinner Friday?'});
  await compose(reply, [], MESSAGE, [forward]);
  // The sheet, named for its kind: Reply all, then Forward once Edit subject makes it one.
  const sheet = page.getByRole('dialog');
  await expect.element(sheet).toHaveAccessibleName('Reply all');
  const sizes = new Map<string, string>();
  const measure = () => {
    for (const one of sheet.element().querySelectorAll<HTMLElement>('input:not([type="file"]), textarea, [contenteditable]')) {
      sizes.set(one.getAttribute('aria-label') ?? one.className, getComputedStyle(one).fontSize);
    }
  };
  await userEvent.click(page.getByRole('button', {name: 'Show the quoted email'}));
  await expect.element(page.getByRole('textbox', {name: 'Quoted email'})).toBeVisible();
  measure();
  await userEvent.click(page.getByRole('button', {name: 'Help me write', exact: true}));
  await expect.element(page.getByRole('textbox', {name: 'Help me write'})).toBeVisible();
  measure();
  await userEvent.click(page.getByRole('button', {name: 'Help me write', exact: true}));
  await userEvent.click(page.getByRole('button', {name: 'Link', exact: true}));
  await expect.element(page.getByRole('textbox', {name: 'Link address'})).toBeVisible();
  measure();
  await userEvent.keyboard('{Escape}');
  await userEvent.click(page.getByRole('button', {name: 'Reply all, change'}));
  await userEvent.click(page.getByRole('menuitem', {name: 'Edit subject'}));
  await expect.element(page.getByRole('textbox', {name: 'Subject'})).toBeVisible();
  measure();
  expect([...sizes.keys()]).toEqual(expect.arrayContaining(['To', 'Cc', 'Bcc', 'Message', 'Quoted email', 'Help me write', 'Link address', 'Subject']));
  expect([...sizes].filter(([, size]) => parseFloat(size) < 16)).toEqual([]);
  // Closed before the page is cleared, so React takes its sheet down itself.
  for (const one of openComposers()) closeComposerAt(one.key);
  await expect.element(sheet).not.toBeInTheDocument();
});

const paragraph = (text: string): DraftOut['body'] => [{type: 'paragraph', runs: [{text, marks: [], href: null}]}];
const body = () => document.querySelector('.composer .desc-edit')?.textContent;

test.each([
  ['in the pane', false],
  ['in a window', true],
])('the reply-type menu turns a reply %s into a forward, carrying its words and From over the forward\'s own, the reply discarded, in the same place', async (_, floating) => {
  const reply = draftOf({});
  // The email already had a forward: it takes the reply's words.
  const forward = draftOf({kind: 'forward', to: [], subject: 'Fwd: Dinner Friday?', body: paragraph('Older words')});
  const {saves, discarded} = await compose(reply, [], MESSAGE, [forward]);
  await userEvent.keyboard('Count me in');
  if (floating) {
    await userEvent.click(page.getByRole('button', {name: 'Pop out'}));
    await expect.poll(inWindow).not.toBeNull();
  }
  await userEvent.click(page.getByRole('button', {name: 'Reply, change'}));
  await userEvent.click(page.getByRole('menuitemradio', {name: 'Forward'}));
  await expect.element(page.getByRole('button', {name: 'Forward, change'})).toBeVisible();
  expect(body()).toBe('Count me in');
  expect(saves.find(one => one.draft === forward.id)).toEqual({draft: forward.id, body: paragraph('Count me in'), from: reply.from, write: null});
  await expect.poll(() => discarded).toEqual([reply.id]);
  expect([inWindow() !== null, inPane() !== null]).toEqual([floating, !floating]);
  // A forward has no one to send to yet.
  expect(chips('To')).toEqual([]);
});

test('Undo of a send made from a window brings the composer back in a window', async () => {
  const fake = await compose(draftOf({}));
  await userEvent.keyboard('Count me in');
  await userEvent.click(page.getByRole('button', {name: 'Pop out'}));
  await expect.poll(inWindow).not.toBeNull();
  // The toast's time held, so Undo stays offered.
  holdSaves();
  await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
  await expect.poll(() => document.querySelector('.composer')).toBeNull();
  await expect.poll(() => fake.sends).toBe(1);
  await userEvent.click(page.getByRole('button', {name: 'Undo'}));
  await expect.poll(inWindow).not.toBeNull();
  expect(inPane()).toBeNull();
});

test('showing an email whose draft is up in a window opens no second composer in the pane', async () => {
  const draft = draftOf({});
  await compose(draft);
  await userEvent.click(page.getByRole('button', {name: 'Pop out'}));
  await expect.poll(inWindow).not.toBeNull();
  const fetched = vi.mocked(window.fetch).mock.calls.length;
  showEmail(EMAIL, [{id: draft.id, message_id: EMAIL, updated_at: SEED_NOW, send_state: null} as DraftRowOut]);
  // It asks for nothing: the draft is taken already.
  expect(vi.mocked(window.fetch).mock.calls.length).toBe(fetched);
  expect(openComposers().map(one => one.floating)).toEqual([true]);
  expect(inPane()).toBeNull();
});

test('a reply closed with Esc stays closed when C opens a new message in a window over its email', async () => {
  const draft = draftOf({});
  const fresh = draftOf({kind: 'new', message_id: null, to: [], subject: ''});
  await compose(draft, [], MESSAGE, [fresh]);
  await userEvent.keyboard('Count me in{Escape}');
  expect(openComposers()).toEqual([]);
  newMessage();
  await expect.poll(() => openComposers().map(one => one.draftId)).toEqual([fresh.id]);
  const fetched = vi.mocked(window.fetch).mock.calls.length;
  // The Drafts list comes back with the reply: it asks for nothing, so it opens nothing.
  showEmail(EMAIL, [{id: draft.id, message_id: EMAIL, updated_at: SEED_NOW, send_state: null} as DraftRowOut]);
  expect(vi.mocked(window.fetch).mock.calls.length).toBe(fetched);
  expect(openComposers().map(one => one.floating)).toEqual([true]);
});

test('docking a window while the pane holds another composer: the pane\'s gives way, its words saved', async () => {
  const fresh = draftOf({kind: 'new', message_id: null, to: [], subject: ''});
  const {saves} = await compose(draftOf({}), [], MESSAGE, [fresh]);
  newMessage();
  await expect.poll(inWindow).not.toBeNull();
  // Typed in the pane's reply once the window is up, its save held, and no poll after.
  holdSaves();
  await userEvent.click(page.getByRole('textbox', {name: 'Message'}).first());
  await userEvent.keyboard('Count me in');
  expect(saves).toEqual([]);
  dock(fresh.id);
  // The reply left the pane (the new message has it now), and what was typed went out at once: read
  // a frame on, past the save's promises, without a poll, which would run the held timer.
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(saves).toEqual([{body: paragraph('Count me in')}]);
  expect(inWindow()).toBeNull();
  expect(inPane()).toBeNull();
  expect(openComposers().map(one => [one.draftId, one.floating])).toEqual([[fresh.id, false]]);
});

/** Several windows in a row of `room` px, as the main area's foot has them, with the composers mounted. */
function Windows({room}: {room: number}) {
  useComposers();
  return (
    <div style={{position: 'relative', width: room, height: 760}}>
      <ComposerWindows />
      <ComposerRoot />
    </div>
  );
}

const windowStates = () => [...document.querySelectorAll('.cmp-window')].map(one => (one.classList.contains('shut') ? 'hidden' : one.classList.contains('min') ? 'bar' : 'open'));

test('windows that don\'t fit: the one touched longest ago folds, one brought back is touched so another folds, and past the bars the oldest go into "+N", whose menu brings one back', async () => {
  // A 1350 px row less its 16 px sides, 1318: two open windows and a bar don't fit (1464), one open
  // and two bars do (1224).
  const fresh = [1, 2, 3, 4].map(n => draftOf({kind: 'new', message_id: null, to: [], subject: `Message ${n}`}));
  server(draftOf({}), [], MESSAGE, fresh);
  await render(<Windows room={1350} />);
  for (const n of [1, 2, 3]) {
    newMessage();
    await expect.poll(() => document.querySelectorAll('.cmp-window').length).toBe(n);
  }
  await expect.poll(windowStates).toEqual(['bar', 'bar', 'open']);

  // The first brought back is the one touched last now: the third folds instead.
  await userEvent.click(page.getByRole('button', {name: 'Open the window'}).first());
  await expect.poll(windowStates).toEqual(['open', 'bar', 'bar']);

  // A fourth: three bars and a window are 1556, so the oldest touched (the second) goes into "+1"
  // (two bars, a window and the chip are 1300).
  newMessage();
  await expect.poll(() => document.querySelectorAll('.cmp-window').length).toBe(4);
  await expect.poll(windowStates).toEqual(['bar', 'hidden', 'bar', 'open']);
  await userEvent.click(page.getByRole('button', {name: '+1'}));
  await expect.element(page.getByRole('menuitem', {name: 'Message 2'})).toBeVisible();
  // Brought back, it's the one touched last: the fourth folds, and the third, touched before the
  // first was brought back, takes its place in "+1".
  await userEvent.click(page.getByRole('menuitem', {name: 'Message 2'}));
  await expect.poll(windowStates).toEqual(['bar', 'open', 'hidden', 'bar']);
});

test('a draft up in a window, opened from its row in Drafts, docks there', async () => {
  const draft = draftOf({});
  await compose(draft);
  await userEvent.click(page.getByRole('button', {name: 'Pop out'}));
  await expect.poll(inWindow).not.toBeNull();
  openDraft(draft.id);
  await expect.poll(inPane).not.toBeNull();
  expect(inWindow()).toBeNull();
});

test('Edit subject on a forward only shows its subject as a field: it stays a forward, nothing started', async () => {
  const fake = await compose(draftOf({kind: 'forward', to: [], subject: 'Fwd: Dinner Friday?'}));
  const posted = () => vi.mocked(window.fetch).mock.calls.filter(([, init]) => init?.method === 'POST').length;
  const before = posted();
  await userEvent.click(page.getByRole('button', {name: 'Forward, change'}));
  await userEvent.click(page.getByRole('menuitem', {name: 'Edit subject'}));
  await expect.element(page.getByRole('textbox', {name: 'Subject'})).toHaveValue('Fwd: Dinner Friday?');
  await expect.element(page.getByRole('textbox', {name: 'Message'})).toHaveFocus();
  expect(document.querySelector('.cmp-type')).toBeNull();
  expect(posted()).toBe(before);
  expect(fake.discarded).toEqual([]);
});

test('a new message in the pane gives it to an email shown, kept in Drafts with what was written', async () => {
  const fresh = draftOf({kind: 'new', message_id: null, to: [], subject: ''});
  const {saves, discarded} = server(draftOf({}), [], MESSAGE, [fresh]);
  await render(<Pane />);
  newMessage();
  await expect.poll(inWindow).not.toBeNull();
  await userEvent.fill(page.getByRole('textbox', {name: 'Subject'}), 'Hike');
  // Docked, it has the pane by itself (a page's own place for it, not drawn here).
  dock(fresh.id);
  expect(openComposers().map(one => [one.draftId, one.floating])).toEqual([[fresh.id, false]]);
  showEmail(EMAIL, []);
  expect(openComposers()).toEqual([]);
  await expect.poll(() => saves.at(-1)).toEqual({draft: fresh.id, subject: 'Hike'});
  expect(discarded).toEqual([]);
});

// ---- Before the server answers ----

/**
 * Starts a draft as R (or `start`) does, with the server's answer held, as a slow one would be. The
 * email and From are in, as they are when R, A or F is pressed on an email.
 */
async function composeHeld(draft: DraftOut, start = () => startComposer({kind: draft.kind as 'reply', message_id: EMAIL})) {
  const fake = server(draft);
  fake.holdStart();
  setCached(messagePath(EMAIL), MESSAGE);
  setCached(FROM_PATH, FROM);
  await render(<Pane />);
  start();
  return fake;
}
/** The placeholders the composer draws for what the server has yet to fill. */
const placeholders = () => [...document.querySelectorAll('.composer [data-skeleton]')].map(one => one.getAttribute('data-skeleton'));
/** The keys that reach the page beyond the composer, where its shortcuts listen. */
function pageKeys() {
  const heard: string[] = [];
  const listen = (event: KeyboardEvent) => heard.push(event.key);
  document.addEventListener('keydown', listen);
  onTestFinished(() => document.removeEventListener('keydown', listen));
  return heard;
}
const COUNT_ME_IN = [{type: 'paragraph', runs: [{text: 'Count me in', marks: [], href: null}]}];

test('R with the answer held: the composer is there at once, placeholders where the server fills it, and keys typed land in the body, running no shortcut', async () => {
  const fake = await composeHeld(draftOf({}));
  const heard = pageKeys();
  await expect.element(page.getByRole('textbox', {name: 'Message'})).toBeVisible();
  expect(placeholders()).toEqual(['composer-from', 'composer-to', 'composer-quote']);
  await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe('Message');
  holdSaves();
  await userEvent.keyboard('Count me in');
  expect(heard).toEqual([]);
  fake.releaseStart();
  // The answer fills it around what was typed, the caret where it was.
  await expect.poll(() => chips('To')).toEqual(['Sam Lee']);
  expect(placeholders()).toEqual([]);
  await expect.element(page.getByRole('button', {name: /Personal/})).toHaveTextContent('Personaluser@example.com');
  await expect.element(page.getByRole('button', {name: 'Show the quoted email'})).toBeVisible();
  await expect.element(page.getByRole('textbox', {name: 'Message'})).toHaveTextContent('Count me in');
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Message');
  saveNow();
  await expect.poll(() => fake.saves).toEqual([{body: COUNT_ME_IN}]);
});

test('C with the answer held: To has the caret, and an address and a subject typed stay as the answer fills From', async () => {
  const fake = await composeHeld(draftOf({kind: 'new', message_id: null, to: [], subject: ''}), () => newMessage());
  const heard = pageKeys();
  await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe('To');
  expect(placeholders()).toEqual(['composer-from']);
  // Tab makes the address a chip, and Tab again goes on to Subject.
  await userEvent.keyboard('june.park@example.org{Tab}{Tab}Hike');
  expect(heard).toEqual([]);
  holdSaves();
  fake.releaseStart();
  await expect.element(page.getByRole('button', {name: /Personal/})).toBeVisible();
  expect(placeholders()).toEqual([]);
  expect(chips('To')).toEqual(['june.park@example.org']);
  await expect.element(field('Subject')).toHaveValue('Hike');
  saveNow();
  await expect.poll(() => fake.saves).toEqual([{to: [{name: null, address: 'june.park@example.org'}], subject: 'Hike'}]);
});

test('Reply all with the answer held has its Cc and Bcc rows from the start, so nothing moves when they fill', async () => {
  const fake = await composeHeld(draftOf({kind: 'reply_all', to: [SAM, JUNE], cc: [RAVI]}));
  await expect.element(field('Bcc')).toBeVisible();
  expect(placeholders()).toEqual(['composer-from', 'composer-to', 'composer-cc', 'composer-quote']);
  fake.releaseStart();
  await expect.poll(() => chips('Cc')).toEqual(['Ravi Menon']);
  expect(chips('To')).toEqual(['Sam Lee', 'June Park']);
});

test('Esc before the answer with nothing typed: the draft that then arrives is discarded quietly', async () => {
  const draft = draftOf({});
  const fake = await composeHeld(draft);
  await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe('Message');
  await userEvent.keyboard('{Escape}');
  expect(document.querySelector('.composer')).toBeNull();
  fake.releaseStart();
  await expect.poll(() => fake.discarded).toEqual([draft.id]);
  expect(fake.saves).toEqual([]);
  // Quietly: no toast says it went, or that something failed.
  expect(document.body.textContent).not.toMatch(/Discarded|Failed to/);
});

test('Esc before the answer with words typed: they are saved into the draft that arrives', async () => {
  const fake = await composeHeld(draftOf({}));
  await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe('Message');
  await userEvent.keyboard('Count me in{Escape}');
  expect(document.querySelector('.composer')).toBeNull();
  fake.releaseStart();
  await expect.poll(() => fake.saves).toEqual([{body: COUNT_ME_IN}]);
  expect(fake.discarded).toEqual([]);
});

test('Esc and R again within one wait: the one still open takes the draft, which isn\'t discarded', async () => {
  const draft = draftOf({});
  const fake = await composeHeld(draft);
  await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe('Message');
  await userEvent.keyboard('{Escape}');
  startComposer({kind: 'reply', message_id: EMAIL});
  await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe('Message');
  await userEvent.keyboard('Count me in');
  fake.releaseStart();
  await expect.poll(() => chips('To')).toEqual(['Sam Lee']);
  expect(openComposers().map(one => one.draftId)).toEqual([draft.id]);
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => fake.saves).toEqual([{body: COUNT_ME_IN}]);
  expect(fake.discarded).toEqual([]);
});

test('a start the server refuses closes the waiting composer with its toast', async () => {
  const fake = await composeHeld(draftOf({}));
  fake.refuseStart = true;
  await expect.element(page.getByRole('textbox', {name: 'Message'})).toBeVisible();
  fake.releaseStart();
  await expect.element(page.getByText(/Failed to start the reply/)).toBeVisible();
  expect(document.querySelector('.composer')).toBeNull();
  expect(openComposers()).toEqual([]);
});

// ---- Races while the draft is on its way ----

const para = (text: string) => ({type: 'paragraph' as const, runs: [{text, marks: [], href: null}]});
/** The body's paragraphs as the composer shows them. */
const bodyLines = () => [...document.querySelector('.composer .desc-edit')?.childNodes ?? []].map(node => node.textContent).filter(Boolean);
const caretIn = (label: string) => expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe(label);
/**
 * Lets a start the server answered run its course: the answer is read and handed on within a task
 * or two. Used only where the check is that nothing happens.
 */
const answerRead = async () => {
  for (let task = 0; task < 3; task++) await new Promise(resolve => window.setTimeout(resolve, 0));
};

test('Esc with words, then R again within one wait: what was typed in each is kept, the first then the second, and shown', async () => {
  const fake = await composeHeld(draftOf({}));
  await caretIn('Message');
  await userEvent.keyboard('hello{Escape}');
  startComposer({kind: 'reply', message_id: EMAIL});
  await caretIn('Message');
  await userEvent.keyboard('there');
  holdSaves();
  fake.releaseStart();
  await expect.poll(() => chips('To')).toEqual(['Sam Lee']);
  await expect.poll(bodyLines).toEqual(['hello', 'there']);
  saveNow();
  await expect.poll(() => fake.saves.at(-1)?.body).toEqual([para('hello'), para('there')]);
});

test('Esc with words, then R again with nothing typed: the words typed first show in the composer that takes the draft, and stay', async () => {
  const fake = await composeHeld(draftOf({}));
  await caretIn('Message');
  await userEvent.keyboard('hello{Escape}');
  startComposer({kind: 'reply', message_id: EMAIL});
  await caretIn('Message');
  holdSaves();
  fake.releaseStart();
  await expect.poll(bodyLines).toEqual(['hello']);
  await userEvent.keyboard('!');
  saveNow();
  await expect.poll(() => JSON.stringify(fake.saves.at(-1)?.body ?? null)).toContain('hello');
});

test('words typed before Esc reach the draft when it\'s open again by the time the answer comes, and show there', async () => {
  const draft = draftOf({});
  const fake = await composeHeld(draft);
  await caretIn('Message');
  await userEvent.keyboard('hello{Escape}');
  // Another email shown and this one again: its draft opens again by itself.
  showEmail(EMAIL + 1, []);
  showEmail(EMAIL, [{id: draft.id, message_id: EMAIL, updated_at: SEED_NOW, send_state: null} as DraftRowOut]);
  await expect.poll(() => openComposers().map(one => one.draftId)).toEqual([draft.id]);
  await expect.element(page.getByRole('textbox', {name: 'Message'})).toBeVisible();
  holdSaves();
  fake.releaseStart();
  await expect.poll(bodyLines).toEqual(['hello']);
  saveNow();
  await expect.poll(() => fake.saves.at(-1)?.body).toEqual([para('hello')]);
});

test('R on a draft left with words: what\'s typed across the answer goes on after them, the caret where it was', async () => {
  const fake = await composeHeld(draftOf({body: [para('Old words')]}));
  await caretIn('Message');
  await userEvent.keyboard('hel');
  fake.releaseStart();
  await expect.poll(bodyLines).toEqual(['Old words', 'hel']);
  await userEvent.keyboard('lo');
  await expect.poll(bodyLines).toEqual(['Old words', 'hello']);
});

test('Esc, R again, the first start answered and the second refused: the composer keeps the draft, quietly', async () => {
  const draft = draftOf({});
  const fake = await composeHeld(draft);
  await caretIn('Message');
  await userEvent.keyboard('{Escape}');
  startComposer({kind: 'reply', message_id: EMAIL});
  await caretIn('Message');
  fake.releaseNextStart();
  await expect.poll(() => openComposers().map(one => one.draftId)).toEqual([draft.id]);
  fake.refuseStart = true;
  fake.releaseNextStart();
  await expect.poll(() => fake.startsAnswered).toBe(2);
  await answerRead();
  expect(openComposers().map(one => one.draftId)).toEqual([draft.id]);
  expect(document.body.textContent).not.toMatch(/Failed to/);
});

test('a start refused after Esc with nothing typed says nothing', async () => {
  const fake = await composeHeld(draftOf({}));
  await caretIn('Message');
  await userEvent.keyboard('{Escape}');
  fake.refuseStart = true;
  fake.releaseStart();
  await expect.poll(() => fake.startsAnswered).toBe(1);
  await answerRead();
  expect(document.body.textContent).not.toMatch(/Failed to/);
});

test('a start refused after Esc with words typed says they weren\'t kept', async () => {
  const fake = await composeHeld(draftOf({}));
  await caretIn('Message');
  await userEvent.keyboard('hello{Escape}');
  fake.refuseStart = true;
  fake.releaseStart();
  await expect.element(page.getByText(/Failed to start the reply/)).toBeVisible();
});

test('a refused start gives the pane back as it was: the composer it took the place of opens again', async () => {
  const kept = draftOf({kind: 'reply_all', to: [SAM, JUNE], cc: [RAVI], body: [para('Kept words')]});
  const fake = await compose(kept);
  fake.refuseStart = true;
  startComposer({kind: 'reply', message_id: EMAIL});
  await expect.element(page.getByText(/Failed to start the reply/)).toBeVisible();
  await expect.poll(() => openComposers().map(one => one.draftId)).toEqual([kept.id]);
  await expect.poll(bodyLines).toEqual(['Kept words']);
});

test('a refused start leaves a reply closed with Esc closed', async () => {
  const draft = draftOf({});
  const fake = await compose(draft);
  await userEvent.keyboard('Count me in{Escape}');
  fake.refuseStart = true;
  startComposer({kind: 'forward', message_id: EMAIL});
  await expect.element(page.getByText(/Failed to start the forward/)).toBeVisible();
  const fetched = vi.mocked(window.fetch).mock.calls.length;
  showEmail(EMAIL, [{id: draft.id, message_id: EMAIL, updated_at: SEED_NOW, send_state: null} as DraftRowOut]);
  expect(vi.mocked(window.fetch).mock.calls.length).toBe(fetched);
  expect(openComposers()).toEqual([]);
});

test('a second start\'s late answer doesn\'t stand over what was saved since: Esc keeps the draft', async () => {
  const draft = draftOf({});
  const fake = await composeHeld(draft);
  await caretIn('Message');
  await userEvent.keyboard('{Escape}');
  startComposer({kind: 'reply', message_id: EMAIL});
  await caretIn('Message');
  fake.releaseNextStart();
  await expect.poll(() => openComposers().map(one => one.draftId)).toEqual([draft.id]);
  holdSaves();
  await userEvent.keyboard('Count me in');
  saveNow();
  await expect.poll(() => fake.landed.length).toBe(1);
  vi.useRealTimers();
  // The second start's answer: the draft as it was before the save.
  fake.releaseNextStart();
  await expect.poll(() => fake.startsAnswered).toBe(2);
  await answerRead();
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('.composer')).toBeNull();
  await answerRead();
  expect(fake.discarded).toEqual([]);
});

// ---- Attached files ----

const fileChips = () => [...document.querySelectorAll('.composer .cmp-file')].map(file => `${file.textContent}${file.classList.contains('uploading') ? ' (uploading)' : ''}`);
const fileError = () => document.querySelector('.composer .cmp-attached [role="alert"]')?.textContent ?? null;
const MB = 1024 * 1024;
const fileOf = (name: string, size: number, type = 'application/octet-stream') => new File([new Uint8Array(size)], name, {type});
const carrying = (...files: File[]) => {
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  return transfer;
};
/** The attach button's file picker, as the user would answer it. */
const pick = (...files: File[]) => {
  const input = document.querySelector<HTMLInputElement>('.composer input[type="file"]')!;
  input.files = carrying(...files).files;
  input.dispatchEvent(new Event('change', {bubbles: true}));
};
const drop = (target: Element, transfer: DataTransfer) => target.dispatchEvent(new DragEvent('drop', {bubbles: true, cancelable: true, dataTransfer: transfer}));
const paste = (target: Element, transfer: DataTransfer) => target.dispatchEvent(new ClipboardEvent('paste', {bubbles: true, cancelable: true, clipboardData: transfer}));
const NOTES: DraftFileOut = {id: 7, filename: 'Notes.txt', mime_type: 'text/plain', size_bytes: 12};

test('files come by the attach button, a drop on the composer or a pasted image: each a chip uploading, then its name and size, and × takes one off the server', async () => {
  const fake = await compose(draftOf({}));
  await expect.element(page.getByRole('button', {name: 'Attach files'})).toBeVisible();
  fake.hold();
  pick(fileOf('Notes.txt', 12, 'text/plain'));
  await expect.poll(fileChips).toEqual(['Notes.txt12 bytes (uploading)']);
  fake.release();
  await expect.poll(fileChips).toEqual(['Notes.txt12 bytes']);

  // A drop anywhere on the composer, the body included; a drag of words attaches nothing.
  const message = document.querySelector('.composer .desc-edit')!;
  drop(message, carrying(fileOf('Floor plan.pdf', 2 * MB, 'application/pdf')));
  const words = new DataTransfer();
  words.setData('text/plain', 'just words');
  drop(message, words);
  paste(message, carrying(fileOf('image.png', 40 * 1024, 'image/png')));
  await expect.poll(fileChips).toEqual(['Notes.txt12 bytes', 'Floor plan.pdf2 MB', 'image.png40 KB']);
  expect(fake.uploads.map(one => [one.name, one.type, one.size])).toEqual([
    ['Notes.txt', 'text/plain', 12], ['Floor plan.pdf', 'application/pdf', 2 * MB], ['image.png', 'image/png', 40 * 1024],
  ]);
  expect(body()).toBe('');

  const notes = [...fake.known.values()].find(file => file.filename === 'Notes.txt')!;
  await userEvent.click(page.getByRole('button', {name: 'Remove Notes.txt'}));
  expect(fileChips()).toEqual(['Floor plan.pdf2 MB', 'image.png40 KB']);
  await expect.poll(() => fake.removed).toEqual([{draft: fake.uploads[0]!.draft, id: notes.id}]);
});

test('words pasted or dropped on the composer are left to the field they land in: only files are attached', async () => {
  const fake = await compose(draftOf({kind: 'new', message_id: null, to: [], subject: ''}));
  const subject = field('Subject');
  await userEvent.click(subject);
  await userEvent.keyboard('Lunch');
  await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}');
  await userEvent.copy();
  await userEvent.keyboard('{ArrowRight} on Friday, ');
  await userEvent.paste();
  await expect.element(subject).toHaveValue('Lunch on Friday, Lunch');
  // A drop of words isn't taken from the field: the browser puts them in.
  const words = new DataTransfer();
  words.setData('text/plain', 'Noon');
  expect(drop(subject.element(), words)).toBe(true);
  expect(fake.uploads).toEqual([]);
  expect(fileChips()).toEqual([]);
});

test('a file removed and attached again is one chip', async () => {
  const fake = await compose(draftOf({files: [NOTES]}));
  await userEvent.click(page.getByRole('button', {name: 'Remove Notes.txt'}));
  pick(fileOf('Notes.txt', 12, 'text/plain'));
  await expect.poll(fileChips).toEqual(['Notes.txt12 bytes']);
  expect(fake.removed.map(one => one.id)).toEqual([NOTES.id]);
  // The picker is left empty, so choosing the same file again is a change.
  expect(document.querySelector<HTMLInputElement>('.composer input[type="file"]')!.value).toBe('');
});

test.each([
  ['attached', false],
  ['still uploading', true],
])('a reply with nothing but a file %s is kept when Esc closes it', async (_, uploading) => {
  const draft = draftOf({});
  const fake = await compose(draft);
  if (uploading) fake.hold();
  pick(fileOf('Notes.txt', 12, 'text/plain'));
  await expect.poll(fileChips).toEqual([uploading ? 'Notes.txt12 bytes (uploading)' : 'Notes.txt12 bytes']);
  await userEvent.click(page.getByRole('textbox', {name: 'Message'}));
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('.composer')).toBeNull();
  fake.release();
  await expect.poll(() => draft.files.map(file => file.filename)).toEqual(['Notes.txt']);
  expect(fake.discarded).toEqual([]);
});

test('a forward\'s originals come first in the row; a file that would cross 25 MB with them is refused in words before it uploads, and an original taken off makes room', async () => {
  const message = {...MESSAGE, attachments: [{id: 31, filename: 'Lease.pdf', mime_type: 'application/pdf', size_bytes: 24 * MB, previewable: true}]} as MessageOut;
  const fake = await compose(draftOf({kind: 'forward', to: [], subject: 'Fwd: Dinner Friday?', files: [{...NOTES, size_bytes: MB / 2}]}), [], message);
  await expect.poll(fileChips).toEqual(['Lease.pdf24 MB', 'Notes.txt512 KB']);
  pick(fileOf('Photos.zip', MB));
  await expect.poll(fileError).toBe('Failed to attach Photos.zip, attachments can total 25 MB and these would be 25.5 MB');
  expect(fake.uploads).toEqual([]);
  await userEvent.click(page.getByRole('button', {name: 'Dismiss'}));
  expect(fileError()).toBeNull();

  await userEvent.click(page.getByRole('button', {name: 'Remove Lease.pdf'}));
  pick(fileOf('Photos.zip', MB));
  await expect.poll(fileChips).toEqual(['Notes.txt512 KB', 'Photos.zip1 MB']);
  expect(fileError()).toBeNull();
});

test('files still uploading count toward 25 MB; the reason goes once the next file attaches', async () => {
  const fake = await compose(draftOf({}));
  fake.hold();
  pick(fileOf('Photos.zip', 20 * MB));
  await expect.poll(fileChips).toEqual(['Photos.zip20 MB (uploading)']);
  pick(fileOf('Video.mov', 6 * MB));
  await expect.poll(fileError).toBe('Failed to attach Video.mov, attachments can total 25 MB and these would be 26 MB');
  expect(fake.uploads.map(one => one.name)).toEqual(['Photos.zip']);
  fake.release();
  pick(fileOf('Notes.txt', 12, 'text/plain'));
  await expect.poll(fileChips).toEqual(['Photos.zip20 MB', 'Notes.txt12 bytes']);
  expect(fileError()).toBeNull();
});

test('a Remove the server refuses says so, and the chip comes back: the file is still attached', async () => {
  const fake = await compose(draftOf({files: [NOTES]}));
  fake.failRemoves = 1;
  await userEvent.click(page.getByRole('button', {name: 'Remove Notes.txt'}));
  await expect.poll(fileError).toMatch(/^Failed to remove the file/);
  await expect.poll(fileChips).toEqual(['Notes.txt12 bytes']);
});

test('Send waits for an upload under way; one that fails stops it with its words, the composer kept', async () => {
  const fake = await compose(draftOf({}));
  fake.hold();
  fake.failUploads = 1;
  pick(fileOf('Notes.txt', 12, 'text/plain'));
  await expect.poll(fileChips).toEqual(['Notes.txt12 bytes (uploading)']);
  await userEvent.click(page.getByRole('textbox', {name: 'Message'}));
  await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
  fake.release();
  await expect.poll(fileError).toMatch(/^Failed to attach Notes\.txt/);
  await expect.element(page.getByRole('textbox', {name: 'Message'})).toBeVisible();
  expect(fake.sends).toBe(0);

  // Attached, it sends.
  fake.hold();
  pick(fileOf('Notes.txt', 12, 'text/plain'));
  await userEvent.click(page.getByRole('textbox', {name: 'Message'}));
  await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
  expect(fake.sends).toBe(0);
  fake.release();
  await expect.poll(() => fake.sends).toBe(1);
});

test('Discard\'s Undo takes the files back onto the draft it starts', async () => {
  const draft = draftOf({files: [NOTES]});
  const fake = await compose(draft);
  fake.known.set(NOTES.id, NOTES);
  expect(fileChips()).toEqual(['Notes.txt12 bytes']);
  holdSaves();
  await userEvent.click(page.getByRole('button', {name: 'Discard'}));
  await expect.poll(() => document.querySelector('.composer')).toBeNull();
  await userEvent.click(page.getByRole('button', {name: 'Undo'}));
  await expect.poll(fileChips).toEqual(['Notes.txt12 bytes']);
  expect(fake.takes).toEqual([{draft: draft.id, ids: [NOTES.id]}]);
});

test.each([
  ['in the pane', false],
  ['in a window', true],
])('the reply-type menu carries the files %s to the forward, after the forward\'s originals', async (_, floating) => {
  const message = {...MESSAGE, attachments: [{id: 31, filename: 'Menu.pdf', mime_type: 'application/pdf', size_bytes: 184 * 1024, previewable: true}]} as MessageOut;
  const reply = draftOf({files: [NOTES]});
  const forward = draftOf({kind: 'forward', to: [], subject: 'Fwd: Dinner Friday?'});
  const fake = await compose(reply, [], message, [forward]);
  fake.known.set(NOTES.id, NOTES);
  if (floating) {
    await userEvent.click(page.getByRole('button', {name: 'Pop out'}));
    await expect.poll(inWindow).not.toBeNull();
  }
  expect(fileChips()).toEqual(['Notes.txt12 bytes']);
  await userEvent.click(page.getByRole('button', {name: 'Reply, change'}));
  await userEvent.click(page.getByRole('menuitemradio', {name: 'Forward'}));
  await expect.element(page.getByRole('button', {name: 'Forward, change'})).toBeVisible();
  await expect.poll(fileChips).toEqual(['Menu.pdf184 KB', 'Notes.txt12 bytes']);
  expect(fake.takes).toEqual([{draft: forward.id, ids: [NOTES.id]}]);
  expect([inWindow() !== null, inPane() !== null]).toEqual([floating, !floating]);
});

test('a switch while a file uploads waits for it, and the forward takes it', async () => {
  const reply = draftOf({});
  const forward = draftOf({kind: 'forward', to: [], subject: 'Fwd: Dinner Friday?'});
  const fake = await compose(reply, [], MESSAGE, [forward]);
  fake.hold();
  pick(fileOf('Notes.txt', 12, 'text/plain'));
  await expect.poll(fileChips).toEqual(['Notes.txt12 bytes (uploading)']);
  await userEvent.click(page.getByRole('button', {name: 'Reply, change'}));
  await userEvent.click(page.getByRole('menuitemradio', {name: 'Forward'}));
  // The forward is started and saved; the take waits for the upload.
  await expect.poll(() => fake.saves.some(one => one.draft === forward.id)).toBe(true);
  expect(fake.takes).toEqual([]);
  fake.release();
  await expect.element(page.getByRole('button', {name: 'Forward, change'})).toBeVisible();
  await expect.poll(fileChips).toEqual(['Notes.txt12 bytes']);
  expect(fake.takes).toEqual([{draft: forward.id, ids: [[...fake.known.values()].find(file => file.filename === 'Notes.txt')!.id]}]);
});

test('a switch the server refuses for the limit keeps the reply as it was, files and all, and drops the forward it started', async () => {
  const reply = draftOf({files: [NOTES]});
  const forward = draftOf({kind: 'forward', to: [], subject: 'Fwd: Dinner Friday?'});
  const fake = await compose(reply, [], MESSAGE, [forward]);
  fake.refuseTakes = true;
  await userEvent.click(page.getByRole('button', {name: 'Reply, change'}));
  await userEvent.click(page.getByRole('menuitemradio', {name: 'Forward'}));
  await expect.element(page.getByText(/^Failed to start the forward/)).toBeVisible();
  await expect.poll(() => fake.discarded).toEqual([forward.id]);
  await expect.element(page.getByRole('button', {name: 'Reply, change'})).toBeVisible();
  expect(fileChips()).toEqual(['Notes.txt12 bytes']);
});
