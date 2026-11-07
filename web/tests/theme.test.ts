// Appearance as a table: what a stored choice reads as, the theme each choice draws in, and what ⌘J
// switches it to.
import {describe, expect, test} from 'vitest';
import {flippedTheme, parseThemeChoice, resolveTheme} from '../src/logic/theme.ts';

describe('the theme', () => {
  test.each([
    [null, 'system'], ['system', 'system'], ['light', 'light'], ['night', 'night'], ['dark', 'system'], ['', 'system'],
  ] as const)('stored %j reads as %s', (stored, choice) => expect(parseThemeChoice(stored)).toBe(choice));

  test.each([
    ['system', true, 'night'], ['system', false, 'light'], ['light', true, 'light'], ['light', false, 'light'], ['night', false, 'night'], ['night', true, 'night'],
  ] as const)('%s with dark preferred %s draws %s', (choice, prefersDark, theme) => expect(resolveTheme(choice, prefersDark)).toBe(theme));

  test.each([
    ['light', 'night'], ['night', 'light'], ['system', null],
  ] as const)('⌘J switches %s to %s', (choice, next) => expect(flippedTheme(choice)).toBe(next));
});
