// Keyboard helpers shared by the shortcuts (darma's).
import {motion} from '../tokens.ts';

/** Whether a key went to a text field, where shortcuts stay out of the way. */
export function isTyping(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  return !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

/** A plain letter or digit key: no ⌘, Ctrl or ⌥, and ⇧ only when `shift` asks for it. */
export function plainKey(event: KeyboardEvent, key: string, {shift = false} = {}): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey !== shift || event.isComposing) return false;
  return event.key.toLowerCase() === key.toLowerCase();
}

/**
 * A shortcut presses the visible button that shows its hint (`data-hint="h"` on Done H), as a click
 * would: it takes its press (styles.css › Every press registers) and lets go, so H is seen pressing Done.
 */
export function echoKey(hint: string) {
  const button = [...document.querySelectorAll<HTMLElement>(`[data-hint="${CSS.escape(hint)}"]`)].find(element => element.checkVisibility({visibilityProperty: true}));
  if (!button) return;
  button.dataset.echo = '';
  window.setTimeout(() => delete button.dataset.echo, motion.press);
}
