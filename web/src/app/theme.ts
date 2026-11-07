// The page's theme: the choice this browser keeps (localStorage), resolved against the browser's
// preference, drawn with tokens.ts.
import {useSyncExternalStore} from 'react';
import {flippedTheme, parseThemeChoice, resolveTheme} from '../logic/theme.ts';
import type {ThemeChoice} from '../logic/theme.ts';
import {applyTheme, colour, lightColour} from '../tokens.ts';

const KEY = 'setpoint.theme';
const listeners = new Set<() => void>();

function stored(): ThemeChoice {
  try {
    return parseThemeChoice(localStorage.getItem(KEY));
  } catch {
    return 'system';
  }
}

let choice: ThemeChoice = stored();
let root: HTMLElement | null = null;
const dark = window.matchMedia('(prefers-color-scheme: dark)');

function draw() {
  if (!root) return;
  const theme = resolveTheme(choice, dark.matches);
  if (root.dataset.theme === theme) return;
  applyTheme(root, theme);
  // Safari tints its own bars to the page: the drawn theme's, which may not be the system's.
  let tint = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!tint) {
    tint = document.createElement('meta');
    tint.name = 'theme-color';
    document.head.append(tint);
  }
  tint.content = (theme === 'light' ? lightColour : colour).page;
}

/** Draws the page in this browser's theme now and follows changes from then on. */
export function startTheme(element: HTMLElement) {
  root = element;
  draw();
  dark.addEventListener('change', draw);
  // Another tab changed it.
  window.addEventListener('storage', event => {
    if (event.key !== KEY) return;
    choice = stored();
    draw();
    listeners.forEach(listener => listener());
  });
}

export function setThemeChoice(next: ThemeChoice) {
  choice = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Private windows may refuse; the choice still holds for this page.
  }
  draw();
  listeners.forEach(listener => listener());
}

export const useThemeChoice = () => useSyncExternalStore(listener => {
  listeners.add(listener);
  return () => listeners.delete(listener);
}, () => choice);

/** ⌘J: Light and Night trade places; on System it does nothing, leaving the browser in charge. */
export function flipTheme() {
  const next = flippedTheme(choice);
  if (next) setThemeChoice(next);
}
