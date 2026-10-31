// A posting's full text cleaned to readable markdown (J3, decision 53, D307): its own words, never
// rewritten, with its headings, paragraphs and lists, and nothing of the page around it. Pure: HTML
// or plain text in, markdown out, tested as a table (tests/markdown.test.ts).
//
// News's article extraction (src/domain/newsPages.ts) keeps paragraphs only, so a posting's headings
// ("What you'll need") and its lists would be lost; this keeps them, in the one shape the detail
// draws: `## ` headings, `- ` and `1. ` items (nested ones indented two spaces), paragraphs a blank
// line apart. Inline emphasis and links are kept as their text, without markup.
import type {ChildNode, Document} from 'domhandler';
import {Element, Text} from 'domhandler';
import {parseDocument} from 'htmlparser2';

/** Below this a page gave a teaser or a wall, not a posting. */
export const MIN_POSTING_CHARS = 200;
/** A posting's text read from the web is kept up to this long. */
export const MAX_POSTING_CHARS = 60_000;

// Furniture that is never a posting's words.
const DROP = new Set([
  'script', 'style', 'noscript', 'template', 'nav', 'header', 'footer', 'aside', 'form', 'iframe', 'svg', 'button', 'select', 'input', 'textarea',
  'img', 'picture', 'video', 'audio', 'canvas', 'object', 'embed', 'dialog', 'menu', 'head', 'title', 'meta', 'link',
]);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const BLOCKS = new Set(['p', 'div', 'section', 'article', 'main', 'body', 'html', 'blockquote', 'pre', 'table', 'tbody', 'thead', 'tr', 'td', 'th', 'dl', 'dt', 'dd', 'figure', 'figcaption', 'center']);
// A line that is the page talking about itself, not the posting.
const PAGE_LINE = /^(apply( now| for this job| here)?|back to (all )?jobs|share this (job|posting)|view all jobs|powered by .+|save job)$/i;

const name = (node: Element) => node.name.toLowerCase();
const isElement = (node: ChildNode): node is Element => node instanceof Element;

/** Text as one line: entities already decoded by the parser, every kind of space one space, zero-width marks gone. */
export function flat(text: string): string {
  return text.replace(/[\u200b-\u200d\u2060\ufeff]/g, '').replace(/[\s\u00a0\u202f]+/g, ' ').trim();
}

/** An element's text, inline, with <br> as a space. */
function inlineText(node: ChildNode): string {
  if (node instanceof Text) return node.data;
  if (!isElement(node) || DROP.has(name(node))) return '';
  if (name(node) === 'br') return ' ';
  return node.children.map(inlineText).join('');
}

/** A paragraph whose only words are bold ("<p><strong>What you'll do</strong></p>"), short enough to be a heading. */
function boldOnly(element: Element): string | null {
  const text = flat(inlineText(element));
  if (!text || text.length > 80 || /[.!?]$/.test(text) && text.split(' ').length > 6) return null;
  const bold = (node: ChildNode): boolean => {
    if (node instanceof Text) return !node.data.trim();
    if (!isElement(node)) return true;
    const tag = name(node);
    if (tag === 'strong' || tag === 'b') return true;
    if (tag === 'br') return true;
    if (tag === 'span' || tag === 'u' || tag === 'em' || tag === 'i' || tag === 'a') return node.children.every(bold);
    return false;
  };
  return element.children.every(bold) && element.children.some(child => isElement(child)) ? text : null;
}

type Block = {kind: 'heading' | 'paragraph'; text: string} | {kind: 'item'; text: string; depth: number; ordered: number | null};

/** Walks the tree into blocks: headings, paragraphs and list items, in order. */
function blocksOf(root: Document | Element): Block[] {
  const out: Block[] = [];
  let inline = '';
  const flush = () => {
    const text = flat(inline);
    inline = '';
    if (text) out.push({kind: 'paragraph', text});
  };
  const walk = (node: ChildNode, depth: number) => {
    if (node instanceof Text) {
      inline += node.data;
      return;
    }
    if (!isElement(node)) return;
    const tag = name(node);
    if (DROP.has(tag) || node.attribs.hidden !== undefined || node.attribs['aria-hidden'] === 'true') return;
    if (tag === 'br') {
      flush();
      return;
    }
    if (HEADINGS.has(tag)) {
      flush();
      const text = flat(inlineText(node));
      if (text) out.push({kind: 'heading', text});
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      flush();
      let number = 0;
      for (const child of node.children) {
        if (isElement(child) && name(child) === 'li') {
          number += 1;
          walkItem(child, depth, tag === 'ol' ? number : null);
        } else {
          walk(child, depth);
        }
      }
      flush();
      return;
    }
    if (tag === 'li') {
      flush();
      walkItem(node, depth, null);
      return;
    }
    if (tag === 'p' || BLOCKS.has(tag)) {
      flush();
      const heading = tag === 'p' || tag === 'div' ? boldOnly(node) : null;
      if (heading) {
        out.push({kind: 'heading', text: heading.replace(/:$/, '')});
        return;
      }
      for (const child of node.children) walk(child, depth);
      flush();
      return;
    }
    for (const child of node.children) walk(child, depth);
  };
  // An item's own words, then its nested lists one level in.
  const walkItem = (item: Element, depth: number, ordered: number | null) => {
    const own: ChildNode[] = [];
    const nested: Element[] = [];
    for (const child of item.children) {
      if (isElement(child) && (name(child) === 'ul' || name(child) === 'ol')) nested.push(child);
      else own.push(child);
    }
    const text = flat(own.map(inlineText).join(' '));
    if (text) out.push({kind: 'item', text, depth, ordered});
    for (const list of nested) walk(list, depth + 1);
  };
  for (const child of root.children) walk(child, 0);
  flush();
  return out;
}

