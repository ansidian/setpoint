// Pattern prompts and attention precision as tables (BUILD-PLAN.md › B3 › Done when: prompts'
// threshold, never for protected mail, Yes and No quieting them).
import {describe, expect, test} from 'vitest';
import {attentionPrecision, patternPrompts, PROMPT_THRESHOLD, promptKey} from '../src/domain/learning.ts';
import type {Verdict} from '../src/domain/learning.ts';

let next = 1;
const verdict = (day: number, changes: Partial<Verdict> = {}): Verdict => ({
  organisation: 'Northwind', type: 'newsletter', kind: 'updates', protected: false, opened: false,
  at: `2026-09-${String(day).padStart(2, '0')}T14:40:00.000Z`, messageId: next++, ...changes,
});
const run = (days: number[], changes: Partial<Verdict> = {}) => days.map(day => verdict(day, changes));

describe('patternPrompts', () => {
  test('the threshold is the board\'s four', () => {
    expect(PROMPT_THRESHOLD).toBe(4);
  });

  test.each<[string, Verdict[], number | null]>([
    // name, verdicts, the prompt's count (null: no prompt)
    ['three cleared unopened: not yet', run([2, 9, 16]), null],
    ['four cleared unopened: a prompt', run([2, 9, 16, 23]), 4],
    ['six running: a prompt counting six', run([1, 2, 3, 9, 16, 23]), 6],
    ['an opened one resets the run', [...run([2, 9]), verdict(10, {opened: true}), ...run([16, 23, 24])], null],
    ['an opened one before the run doesn\'t matter', [verdict(1, {opened: true}), ...run([2, 9, 16, 23])], 4],
    ['protected mail never counts toward a prompt', run([2, 9, 16, 23], {protected: true}), null],
    ['protected mail in the mix doesn\'t count', [...run([2, 9, 16]), verdict(23, {protected: true})], null],
    ['another type is another pattern', [...run([2, 9]), ...run([16, 23], {type: 'receipt'})], null],
    ['the organisation ignores case and spacing', [...run([2, 9]), ...run([16, 23], {organisation: 'northwind '})], 4],
    ['imported v1 corrections count, without ids', [...run([2, 9], {messageId: null}), ...run([16, 23])], 4],
  ])('%s', (_, verdicts, count) => {
    const prompts = patternPrompts(verdicts, new Set());
    expect(prompts[0]?.count ?? null).toBe(count);
  });

  test('a prompt names the run\'s emails newest first, and the kind most of them had', () => {
    const verdicts = [verdict(2, {messageId: 11, kind: 'other'}), verdict(9, {messageId: 12}), verdict(16, {messageId: 13}), verdict(23, {messageId: 14, organisation: 'Northwind Engineering'})];
    const quietKey = promptKey('Northwind Engineering', 'newsletter');
    expect(quietKey).toBe(promptKey(' northwind  engineering', 'newsletter'));
    const [prompt] = patternPrompts(verdicts.map(item => ({...item, organisation: 'Northwind Engineering'})), new Set());
    expect(prompt).toEqual({organisation: 'Northwind Engineering', type: 'newsletter', count: 4, messageIds: [14, 13, 12, 11], kind: 'updates', latestAt: verdicts[3]!.at});
  });

  test('an answered prompt (Yes made a rule, No said no) is quiet', () => {
    const verdicts = run([2, 9, 16, 23]);
    expect(patternPrompts(verdicts, new Set([promptKey('Northwind', 'newsletter')]))).toEqual([]);
    expect(patternPrompts(verdicts, new Set([promptKey('Northwind', 'receipt')]))).toHaveLength(1);
  });

  test('the most recent pattern is offered first', () => {
    const prompts = patternPrompts([...run([1, 2, 3, 4]), ...run([10, 11, 12, 13], {organisation: 'Fabrikam', type: 'confirmation'})], new Set());
    expect(prompts.map(prompt => prompt.organisation)).toEqual(['Fabrikam', 'Northwind']);
  });
});

describe('attentionPrecision', () => {
  const NOW = '2026-10-07T16:12:00.000Z';
  const done = (at: string, opened: boolean) => ({doneAt: at, opened});

  test('the share of attention mail opened before Done over the last 30 local days', () => {
    const result = attentionPrecision([
      done('2026-10-07T15:00:00.000Z', true), done('2026-10-06T20:00:00.000Z', true), done('2026-10-06T21:00:00.000Z', false),
      done('2026-09-08T18:00:00.000Z', true),
      // Before the window (Sep 7 Pacific is the 31st day back).
      done('2026-09-07T18:00:00.000Z', false),
    ], NOW, 'America/Los_Angeles');
    expect(result).toMatchObject({precision: 0.75, done: 4, opened: 3, from: '2026-09-08', to: '2026-10-07'});
    expect(result.days).toHaveLength(30);
    expect(result.days[0]).toEqual({date: '2026-09-08', done: 1, opened: 1});
    expect(result.days.at(-2)).toEqual({date: '2026-10-06', done: 2, opened: 1});
    expect(result.days.at(-1)).toEqual({date: '2026-10-07', done: 1, opened: 1});
  });

  test('a day is the owner\'s local day: 2 AM UTC on Oct 7 is Oct 6 in Los Angeles', () => {
    const result = attentionPrecision([done('2026-10-07T02:00:00.000Z', false)], NOW, 'America/Los_Angeles');
    expect(result.days.at(-2)).toEqual({date: '2026-10-06', done: 1, opened: 0});
    expect(result.precision).toBe(0);
  });

  test('nothing Done: no figure', () => {
    expect(attentionPrecision([], NOW, 'America/Los_Angeles').precision).toBeNull();
  });
});
