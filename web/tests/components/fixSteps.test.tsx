// Alfred's fixes in his answer, one at a time: one chip, "Fix · 1 of 3", its line and evidence
// emails, ‹ › to look through them without the arrows moving, and Apply and Skip. Nothing is sent
// before Apply, which posts the route the fix names, records it as acted on, says what it did with
// Undo and moves on; looked back at, an applied fix says Applied with its Undo, which posts the
// undo route and records it undone. Skip sends nothing and keeps Apply. A refusal stays in the
// chip with the route's words. A follow-up names the fix on screen. One applied before a reload
// says so without Undo, and the steps start at the first not applied. The server is faked at fetch.
import type {AnswerOut, FixProposalOut} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {AnswerCard} from '../../src/app/search/AnswerCard.tsx';
import type {Alfred} from '../../src/app/search/state.ts';
import {dismissToast} from '../../src/app/toast.ts';
import {ToastPill} from '../../src/app/ToastPill.tsx';

const NOW = Date.parse(SEED_NOW);
const EMAIL = {message_id: 31, account_id: 1, subject: 'Thank you for your interest in the Software Engineer II role', organisation: 'Humongous Insurance', from_name: 'Humongous Talent', received_at: SEED_NOW, pinned: false};
const fix = (line: string, path: string, body: Record<string, unknown> | null, done: string, more: Partial<FixProposalOut> = {}): FixProposalOut => ({
  line, evidence: [], apply: {path, body}, undo: '/jobs/undo/{undo}', done, failed: 'Failed to do it', ...more,
});
const FIXES = [
  fix('Assign Humongous Insurance\'s rejection to Humongous Insurance · Software Engineer II, Claims', '/jobs/needs-you/2/assign', {application: 56}, 'Assigned to Software Engineer II, Claims', {evidence: [EMAIL]}),
  fix('Track Wide World Importers\' interview as a new application', '/jobs/needs-you/3/track', null, 'Tracking Wide World Importers'),
  fix('Merge Litware · QA Engineer (Platform) into Litware · QA Engineer', '/jobs/applications/46/merge', {other: 63}, 'Merged'),
];

const answer = (fixes: FixProposalOut[]): AnswerOut => ({
  conversation_id: 1, turn_id: 9, ends_at: SEED_NOW, question: 'sort out my Needs you', answer: 'Three fixes for Needs you, ready to apply.', emphasis: [],
  sources: [], items: [], applications: [], searched: [], proposals: [], fixes,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

let sent: {path: string; body: unknown}[] = [];
// A route that refuses, with the server's words.
let refusing: string | null = null;
beforeEach(() => {
  sent = [];
  refusing = null;
  vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
    const path = url.pathname.replace(/^\/api/, '');
    if ((init?.method ?? 'GET') === 'GET') return json({keys: {anthropic: true}});
    sent.push({path, body: init?.body ? JSON.parse(String(init.body)) : null});
    if (path === '/alfred/acted') return new Response(null, {status: 204});
    if (path === refusing) return json({error: {code: 'answered', message: 'That item has been answered already.'}}, 409);
    if (path.startsWith('/jobs/undo/')) return json({applications: [], needs_you: [2]});
    return json({undo: 55, application: 56});
  });
});
afterEach(() => {
  dismissToast();
  vi.restoreAllMocks();
});

async function card(fixes = FIXES, ask = vi.fn()) {
  const alfred: Alfred = {open: true, turns: [answer(fixes)], waiting: null, step: null, trail: [], error: null, failed: null, start: vi.fn(), ask, close: vi.fn()};
  await render(
    <div className="app" style={{position: 'relative', width: 900, height: 900}}>
      <div style={{width: 560}}><AnswerCard alfred={alfred} scoped={false} openId={null} accounts={new Map()} now={NOW} timeZone={SEED_TIME_ZONE} onOpen={vi.fn()} /></div>
      <ToastPill />
    </div>,
  );
  return ask;
}

const chip = (step: string) => page.getByRole('region', {name: `Proposal: fix ${step}`});
const shownLine = () => document.querySelector('.fix-page:not(.off) .chip-what')!.textContent;

