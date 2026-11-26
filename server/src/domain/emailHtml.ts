// An HTML email made safe to show (a sandboxed frame, 600 px, radius 14 on white).
// GET /api/mail/messages/:id/body serves it as its own page, with its own policy. The frame is
// sandboxed without scripts or an origin of its own, and the page's policy allows no scripts. This
// also strips what an email must never do there: scripts, frames, plugins, base and meta tags (a
// meta refresh would navigate the frame), stylesheets from elsewhere, forms' targets, event handlers
// and javascript: links. Media rules that ask the window's height get a tall window's answer (the
// frame's height is the page's own). While remote content is hidden, images become board 02's
// hatched placeholders with their alt text (or the hidden-image glyph). A placeholder is as tall as
// its picture would be when the image says so, and holds the email's shape when it doesn't. Tracking
// pixels go, and remote backgrounds go. Links open in a new tab. The page ends with the reader's
// measuring script, the one script its policy lets run. Pure: a string in, a page out.
import {createHash} from 'node:crypto';
import render from 'dom-serializer';
import {Element, isDirective, Text} from 'domhandler';
import type {ChildNode, Document} from 'domhandler';
import {findAll, removeElement, replaceElement} from 'domutils';
import {parse} from 'parse5';
import {adapter} from 'parse5-htmlparser2-tree-adapter';

/** The page's base style, before the email's own: the board's `.paper` (Helvetica, 13 / 1.35, `#1d1f22` on white), with iOS text autosizing off: a page zoomed to fit keeps its text at the size its own line heights expect. */
export const FRAME_STYLE = 'html, body { margin: 0; padding: 0; background: #ffffff; } body { font: 13px/1.35 Helvetica, Arial, sans-serif; color: #1d1f22; -webkit-font-smoothing: antialiased; overflow-wrap: break-word; } img { max-width: 100%; } html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }';

/**
 * The page's own box, after the email's styles. The frame is as tall as its page, so a page
 * sized to the window (`height: 100vh`, a flexed and centred body) would be sized to the frame and
 * never grow. `:root` outranks the `html` and `body` an email's styles name, and the body's own
 * attributes don't reach the page.
 */
export const PAGE_BOX = ':root, :root > body { height: auto !important; min-height: 0 !important; max-height: none !important; display: block !important; }';

// Board 02's `.imgph`, on the frame's own font (Geist is the app's, not the email's).
const PLACEHOLDER = 'background: repeating-linear-gradient(135deg, #eceef0 0 3px, #f6f7f8 3px 8px); color: #8a8e94; font: 12px Helvetica, Arial, sans-serif; place-items: center; overflow: hidden; max-width: 100%; text-align: center; vertical-align: bottom;';