/** Blocks as markdown: a blank line between blocks, list items of one list together. */
function render(blocks: Block[], limit = MAX_POSTING_CHARS): string {
  const lines: string[] = [];
  let previous: Block['kind'] | null = null;
  for (const block of blocks) {
    if (PAGE_LINE.test(block.text)) continue;
    if (block.kind === 'item') {
      if (previous && previous !== 'item') lines.push('');
      lines.push(`${'  '.repeat(block.depth)}${block.ordered === null ? '-' : `${block.ordered}.`} ${block.text}`);
    } else {
      if (previous) lines.push('');
      lines.push(block.kind === 'heading' ? `## ${block.text}` : block.text);
    }
    previous = block.kind;
  }
  // A heading with nothing under it at the very end is the page's, not the posting's.
  while (lines.length && (lines.at(-1)!.startsWith('## ') || !lines.at(-1)!.trim())) lines.pop();
  return cap(lines.join('\n'), limit);
}

/** Cut at a block boundary past the limit. */
function cap(markdown: string, limit: number): string {
  if (markdown.length <= limit) return markdown;
  const cut = markdown.slice(0, limit);
  return cut.slice(0, Math.max(cut.lastIndexOf('\n'), 0)).trimEnd();
}

/** A parsed page's element (its <main>) as markdown. */
export function domToMarkdown(root: Document | Element): string {
  return render(blocksOf(root));
}

/**
 * HTML (a platform's description, a posting page's content) as markdown. Greenhouse sends its
 * content HTML-escaped ("&lt;p&gt;"), which is unescaped first.
 */
export function htmlToMarkdown(html: string): string {
  let source = html.trim();
  if (/^&lt;[a-z]/i.test(source)) source = flat(parseDocument(`<x>${source}</x>`, {decodeEntities: true}).children.map(inlineTextRaw).join(''));
  return render(blocksOf(parseDocument(source, {decodeEntities: true})));
}

// The decoded text of escaped HTML, keeping its line breaks so the markup survives.
function inlineTextRaw(node: ChildNode): string {
  if (node instanceof Text) return node.data;
  return isElement(node) ? node.children.map(inlineTextRaw).join('') : '';
}

// A plain-text bullet: "•", "-", "*", "–" or "·" at the start of a line, and a number.
const BULLET = /^([•*·▪◦–-])\s+/;
const NUMBERED = /^(\d+)[.)]\s+(.*)$/;

/**
 * Plain text (a platform's plain description, a page with no markup worth keeping) as markdown:
 * bullets as `- ` items, a short line standing alone before others as a heading, blank lines between
 * paragraphs. Cut at `limit`, as a page is; what the user pasted is refused rather than cut (SV-140).
 */
export function plainToMarkdown(text: string, limit = MAX_POSTING_CHARS): string {
  const blocks: Block[] = [];
  const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  for (const paragraph of paragraphs) {
    const lines = paragraph.split('\n').filter(line => line.trim())
      .map(line => ({indent: /^[ \t]*/.exec(line)![0].replace(/\t/g, '  ').length, text: flat(line)}));
    const isItem = (index: number) => index < lines.length && (BULLET.test(lines[index]!.text) || NUMBERED.test(lines[index]!.text));
    let prose: string[] = [];
    const flushProse = () => {
      if (prose.length) blocks.push({kind: 'paragraph', text: prose.join(' ')});
      prose = [];
    };
    lines.forEach(({indent, text}, index) => {
      if (BULLET.test(text)) {
        flushProse();
        blocks.push({kind: 'item', text: text.replace(BULLET, ''), depth: indent >= 2 ? 1 : 0, ordered: null});
        return;
      }
      const numbered = NUMBERED.exec(text);
      if (numbered) {
        flushProse();
        blocks.push({kind: 'item', text: numbered[2]!, depth: indent >= 2 ? 1 : 0, ordered: Number(numbered[1])});
        return;
      }
      // A short line without a full stop that ends in a colon, or stands before a list or alone
      // before more text, reads as a heading.
      const short = text.length <= 60 && !/[.,;!?]$/.test(text) && prose.length === 0;
      const alone = lines.length === 1 && paragraphs.length > 1;
      if (short && (/:$/.test(text) || isItem(index + 1) || alone)) {
        blocks.push({kind: 'heading', text: text.replace(/:$/, '')});
        return;
      }
      prose.push(text);
    });
    flushProse();
  }
  return render(blocks, limit);
}
