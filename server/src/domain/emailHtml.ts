// An HTML email made safe to show (DESIGN.md › The reader: a sandboxed frame, 600 px, radius 14 on
// white), served as its own page by GET /api/mail/messages/:id/body with its own policy. The frame
// is sandboxed without scripts or an origin of its own, and the page's policy allows no scripts;
// this also strips what an email must never do there: scripts, frames, plugins, base and meta tags
// (a meta refresh would navigate the frame), stylesheets from elsewhere, forms' targets, event
// handlers and javascript: links. While remote content is hidden, images become board 02's hatched
// placeholders with their alt text (or the hidden-image glyph), as tall as their picture would be when
// they say so and holding the email's shape when they don't; tracking pixels go, and remote
// backgrounds go. Links open in a
// new tab. The page ends with the reader's measuring script, the one script its policy lets run;
// the iPhone app's frame (`app`) measures the page itself, so its page has no script and its policy
// lets none run. Pure: a string in, a page out.
import {createHash} from 'node:crypto';
import render from 'dom-serializer';
import {Element, Text} from 'domhandler';
import type {ChildNode, Document} from 'domhandler';
import {findAll, removeElement, replaceElement} from 'domutils';
import {parseDocument} from 'htmlparser2';

/** The page's base style, before the email's own: the board's `.paper` (Helvetica, 13 / 1.35, `#1d1f22` on white). */
export const FRAME_STYLE = 'html, body { margin: 0; padding: 0; background: #ffffff; } body { font: 13px/1.35 Helvetica, Arial, sans-serif; color: #1d1f22; -webkit-font-smoothing: antialiased; overflow-wrap: break-word; } img { max-width: 100%; }';

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
 * A placeholder's height when the image gives none (polish audit reader-10): a quarter of its width,
 * 56 to 160, so a mailing service's 602-wide picture keeps 150 px of the newsletter's shape (a small one
 * stays square); with no size at all and no words, a 56 px band the width of its line.
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
  // Its own style's height wins unless it's `auto`, which a placeholder can't take from a picture it hasn't loaded.
  const held = height === null && !/(^|;)\s*height\s*:(?!\s*auto\b)/i.test(style) ? heldHeight(width, alt) : null;
  const parts = [PLACEHOLDER, width !== null ? `width: ${width}px;` : held !== null ? 'width: 100%;' : '', height !== null ? `height: ${height}px;` : '',
    style.trim() ? `${style.trim().replace(/;?$/, ';')}` : '', held !== null ? `height: ${held}px;` : '', `display: ${block ? 'grid' : 'inline-grid'};`];
  const span = new Element('span', {style: parts.filter(Boolean).join(' '), 'data-hidden-image': ''});
  const inside = alt ? new Text(alt) : hiddenGlyph();
  inside.parent = span;
  span.children = [inside];
  return span;
}

export interface SafeEmail {
  styles: string[];
  body: string;
}

/** The email's styles and body, safe for the frame; `loadImages` keeps remote content. */
export function safeEmail(html: string, loadImages: boolean): SafeEmail {
  const doc = parseDocument(html, {decodeEntities: true});
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
    const text = render(style.children, {encodeEntities: 'utf8'}).replace(/@import[^;]*;?/gi, '');
    removeElement(style);
    return loadImages ? text : text.replace(REMOTE_URL, 'none');
  });
  const body = elements(doc, item => item.name === 'body')[0];
  return {styles, body: render(body ? body.children : doc.children, {encodeEntities: 'utf8'})};
}

/**
 * The reader's measuring script, at the end of the page: the frame has no origin the reader can
 * reach into, so the page tells the reader how tall it is, as it lays out and as each image loads.
 * The page never scrolls itself (only the reading pane does), and an email wider than the frame is
 * zoomed down to fit it. The height counts to a marker after the
 * email, in the frame's own pixels whichever way the browser reports a zoomed box.
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
    const height = Math.ceil((end.getBoundingClientRect().bottom - box.top) * width / box.width);
    if (height !== sent) parent.postMessage({setpointMailHeight: (sent = height)}, '*');
  };
  const later = () => {
    if (!queued) requestAnimationFrame(measure);
    queued = true;
  };
  new ResizeObserver(later).observe(root);
  addEventListener('load', later, true);
  measure();
})();`;

const MEASURE_HASH = createHash('sha256').update(MEASURE_SCRIPT).digest('base64');

/** Who frames the page: the web reader's sandboxed frame, or the iPhone app's web view, which runs no script. */
export type EmailFrame = 'web' | 'app';

/** The frame's whole page: the base style, the email's styles, its body, and in the web's frame the measuring script. */
export function emailPage(email: SafeEmail, frame: EmailFrame = 'web'): string {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">'
    + `<style>${FRAME_STYLE}</style>${email.styles.map(style => `<style>${style}</style>`).join('')}</head>`
    + `<body>${email.body}${frame === 'web' ? `<script>${MEASURE_SCRIPT}</script>` : ''}</body></html>`;
}

/**
 * The page's own policy: nothing runs but the measuring script (by its hash), and in the app's frame
 * nothing at all; nothing loads but inline styles and inline images, and remote images (https only)
 * when they may load. `sandbox` gives the page no origin of its own and holds even if the page is
 * opened alone.
 */
export function emailPolicy(loadImages: boolean, frame: EmailFrame = 'web'): string {
  const web = frame === 'web';
  return [
    "default-src 'none'", web ? `script-src 'sha256-${MEASURE_HASH}'` : "script-src 'none'", "style-src 'unsafe-inline'", `img-src data:${loadImages ? ' https:' : ''}`, 'font-src data:',
    "form-action 'none'", "base-uri 'none'", "frame-ancestors 'self'", `sandbox${web ? ' allow-scripts' : ''} allow-popups allow-popups-to-escape-sandbox`,
  ].join('; ');
}
