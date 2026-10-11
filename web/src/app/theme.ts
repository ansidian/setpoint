// The page's theme: the choice this browser keeps (localStorage), resolved against the browser's
// preference, drawn with tokens.ts. A change after the first paint fades every colour over
// motion.themeFade (DESIGN.md › Motion); the first paint doesn't fade.
import {useSyncExternalStore} from 'react';
import {parseThemeChoice, resolveTheme} from '../logic/theme.ts';
import type {ThemeChoice} from '../logic/theme.ts';
import {applyTheme, motion} from '../tokens.ts';

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
let fadeTimer: number | undefined;
const dark = window.matchMedia('(prefers-color-scheme: dark)');

function draw(fade: boolean) {
  if (!root) return;
  const theme = resolveTheme(choice, dark.matches);
  if (root.dataset.theme === theme) return;
  if (fade) {
    root.classList.add('theme-fade');
    window.clearTimeout(fadeTimer);
    fadeTimer = window.setTimeout(() => root?.classList.remove('theme-fade'), motion.themeFade);
  }
  applyTheme(root, theme);
}

/** Draws the page in this browser's theme now, without a fade, and follows changes from then on. */
export function startTheme(element: HTMLElement) {
  root = element;
  draw(false);
  dark.addEventListener('change', () => draw(true));
  // Another tab changed it.
  window.addEventListener('storage', event => {
    if (event.key !== KEY) return;
    choice = stored();
    draw(true);
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
  draw(true);
  listeners.forEach(listener => listener());
}

export const useThemeChoice = () => useSyncExternalStore(listener => {
  listeners.add(listener);
  return () => listeners.delete(listener);
}, () => choice);