test('one fix at a time with its evidence; ‹ › look through them without moving, and nothing is sent', async () => {
  await card();
  await expect.element(chip('1 of 3')).toBeVisible();
  expect(shownLine()).toBe(FIXES[0]!.line);
  await expect.element(chip('1 of 3').getByRole('button', {name: /Humongous Insurance.*Software Engineer II role/})).toBeVisible();
  // The others hold their place unseen, out of reach.
  await expect.element(page.getByText(FIXES[1]!.line)).not.toBeVisible();
  const next = page.getByRole('button', {name: 'Next fix'});
  await expect.element(page.getByRole('button', {name: 'Previous fix'})).toBeDisabled();
  // The chip keeps its height, and the arrow and Apply their places in it.
  const place = () => {
    const box = document.querySelector('.fix-prop')!.getBoundingClientRect();
    const right = next.element().getBoundingClientRect();
    return [box.height, right.top - box.top, right.left - box.left, document.querySelector('.fix-page:not(.off) .chip-acts .btn')!.getBoundingClientRect().top - box.top];
  };
  const at = place();
  await next.click();
  await expect.element(chip('2 of 3')).toBeVisible();
  expect(shownLine()).toBe(FIXES[1]!.line);
  expect(place()).toEqual(at);
  await next.click();
  await expect.element(chip('3 of 3')).toBeVisible();
  expect(place()).toEqual(at);
  await expect.element(next).toBeDisabled();
  await page.getByRole('button', {name: 'Previous fix'}).click();
  await expect.element(chip('2 of 3')).toBeVisible();
  expect(sent).toEqual([]);
});

test('Apply posts the fix\'s route, records it, says it with Undo and moves on; looked back at, its Undo puts it back', async () => {
  await card();
  await chip('1 of 3').getByRole('button', {name: 'Apply'}).click();
  await expect.element(chip('2 of 3')).toBeVisible();
  expect(sent).toEqual([{path: '/jobs/needs-you/2/assign', body: {application: 56}}, {path: '/alfred/acted', body: {turn_id: 9, index: 0, fix: true, acted: true}}]);
  await expect.element(page.getByRole('status').getByText('Assigned to Software Engineer II, Claims')).toBeVisible();

  await page.getByRole('button', {name: 'Previous fix'}).click();
  const applied = chip('1 of 3, applied');
  await expect.element(applied.getByText('Applied')).toBeVisible();
  await applied.getByRole('button', {name: 'Undo'}).click();
  await expect.element(chip('1 of 3').getByRole('button', {name: 'Apply'})).toBeVisible();
  expect(sent.slice(2)).toEqual([{path: '/jobs/undo/55', body: null}, {path: '/alfred/acted', body: {turn_id: 9, index: 0, fix: true, acted: false}}]);
  // The toast's Undo went with it.
  await expect.element(page.getByRole('status').getByText('Assigned to Software Engineer II, Claims')).not.toBeInTheDocument();
});

test('Skip sends nothing and moves on; a skipped fix keeps Apply', async () => {
  await card();
  await chip('1 of 3').getByRole('button', {name: 'Skip'}).click();
  await expect.element(chip('2 of 3')).toBeVisible();
  await page.getByRole('button', {name: 'Previous fix'}).click();
  await expect.element(chip('1 of 3, skipped').getByRole('button', {name: 'Apply'})).toBeVisible();
  expect(sent).toEqual([]);
});

test('a refusal stays in the chip with the route\'s words', async () => {
  refusing = '/jobs/needs-you/2/assign';
  await card();
  await chip('1 of 3').getByRole('button', {name: 'Apply'}).click();
  await expect.element(chip('1 of 3').getByText(/^Failed to do it, .*answered already/)).toBeVisible();
  expect(sent.map(one => one.path)).toEqual(['/jobs/needs-you/2/assign']);
});

test('a follow-up names the fix on screen', async () => {
  const ask = await card();
  await page.getByRole('button', {name: 'Next fix'}).click();
  await page.getByRole('textbox', {name: 'Ask a follow-up'}).fill('why this one?');
  await userEvent.keyboard('{Enter}');
  expect(ask).toHaveBeenCalledWith('why this one?', {turn_id: 9, index: 1});
});

test('a fix applied before a reload says so without Undo, and the steps start at the first not applied', async () => {
  await card([{...FIXES[0]!, acted: true}, FIXES[1]!, FIXES[2]!]);
  await expect.element(chip('2 of 3')).toBeVisible();
  await page.getByRole('button', {name: 'Previous fix'}).click();
  const applied = chip('1 of 3, applied');
  await expect.element(applied.getByText('Applied')).toBeVisible();
  await expect.element(applied.getByRole('button', {name: 'Undo'})).not.toBeInTheDocument();
});

test('a single fix has no count and no arrows', async () => {
  await card([FIXES[1]!]);
  await expect.element(chip('1 of 1')).toBeVisible();
  await expect.element(page.getByText('· 1 of 1')).not.toBeInTheDocument();
  await expect.element(page.getByRole('button', {name: 'Next fix'})).not.toBeInTheDocument();
});
