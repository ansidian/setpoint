// Where an HTML email's quoted history starts, so the reader can fold it behind •••. The reader
// can't reach into an HTML email's frame (emailHtml.ts), so the fold is the server's: it serves the
// email without its history, and the full email when ••• is pressed. A plain-text email's history
// is the reader's own rule (web/src/logic/quoted.ts), since the reader draws plain text itself.
//
// The history starts at Gmail's quote block (`gmail_quote`, which Setpoint's own replies use), at
// Apple Mail's cited block (`blockquote type="cite"`, with its "On … wrote:" line above it), or at
// Outlook's reply header (`#divRplyFwdMsg` with its rule above, or the desktop app's bordered block
// that starts "From:"). It folds only when nothing is lost by it: a quote with the sender's own
// words after it (an answer under the quote, or inline replies) is shown in full, as is a forward,
// whose carried email is the point, and an email that would fold to nothing. Nested quotes fold
// from the outermost. Pure: a string in, a string or null out.
import render from 'dom-serializer';
import {Element, Text} from 'domhandler';
import type {ChildNode, Document, ParentNode} from 'domhandler';
import {findAll, textContent} from 'domutils';
import {parse} from 'parse5';
import {adapter} from 'parse5-htmlparser2-tree-adapter';

/** Where a history starts, and the block that must end the email (null when it runs to the end anyway). */
interface Quote {
  start: ChildNode;
  end: ChildNode | null;
}

/** Elements whose text the reader never sees. */
const UNSEEN = new Set(['head', 'style', 'script', 'title', 'template', 'noscript']);
/** Elements that show something with no text. */
const PICTURES = new Set(['img', 'svg', 'video', 'audio', 'picture', 'object', 'embed', 'iframe']);

const words = (text: string) => text.replace(/[\s\u00a0\u200b]+/g, ' ').trim();
const classes = (element: Element) => (element.attribs.class ?? '').split(/\s+/);
const ATTRIBUTION = /^On\b[\s\S]+\bwrote:$/;
const FORWARD = /^(-+ ?Forwarded message ?-+|Begin forwarded message:)/i;
const FORWARD_SUBJECT = /\bSubject:\s*(FW|Fwd?):/i;

/** Whether the reader would see anything in `node`: words, or a picture. */
function seen(node: ChildNode): boolean {
  if (node instanceof Text) return words(node.data) !== '';
  if (!(node instanceof Element)) return false;
  if (UNSEEN.has(node.name)) return false;
  if (PICTURES.has(node.name)) return true;
  return node.children.some(seen);
}

/** The siblings before `node`, nearest first. */
function before(node: ChildNode): ChildNode[] {
  const siblings = node.parent?.children ?? [];
  return siblings.slice(0, siblings.indexOf(node)).reverse();
}

/** The siblings after `node`. */
function after(node: ChildNode): ChildNode[] {
  const siblings = node.parent?.children ?? [];
  return siblings.slice(siblings.indexOf(node) + 1);
}

/** Whether anything shows after `node` in reading order, to the email's end. */
function seenAfter(node: ChildNode): boolean {
  for (let at: ChildNode | ParentNode | null = node; at && 'parent' in at && at.parent; at = at.parent) {
    if (after(at as ChildNode).some(seen)) return true;
  }
  return false;
}

/** The nearest sibling before `node` that shows something, skipping blank lines and breaks. */
function shownBefore(node: ChildNode): ChildNode | null {
  return before(node).find(seen) ?? null;
}

/** The nearest sibling before `node`, past blank lines, when it passes `test`. */
function nearest(node: ChildNode, test: (element: Element) => boolean): Element | null {
  const found = before(node).find(sibling => seen(sibling) || (sibling instanceof Element && test(sibling)));
  return found instanceof Element && test(found) ? found : null;
}

/** The quote that starts at `element`, or null when it isn't one or is a forward. */
function quoteAt(element: Element): Quote | null {
  const names = classes(element);
  if (names.includes('gmail_quote') || names.includes('gmail_quote_container')) {
    // Gmail's forward is a gmail_quote too, under its "Forwarded message" line.
    if (FORWARD.test(words(textContent(element)))) return null;
    return {start: element, end: element};
  }
  if (element.name === 'blockquote' && element.attribs.type?.toLowerCase() === 'cite') {
    const above = shownBefore(element);
    const line = above ? words(textContent(above)) : '';
    if (FORWARD.test(line)) return null;
    return {start: above && ATTRIBUTION.test(line) ? above : element, end: element};
  }
  if (element.attribs.id === 'divRplyFwdMsg') {
    if (FORWARD_SUBJECT.test(words(textContent(element)))) return null;
    // Outlook's rule above the header, and the empty marker it keeps above the rule.
    let start: ChildNode = element;
    const rule = nearest(start, node => node.name === 'hr');
    if (rule) start = rule;
    const marker = nearest(start, node => node.attribs.id === 'appendonsend');
    if (marker) start = marker;
    return {start, end: null};
  }
  // Outlook for the desktop: a block with a rule along its top, its first words "From:".
  if (element.name === 'div' && /border-top:\s*solid/i.test(element.attribs.style ?? '')) {
    const text = words(textContent(element));
    if (!/^From:/.test(text) || FORWARD_SUBJECT.test(text)) return null;
    return {start: element, end: null};
  }
  return null;
}

/** Removes `start` and everything after it in reading order, then the blank lines left at the new end. */
function cutFrom(start: ChildNode) {
  const parents: ParentNode[] = [];
  for (let node: ChildNode = start; node.parent; node = node.parent as unknown as ChildNode) {
    const siblings = node.parent.children;
    siblings.splice(siblings.indexOf(node) + (node === start ? 0 : 1));
    parents.push(node.parent);
  }
  for (const parent of parents) {
    while (parent.children.length && !seen(parent.children.at(-1)!) && !isUnseenBlock(parent.children.at(-1)!)) parent.children.pop();
  }
}

/** A head, style or other block kept though nothing in it shows. */
const isUnseenBlock = (node: ChildNode) => node instanceof Element && UNSEEN.has(node.name);

/**
 * The email without its quoted history, as a whole document, or null when it has none to fold, so
 * the email shows in full.
 */
export function withoutQuotedHistory(html: string): string | null {
  const doc = parse(html, {treeAdapter: adapter}) as unknown as Document;
  for (const element of findAll(() => true, doc.children)) {
    const quote = quoteAt(element);
    if (!quote) continue;
    if (quote.end && seenAfter(quote.end)) continue;
    cutFrom(quote.start);
    if (!doc.children.some(seen)) return null;
    return render(doc.children, {encodeEntities: 'utf8'});
  }
  return null;
}
