// A proposal's prefill in the browser, against the fake model with the key set. Add to calendar from
// the reader waits under skeletons, its fields locked, then takes the model's fields, and a menu then
// opens over the fields below it. Past 1.5 s it unlocks with the rules' fields and a red line, and a
// late answer is dropped. A refusal says Anthropic's status, and on hover what it means. The page's
// clock is stopped, so the 1.5 s are the check's, and the fake holds each answer until it's let go.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {Page} from 'playwright-core';
import {PREFILL_WAIT_MS} from '../../src/logic/search.ts';
import {FAKE_ANTHROPIC_KEY, fakeAlfred, SEED_PREFILLS} from './fakeAlfred.ts';
import type {FakePrefill} from './fakeAlfred.ts';
import {cleanUp, pauseClock, rested, startSetpoint, test, until} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

const EXAM = 'Final exam schedule · CS 101';
const LEASE = 'Lease renewal terms';
const POLICY = 'Your renters policy renewal is coming up';

async function withModel(prefills: Record<string, FakePrefill>) {
  const fake = await fakeAlfred(() => ({name: 'answer', input: {found: false, text: '', source_ids: []}}), {prefills});
  const setpoint = await startSetpoint({env: {SETPOINT_DEV_AI_URL: fake.url}}).catch(async (error: unknown) => {
    await fake.close();
    throw error;
  });
  await setpoint.api('PUT', '/secrets/anthropic_api_key', {value: FAKE_ANTHROPIC_KEY});
  return {setpoint, fake, stop: async () => {
    await setpoint.stop();
    await fake.close();
  }};
}

/** The reader on an email, the clock stopped, and its proposal asked for. */
async function propose(setpoint: Setpoint, subject: string, kind: 'Add to calendar' | 'Add as task' = 'Add to calendar') {
  const page = await setpoint.page('target');
  await page.goto(`${setpoint.base}/inbox`);
  await page.locator('.list .row').first().waitFor();
  await pauseClock(page);
  await page.locator(`.list .row[data-key]:has(b[data-tip="${subject}"])`).click();
  await page.locator('.rd-acts .btn', {hasText: kind}).click();
  const proposal = page.getByRole('form', {name: kind === 'Add to calendar' ? 'Proposal: add to calendar' : 'Proposal: add as task'});
  await proposal.waitFor();
  return {page, proposal};
}

/** The fields an open menu lies over, each with whether the menu is on top there. */
const menuOnTop = (page: Page) => page.evaluate(() => {
  const menu = document.querySelector('form.prop .pop.menu')!;
  const box = menu.getBoundingClientRect();
  return [...document.querySelectorAll('form.prop .field')].map(field => field.getBoundingClientRect()).filter(field => field.top > box.top && field.top < box.bottom)
    .map(field => menu.contains(document.elementFromPoint(box.left + box.width / 2, field.top + field.height / 2)));
});

test('Add to calendar waits for the model under skeletons, its fields locked, then takes its fields, and a menu opens over the fields below', async () => {
  const {setpoint, fake, stop} = await withModel({[EXAM]: {...SEED_PREFILLS[EXAM], held: true}});
  try {
    const {page, proposal} = await propose(setpoint, EXAM);
    await proposal.locator('.skf').first().waitFor();
    assert.equal(await proposal.locator('.skf').count(), 5, 'the title, when, place, calendar and colour wait');
    assert.equal(await proposal.locator('.ed-scroll[inert]').count(), 1, 'nothing can be typed while it comes');
    assert.equal(await proposal.getByRole('button', {name: 'Create event'}).isDisabled(), true);
    await until('the model asked', async () => fake.prefilled, asked => asked.includes(EXAM));
    fake.release();
    const place = proposal.getByRole('textbox', {name: 'Place'});
    await until('the model\'s place', () => place.inputValue(), value => value === 'Room 214');
    assert.equal(await proposal.locator('.skf').count(), 0);
    assert.equal(await proposal.locator('.ed-scroll[inert]').count(), 0);
    assert.equal(await proposal.locator('.card-miss').count(), 0, 'no red line');
    assert.equal(await proposal.getByRole('textbox', {name: 'Describe the event'}).evaluate(line => line === document.activeElement), true, 'the line takes focus');
    await proposal.locator('.pick-time').first().click();
    await proposal.locator('.pop.menu').waitFor();
    const covered = await rested(() => menuOnTop(page));
    assert.ok(covered.length > 0, 'the time menu lies over fields');
    assert.deepEqual(covered, covered.map(() => true), 'the time menu is over every field below it');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await stop();
  }
});

test('past 1.5 s the fields unlock with the rules\' prefill and say so, and the late answer is dropped', async () => {
  const {setpoint, fake, stop} = await withModel({[LEASE]: {...SEED_PREFILLS[LEASE], held: true}});
  try {
    const {page, proposal} = await propose(setpoint, LEASE, 'Add as task');
    await proposal.locator('.skf').first().waitFor();
    await until('the model asked', async () => fake.prefilled, asked => asked.includes(LEASE));
    await page.clock.runFor(PREFILL_WAIT_MS - 1);
    assert.equal(await proposal.locator('.skf').count() > 0, true, 'still waiting just short of 1.5 s');
    await page.clock.runFor(1);
    const miss = proposal.locator('.card-miss');
    await miss.waitFor();
    assert.equal(await miss.textContent(), 'Failed to prefill, Claude took too long');
    const line = proposal.getByRole('textbox', {name: 'Describe the task'});
    const rules = await line.inputValue();
    assert.notEqual(rules, 'Sign the lease renewal');
    // The answer comes after all: it changes nothing.
    const answered = page.waitForResponse(response => new URL(response.url()).pathname === '/api/proposals/prefill');
    fake.release();
    await (await answered).finished();
    await setpoint.idle();
    assert.equal(await line.inputValue(), rules);
    assert.equal(await miss.count(), 1);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await stop();
  }
});

test('a refusal says Anthropic\'s status in the red line, and on hover what it means', async () => {
  const {setpoint, stop} = await withModel({[POLICY]: {fails: true}});
  try {
    const {proposal} = await propose(setpoint, POLICY);
    const miss = proposal.locator('.card-miss');
    await miss.waitFor();
    assert.equal(await miss.textContent(), 'Failed to prefill, Claude didn’t answer (529)');
    assert.equal(await miss.getAttribute('data-tip'), 'Anthropic is overloaded right now');
    assert.equal(await proposal.locator('.ed-scroll[inert]').count(), 0, 'the rules\' fields are open to change');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await stop();
  }
});
