// Keyboard helpers shared by the shortcuts (darma's).

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
