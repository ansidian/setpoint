import {describe, expect, it} from 'vitest';
import type {Pass} from './passes.ts';
import {missing, specName} from './passes.ts';

const pass = (check: Pass['check'], specs?: string[]): Pass => ({check, specs, env: 'e', dir: '/x', at: '2026-10-16T18:00:00Z'});
const ALL = ['calendar', 'mail', 'search', 'selection'];

describe('missing', () => {
  it.each([
    ['nothing recorded', [], 'browser', ALL],
    ['a whole run', [pass('browser', ALL)], 'browser', []],
    ['a smaller run', [pass('browser', ['selection'])], 'browser', ['calendar', 'mail', 'search']],
    ['smaller runs together', [pass('browser', ['mail', 'selection']), pass('browser', ['calendar', 'search'])], 'browser', []],
    ['a normal run, asked about stress', [pass('browser', ALL)], 'stress', ALL],
    ['a stress run, asked about the normal run', [pass('stress', ['mail'])], 'browser', ALL],
    ['npm test', [pass('unit')], 'browser', ALL],
    ['a spec file since removed', [pass('stress', ['old', 'mail'])], 'stress', ['calendar', 'search', 'selection']],
  ] as const)('%s', (_, passes, check, left) => {
    expect(missing(ALL, [...passes], check)).toEqual(left);
  });
});

describe('specName', () => {
  it.each([
    ['mail.spec.ts', 'mail'],
    ['/a/web/tests/browser/calendarFeel.spec.ts', 'calendarFeel'],
  ])('%s', (file, name) => {
    expect(specName(file)).toBe(name);
  });
});
