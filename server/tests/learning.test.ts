// Pattern prompts as tables (BUILD-PLAN.md › B3 › Done when: prompts'
// threshold, never for protected mail, Yes and No quieting them).
import {describe, expect, test} from 'vitest';
import {patternPrompts, promptKey} from '../src/domain/learning.ts';
import type {Verdict} from '../src/domain/learning.ts';

let next = 1;
const verdict = (day: number, changes: Partial<Verdict> = {}): Verdict => ({
  organisation: 'Northwind', type: 'newsletter', kind: 'updates', protected: false, opened: false,
  at: `2026-09-${String(day).padStart(2, '0')}T14:40:00.000Z`, messageId: next++, ...changes,
});
const run = (days: number[], changes: Partial<Verdict> = {}) => days.map(day => verdict(day, changes));

describe('patternPrompts', () => {
  test.each<[string, Verdict[], number | null]>([
    // name, verdicts, the prompt's count (null: no prompt)
    ['three cleared unopened: not yet', run([2, 9, 16]), null],
    ['four cleared unopened: a prompt', run([2, 9, 16, 23]), 4],
    ['six running: a prompt counting six', run([1, 2, 3, 9, 16, 23]), 6],
    ['an opened one resets the run', [...run([2, 9]), verdict(10, {opened: true}), ...run([16, 23, 24])], null],
    ['an opened one before the run doesn\'t matter', [verdict(1, {opened: true}), ...run([2, 9, 16, 23])], 4],
    ['protected mail never counts toward a prompt', run([2, 9, 16, 23], {protected: true}), null],
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
