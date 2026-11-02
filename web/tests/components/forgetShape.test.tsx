// What browsers kept for the shell Setpoint used to draw as it started: main.tsx clears it at every
// start (a browser check, loading.spec.ts, sees that happen).
import {afterEach, expect, test, vi} from 'vitest';
import {forgetShape} from '../../src/app/forgetShape.ts';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

test('removes the account names and the signed-in mark, and only those', () => {
  localStorage.setItem('setpoint.sidebar', '{"accounts":[{"label":"Personal"}]}');
  localStorage.setItem('setpoint.signedIn', '1');
  localStorage.setItem('setpoint.theme', 'light');
  forgetShape();
  expect(localStorage.getItem('setpoint.sidebar')).toBeNull();
  expect(localStorage.getItem('setpoint.signedIn')).toBeNull();
  expect(localStorage.getItem('setpoint.theme')).toBe('light');
});

test('a browser that refuses storage starts all the same', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('Refused', 'SecurityError');
  });
  expect(forgetShape).not.toThrow();
});