const REMOVE = new Set(['script', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'meta', 'link', 'template', 'portal', 'title']);
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'poster', 'background', 'srcset', 'data']);
const REMOTE_URL = /url\(\s*(["']?)\s*(?:https?:)?\/\/[^)]*\1\s*\)/gi;

/** Browsers ignore control characters and whitespace inside a scheme ("java\tscript:"). */
const unsafeUrl = (value: string) => /^(javascript|vbscript|data:text\/html)/i.test([...value].filter(char => char.charCodeAt(0) > 32).join(''));
const pixels = (value: string | undefined) => (value && /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : null);
const elements = (root: Document | ChildNode[], test: (element: Element) => boolean) => findAll(test, Array.isArray(root) ? root : root.children);

// design-export/glyphs/icons.json's hide_image (Material Symbols Rounded 300), the reader's own glyph
// for hidden images, drawn in the frame's grey on a placeholder with no alt text to say "picture".
const HIDE_IMAGE = "M820 -747.69V-316.15Q820 -301.15 810.58 -293.65Q801.15 -286.15 790 -286.15Q778.85 -286.15 769.42 -293.96Q760 -301.77 760 -316.77V-747.69Q760 -752.31 756.15 -756.15Q752.31 -760 747.69 -760H315.77Q300.77 -760 293.27 -769.42Q285.77 -778.85 285.77 -790Q285.77 -801.15 293.27 -810.58Q300.77 -820 315.77 -820H747.69Q778 -820 799 -799Q820 -778 820 -747.69ZM212.31 -140Q182 -140 161 -161Q140 -182 140 -212.31V-735.69L90.92 -784.77Q82.62 -793.08 82.42 -805.65Q82.23 -818.23 90.92 -826.92Q99.62 -835.62 112 -835.62Q124.38 -835.62 133.08 -826.92L826.92 -133.08Q835.23 -124.77 835.42 -112.19Q835.62 -99.62 826.92 -90.92Q818.23 -82.23 805.85 -82.23Q793.46 -82.23 784.77 -90.92L735.69 -140ZM585.08 -290H306.16Q295.31 -290 290.08 -299.85Q284.85 -309.69 292.08 -318.92L355.15 -402.84Q360.77 -410.08 369.42 -410.08Q378.08 -410.08 383.69 -403.23L449.23 -319.23L496.08 -379L200 -675.08V-212.31Q200 -207.69 203.85 -203.85Q207.69 -200 212.31 -200H675.08ZM537 -537Q537 -537 537 -537Q537 -537 537 -537ZM437.85 -437.85Q437.85 -437.85 437.85 -437.85Q437.85 -437.85 437.85 -437.85Z";
const GLYPH_GREY = '#a3a6ab';

/**
 * A placeholder's height when the image gives none: a quarter of its width, 56 to 160. A mailing
 * service's 602-wide picture then keeps 150 px of the newsletter's shape (a small one stays square).
 * With no size at all and no words, it is a 56 px band the width of its line.
 */
function heldHeight(width: number | null, alt: string): number | null {
  if (width !== null) return Math.min(160, Math.max(Math.min(width, 56), Math.floor(width / 4)));
  return alt ? null : 56;
}

/** The hide_image glyph, 20 px, centred on a placeholder. */
function hiddenGlyph(): Element {
  const glyph = new Element('svg', {width: '20', height: '20', viewBox: '0 -960 960 960', fill: GLYPH_GREY, 'aria-hidden': 'true'});
  const shape = new Element('path', {d: HIDE_IMAGE});
  shape.parent = glyph;
  glyph.children = [shape];
  return glyph;
}

/** A hidden image's placeholder, or null for a tracking pixel. */
function placeholder(image: Element): Element | null {
  const width = pixels(image.attribs.width);
  const height = pixels(image.attribs.height);
  if (width !== null && height !== null && width <= 2 && height <= 2) return null;
  const style = image.attribs.style ?? '';
  const block = /display\s*:\s*(block|flex|grid|table)\b/i.test(style);
  const alt = image.attribs.alt ?? '';
  // Its own style's height wins unless it's `auto`. A placeholder can't take `auto` from a picture
  // it hasn't loaded.
  const held = height === null && !/(^|;)\s*height\s*:(?!\s*auto\b)/i.test(style) ? heldHeight(width, alt) : null;
  const parts = [PLACEHOLDER, width !== null ? `width: ${width}px;` : held !== null ? 'width: 100%;' : '', height !== null ? `height: ${height}px;` : '',
    style.trim() ? `${style.trim().replace(/;?$/, ';')}` : '', held !== null ? `height: ${held}px;` : '', `display: ${block ? 'grid' : 'inline-grid'};`];
  const span = new Element('span', {style: parts.filter(Boolean).join(' '), 'data-hidden-image': ''});
  const inside = alt ? new Text(alt) : hiddenGlyph();
  inside.parent = span;
  span.children = [inside];
  return span;
}

/** The tags a browser folds into the one body it builds. */
const DOCUMENT_TAGS = new Set(['html', 'head', 'body']);

/**
 * All of the email, as a browser would show it. An email can be whole documents one after the
 * other, each with its own head and body (a bank's notice is three). Everything in them is the
 * email, and so is anything around them.
 */
const shown = (nodes: ChildNode[]): ChildNode[] => nodes.flatMap(node => {
  if (isDirective(node)) return [];
  return node instanceof Element && DOCUMENT_TAGS.has(node.name) ? shown(node.children) : [node];
});

/**
 * A media rule's conditions on the window's height, read as a tall window would answer them. The
 * frame is as tall as its page, so asking the frame could flip the email's layout as the frame
 * grows and flip it back as it shrinks. Width and the device's own size are the frame's to answer.
 */
const ALWAYS = '(min-width: 0px)';
const NEVER = '(max-width: 0px)';
const TALL_WINDOW: [RegExp, string][] = [
  [/\(\s*orientation\s*:\s*landscape\s*\)/gi, NEVER],
  [/\(\s*orientation\s*:\s*portrait\s*\)/gi, ALWAYS],
  [/\(\s*min-height\s*:[^)]*\)/gi, ALWAYS],
  [/\(\s*max-height\s*:[^)]*\)/gi, NEVER],
  [/\(\s*min-aspect-ratio\s*:[^)]*\)/gi, NEVER],
  [/\(\s*max-aspect-ratio\s*:[^)]*\)/gi, ALWAYS],
];
const framedMedia = (css: string) => css.replace(/@media[^{;]*\{/gi, prelude => TALL_WINDOW.reduce((text, [feature, answer]) => text.replace(feature, answer), prelude));

/** A width of 400 px or more, the start of a designed email's fixed column (most are 600). */
const WIDE = 400;
const WIDE_IN_CSS = /(?:^|[;{\s])(?:min-|max-)?width\s*:\s*(\d+(?:\.\d+)?)px/gi;
const wideCss = (css: string) => [...css.matchAll(WIDE_IN_CSS)].some(match => Number(match[1]) >= WIDE);

/**
 * Whether an email is really just text, as a person's email from Gmail, Outlook or Apple Mail is:
 * no table holding another table (a layout), and nothing given a fixed width of 400 px or more, by
 * its attribute, its own style or the email's styles. A table on its own (a signature's two
 * columns) is still text. Images don't count: the frame keeps them to its width.
 */
export function textLike(doc: Document, styles: string[]): boolean {
  if (styles.some(wideCss)) return false;
  return !elements(doc, element => {
    if (element.name === 'img') return false;
    if (element.name === 'table' && elements(element.children, inner => inner.name === 'table').length > 0) return true;
    const width = pixels(element.attribs.width?.replace(/px$/i, ''));
    return (width !== null && width >= WIDE) || wideCss(element.attribs.style ?? '');
  }).length;
}

export interface SafeEmail {
  styles: string[];
  body: string;
  /** Just text (textLike), so a page on the phone gives it room inside its card. */
  textLike: boolean;
}

/** The email's styles and body, safe for the frame. `loadImages` keeps remote content. */
export function safeEmail(html: string, loadImages: boolean): SafeEmail {
  // Read as a browser reads it (the HTML standard's parser), so markup a browser repairs, such as a
  // table row left inside a cell, keeps the shape the sender saw.
  const doc = parse(html, {treeAdapter: adapter}) as unknown as Document;
  for (const element of elements(doc, item => REMOVE.has(item.name))) removeElement(element);
  for (const element of elements(doc, () => true)) {
    for (const [name, value] of Object.entries(element.attribs)) {
      const lower = name.toLowerCase();
      if (lower.startsWith('on') || (URL_ATTRIBUTES.has(lower) && unsafeUrl(value))) delete element.attribs[name];
    }
    if (element.name === 'form') delete element.attribs.action;
    if (element.name === 'a' && element.attribs.href !== undefined) {
      element.attribs.target = '_blank';
      element.attribs.rel = 'noopener noreferrer';
    }
  }
  // Read before images become placeholders, which carry their picture's width.
  const text = textLike(doc, elements(doc, item => item.name === 'style').map(style => render(style.children)));
  if (!loadImages) {
    for (const element of elements(doc, item => ['video', 'audio'].includes(item.name) || (item.name === 'source' && item.parent instanceof Element && item.parent.name === 'picture'))) removeElement(element);
    for (const image of elements(doc, item => item.name === 'img')) {
      const replacement = placeholder(image);
      if (replacement) replaceElement(image, replacement);
      else removeElement(image);
    }
    for (const element of elements(doc, () => true)) {
      delete element.attribs.background;
      delete element.attribs.srcset;
      const style = element.attribs.style;
      if (style) element.attribs.style = style.replace(REMOTE_URL, 'none');
    }
  }
  const styles = elements(doc, item => item.name === 'style').map(style => {
    const text = framedMedia(render(style.children, {encodeEntities: 'utf8'}).replace(/@import[^;]*;?/gi, ''));
    removeElement(style);
    return loadImages ? text : text.replace(REMOTE_URL, 'none');
  });
  return {styles, body: render(shown(doc.children), {encodeEntities: 'utf8'}), textLike: text};
}

/**
 * The reader's measuring script, at the end of the page. The frame has no origin the reader can
 * reach into, so the page tells the reader how tall it is, as it lays out and as each image loads.
 * The page never scrolls itself (only the reading pane does). An email wider than the frame is
 * zoomed down to fit it. The height counts to a marker after the email, or to the lowest of the
 * body's own boxes when one sits out of the flow. It is in the frame's own pixels, whichever way
 * the browser reports a zoomed box.
 * A key pressed with the email clicked into also goes on to the reader, unless a field of the
 * email's own takes it. The page keeps its own defaults, so selecting and copying still work. Only
 * ⌘F, ⌘K and ⌘, are kept from the browser, as Setpoint keeps them everywhere else.
 * Find in email asks it, by message, for the words it should mark (already folded as the reader
 * folds them, web/src/logic/find.ts) and which match is current. It reads the page's text once,
 * a block's edge being a line no match crosses, marks the matches with the CSS highlight API, and
 * answers with how many there are and where the current one sits, in the frame's own pixels.
 */
export const MEASURE_SCRIPT = `(() => {
  const root = document.documentElement;
  root.style.overflow = 'hidden';
  const end = document.createElement('setpoint-end');
  end.style.cssText = 'display: block !important; clear: both !important; height: 0 !important; margin: 0 !important; padding: 0 !important; border: 0 !important';
  document.body.append(end);
  let sent = -1;
  let queued = false;
  const measure = () => {
    queued = false;
    root.style.zoom = '';
    const width = root.clientWidth;
    const scale = Math.min(1, width / root.scrollWidth);
    if (scale < 1) root.style.zoom = String(scale);
    const box = root.getBoundingClientRect();
    let bottom = end.getBoundingClientRect().bottom;
    for (const child of document.body.children) bottom = Math.max(bottom, child.getBoundingClientRect().bottom);
    const height = Math.ceil((bottom - box.top) * width / box.width);
    if (height !== sent) parent.postMessage({setpointMailHeight: (sent = height)}, '*');
  };
  const later = () => {
    if (!queued) requestAnimationFrame(measure);
    queued = true;
  };
  new ResizeObserver(later).observe(root);
  addEventListener('load', later, true);
  measure();
  addEventListener('keydown', event => {
    const target = event.target;
    if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && ['f', 'k', ','].includes(event.key.toLowerCase())) event.preventDefault();
    const {key, code, metaKey, ctrlKey, altKey, shiftKey, repeat, isComposing} = event;
    parent.postMessage({setpointMailKey: {key, code, metaKey, ctrlKey, altKey, shiftKey, repeat, isComposing}}, '*');
  });
  const BLOCKS = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'TR', 'TD', 'TH', 'TABLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'BR', 'HR', 'SECTION', 'ARTICLE', 'CENTER']);
  const fold = text => {
    let out = '';
    const at = [];
    let index = 0;
    let space = null;
    for (const char of text) {
      if (/\\s/.test(char)) {
        space = space ? {from: space.from, line: space.line || char === '\\n'} : {from: index, line: char === '\\n'};
      } else {
        if (space) {
          out += space.line ? '\\n' : ' ';
          at.push(space.from);
          space = null;
        }
        const piece = char.normalize('NFD').replace(/\\p{M}/gu, '').toLowerCase();
        out += piece;
        for (let unit = 0; unit < piece.length; unit += 1) at.push(index);
      }
      index += char.length;
    }
    if (space) {
      out += space.line ? '\\n' : ' ';
      at.push(space.from);
    }
    return {text: out, at};
  };
  let page = null;
  const read = () => {
    const nodes = [];
    const starts = [];
    let text = '';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: node => (node.nodeType === 1 && ['SCRIPT', 'STYLE', 'SETPOINT-END', 'SETPOINT-ROOM'].includes(node.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === 3) {
        nodes.push(node);
        starts.push(text.length);
        text += node.data;
      } else if (BLOCKS.has(node.tagName)) {
        text += '\\n';
      }
    }
    return {nodes, starts, folded: fold(text)};
  };
  const marks = document.createElement('style');
  marks.textContent = '::highlight(setpoint-find) { background-color: #ffe27a; color: #1d1f22; } ::highlight(setpoint-find-current) { background-color: #ff9d2e; color: #1d1f22; }';
  document.head.append(marks);
  const find = (words, current) => {
    page = page || read();
    const {nodes, starts, folded} = page;
    const at = offset => {
      let index = nodes.length - 1;
      while (index > 0 && starts[index] > offset) index -= 1;
      return [nodes[index], offset - starts[index]];
    };
    const ranges = [];
    for (let from = 0; words && nodes.length;) {
      const start = folded.text.indexOf(words, from);
      if (start < 0) break;
      const range = document.createRange();
      const [startNode, startOffset] = at(folded.at[start]);
      const [endNode, endOffset] = at(folded.at[start + words.length - 1]);
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, Math.min(endNode.length, endOffset + 1));
      ranges.push(range);
      from = start + words.length;
    }
    const chosen = ranges[current] || null;
    if (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function') {
      if (ranges.length) CSS.highlights.set('setpoint-find', new Highlight(...ranges));
      else CSS.highlights.delete('setpoint-find');
      if (chosen) CSS.highlights.set('setpoint-find-current', new Highlight(chosen));
      else CSS.highlights.delete('setpoint-find-current');
    }
    let top = null;
    let bottom = null;
    if (chosen) {
      const box = root.getBoundingClientRect();
      const mark = chosen.getBoundingClientRect();
      const scale = root.clientWidth / box.width;
      top = (mark.top - box.top) * scale;
      bottom = (mark.bottom - box.top) * scale;
    }
    parent.postMessage({setpointFound: {words, current, count: ranges.length, top, bottom}}, '*');
  };
  addEventListener('message', event => {
    if (event.source !== parent) return;
    const ask = event.data && event.data.setpointFind;
    if (!ask || typeof ask.words !== 'string' || typeof ask.current !== 'number') return;
    find(ask.words, ask.current);
  });
})();`;

/**
 * A text-like email's room on the phone, after the email's styles so it can't take it away: 16 px
 * at its top and sides, as the desktop's card gives (the phone's card gives none, so a designed
 * email keeps the screen's width). The bottom's 16 px is a block after the email, inside what the
 * measuring script counts.
 */
export const PHONE_ROOM = ':root > body { padding: 16px 16px 0 !important; }';
const ROOM_BELOW = '<setpoint-room style="display: block !important; height: 16px !important; margin: 0 !important; padding: 0 !important; border: 0 !important"></setpoint-room>';

const MEASURE_HASH = createHash('sha256').update(MEASURE_SCRIPT).digest('base64');

/**
 * The frame's whole page: the base style, the email's styles, the page's own box, its body, and the
 * measuring script. On the phone (`phone`), a text-like email also gets its room.
 */
export function emailPage(email: SafeEmail, phone = false): string {
  const room = phone && email.textLike;
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">'
    + `<style>${FRAME_STYLE}</style>${email.styles.map(style => `<style>${style}</style>`).join('')}<style>${PAGE_BOX}${room ? ` ${PHONE_ROOM}` : ''}</style></head>`
    + `<body>${email.body}${room ? ROOM_BELOW : ''}<script>${MEASURE_SCRIPT}</script></body></html>`;
}

/**
 * The page's own policy. Nothing runs but the measuring script (by its hash). Nothing loads but inline styles and inline images, and remote images (https only)
 * when they may load. `sandbox` gives the page no origin of its own, and it holds even if the page
 * is opened alone.
 */
export function emailPolicy(loadImages: boolean): string {
  return [
    "default-src 'none'", `script-src 'sha256-${MEASURE_HASH}'`, "style-src 'unsafe-inline'", `img-src data:${loadImages ? ' https:' : ''}`, 'font-src data:',
    "form-action 'none'", "base-uri 'none'", "frame-ancestors 'self'", 'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox',
  ].join('; ');
}
