// Appearance (DESIGN.md › Settings, ⌘K): System, Light or Night, kept per browser. System follows
// the browser's light or dark preference.
import type {Theme} from '../tokens.ts';

export const THEME_CHOICES = ['system', 'light', 'night'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

export const THEME_LABELS: Record<ThemeChoice, string> = {system: 'System', light: 'Light', night: 'Night'};

/** A stored choice, or System for anything else (nothing stored yet, an old value). */
export const parseThemeChoice = (stored: string | null): ThemeChoice =>
  (THEME_CHOICES as readonly string[]).includes(stored ?? '') ? stored as ThemeChoice : 'system';

/** The theme a choice draws in, given whether the browser prefers dark. */
export const resolveTheme = (choice: ThemeChoice, prefersDark: boolean): Theme =>
  choice === 'system' ? (prefersDark ? 'night' : 'light') : choice;
