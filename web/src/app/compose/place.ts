// Each open composer's host element. A composer is mounted once (ComposerRoot), into its host, and
// its places (the reading pane, its window) take the host in turn. Moving a node keeps everything
// React and the page hold in it: the text, the fold, Cc and Bcc. What a move loses, the caret and
// the scroll, is put back here. (A recipient half typed becomes a chip as its field is left, as it
// does anywhere.) Hosts are keyed by the composer's opening (OpenComposer's `key`).

interface Kept {
  focused: HTMLElement | null;
  input: {start: number | null; end: number | null; direction: 'forward' | 'backward' | 'none' | null} | null;
  range: {startContainer: Node; startOffset: number; endContainer: Node; endOffset: number} | null;
  scrolls: [Element, number][];
}

interface Host {
  element: HTMLDivElement;
  kept: Kept | null;
  // The caret's first landing, held until the composer is in a place.
  pending: (() => void) | null;
}

const hosts = new Map<number, Host>();

function hostOf(key: number): Host {
  let host = hosts.get(key);
  if (!host) {
    const element = document.createElement('div');
    element.className = 'cmp-host';
    host = {element, kept: null, pending: null};
    hosts.set(key, host);
  }
  return host;
}

/** The element composer `key` is mounted in, made on first use. */
export const composerHost = (key: number): HTMLDivElement => hostOf(key).element;

/** The hosts of composers no longer open go. */
export function pruneHosts(open: number[]) {
  for (const [key, host] of hosts) {
    if (open.includes(key)) continue;
    host.element.remove();
    hosts.delete(key);
  }
}

/** Runs `fn` now if composer `key` is on the page, else once a place takes it. */
export function whenPlaced(key: number, fn: () => void) {
  const host = hostOf(key);
  if (host.element.isConnected) fn();
  else host.pending = fn;
}

function keep(element: HTMLElement): Kept {
  const active = document.activeElement instanceof HTMLElement && element.contains(document.activeElement) ? document.activeElement : null;
  const input = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
    ? {start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection}
    : null;
  const selection = document.getSelection();
  const at = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
  const range = at && active && !input && active.contains(at.startContainer)
    ? {startContainer: at.startContainer, startOffset: at.startOffset, endContainer: at.endContainer, endOffset: at.endOffset}
    : null;
  const scrolls = [...element.querySelectorAll('*')].filter(one => one.scrollTop > 0).map(one => [one, one.scrollTop] as [Element, number]);
  return {focused: active, input, range, scrolls};
}

function restore({focused, input, range, scrolls}: Kept) {
  for (const [element, top] of scrolls) element.scrollTop = top;
  if (!focused || !focused.isConnected) return;
  focused.focus({preventScroll: true});
  if (input && (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement)) {
    focused.setSelectionRange(input.start, input.end, input.direction ?? undefined);
  } else if (range) {
    const again = document.createRange();
    again.setStart(range.startContainer, range.startOffset);
    again.setEnd(range.endContainer, range.endOffset);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(again);
  }
}

/** A place takes composer `key`. */
export function attach(key: number, place: HTMLElement) {
  const host = hostOf(key);
  if (host.element.parentElement === place) return;
  if (host.element.isConnected) host.kept = keep(host.element);
  place.appendChild(host.element);
  if (host.kept) restore(host.kept);
  host.kept = null;
  const first = host.pending;
  host.pending = null;
  first?.();
}

/** A place goes: what had the caret is kept for the next one. */
export function detach(key: number, place: HTMLElement) {
  const host = hosts.get(key);
  if (!host || host.element.parentElement !== place) return;
  host.kept = keep(host.element);
  host.element.remove();
}
