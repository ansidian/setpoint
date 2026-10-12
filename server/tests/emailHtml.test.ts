// An HTML email made safe for the reader's frame (src/domain/emailHtml.ts), as tables: what's
// stripped, what hidden remote content becomes, and the page's own policy.
import {createHash} from 'node:crypto';
import {describe, expect, test} from 'vitest';
import {emailPage, emailPolicy, MEASURE_SCRIPT, safeEmail} from '../src/domain/emailHtml.ts';

const body = (html: string, load = false) => safeEmail(html, load).body;

describe('what never reaches the frame', () => {
  test.each([
    ['a script', '<p>Hi</p><script>alert(1)</script>', '<p>Hi</p>'],
    ['a script in an SVG', '<svg><script>alert(1)</script><circle r="2"></circle></svg>', '<svg><circle r="2"/></svg>'],
    ['frames and plugins', '<iframe src="https://x.example"></iframe><object data="x.swf"></object><embed src="x"><p>ok</p>', '<p>ok</p>'],
    ['a meta refresh, base and stylesheet links', '<meta http-equiv="refresh" content="0;url=https://x.example"><base href="https://x.example/"><link rel="stylesheet" href="https://x.example/s.css"><p>ok</p>', '<p>ok</p>'],
    ['event handlers', '<p onclick="steal()" OnMouseOver="x()">Hi</p>', '<p>Hi</p>'],
    ['javascript: links, however disguised', '<a href="java\tscript:alert(1)">x</a><a href=" javascript:alert(1)">y</a>', '<a>x</a><a>y</a>'],
    ['a form\'s target', '<form action="https://x.example/steal"><input name="q"></form>', '<form><input name="q"></form>'],
  ])('%s', (_name, html, safe) => {
    expect(body(html)).toBe(safe);
  });

  test('links open in a new tab, with no referrer', () => {
    expect(body('<a href="https://myaccount.google.example">Check activity</a>')).toBe('<a href="https://myaccount.google.example" target="_blank" rel="noopener noreferrer">Check activity</a>');
  });

  test('the head\'s styles come along, without @import; the rest of the head doesn\'t', () => {
    const email = safeEmail('<html><head><title>T</title><style>@import url(https://x.example/a.css); p { margin: 0; }</style></head><body><p>Hi</p></body></html>', true);
    expect(email).toEqual({styles: [' p { margin: 0; }'], body: '<p>Hi</p>'});
  });

  test('text and attributes keep their characters, escaped where they must be', () => {
    expect(body('<p title="a &quot;b&quot;">Fish &amp; chips · £5 &lt;3</p>')).toBe('<p title="a &quot;b&quot;">Fish &amp; chips · £5 &lt;3</p>');
  });
});

describe('remote content', () => {
  test.each([
    ['an image becomes its placeholder, with its alt text and size', '<img src="https://cdn.example/hero.jpg" alt="Hero image" width="600" height="130" style="display: block">',
      /^<span style="background: repeating-linear-gradient\(135deg, #eceef0 0 3px, #f6f7f8 3px 8px\);.* width: 600px; height: 130px; display: block; display: grid;" data-hidden-image>Hero image<\/span>$/],
    ['an inline image keeps flowing inline', '<img src="https://cdn.example/a.png" alt="A">', /display: inline-grid;" data-hidden-image>A<\/span>$/],
    // reader-10: a blank hatch still says "picture", with the hide_image glyph at its centre.
    ['an image with no alt shows the hidden-image glyph', '<img src="https://cdn.example/a.png" width="40" height="40">',
      /width: 40px; height: 40px; display: inline-grid;" data-hidden-image><svg width="20" height="20" viewBox="0 -960 960 960" fill="#a3a6ab" aria-hidden="true"><path d="M820 -747\.69[^"]*"\/><\/svg><\/span>$/],
    // A mailing service's image gives only its width: a quarter of it as its height, 56 to 160, over its
    // own `height: auto`, so the newsletter keeps its shape.
    ['a width and no height: a quarter of the width, at most 160', '<img src="https://cdn.example/masthead.png" width="602" alt="" style="display: block; height: auto; max-width: 100%">',
      /width: 602px; display: block; height: auto; max-width: 100%; height: 150px; display: grid;" data-hidden-image><svg /],
    ['a width and no height: at least 56', '<img src="https://cdn.example/strip.png" width="200" alt="Strip">', /width: 200px; height: 56px; display: inline-grid;" data-hidden-image>Strip<\/span>$/],
    ['a small one stays square', '<img src="https://cdn.example/social.png" width="32" alt="Social" style="display: inline-block">', /width: 32px; display: inline-block; height: 32px; display: inline-grid;" data-hidden-image>Social<\/span>$/],
    ['no size and no alt: the line\'s width, 56 tall, with its glyph', '<img src="https://cdn.example/a.png">', /width: 100%; height: 56px; display: inline-grid;" data-hidden-image><svg /],
    ['a tracking pixel goes entirely', '<p>Hi</p><img src="https://cdn.example/open.gif?m=1" width="1" height="1" alt="">', /^<p>Hi<\/p>$/],
    ['remote backgrounds go', '<td background="https://cdn.example/bg.png" style="color: red; background: url(\'https://cdn.example/bg.png\') no-repeat">x</td>',
      /^<td style="color: red; background: none no-repeat">x<\/td>$/],
    ['srcset and media go', '<video src="https://cdn.example/v.mp4"></video><picture><source srcset="https://cdn.example/a.webp"></picture>', /^<picture><\/picture>$/],
  ])('hidden: %s', (_name, html, safe) => {
    expect(body(html)).toMatch(safe);
  });

  test('a remote url() in a style element is hidden too', () => {
    expect(safeEmail('<style>.hero { background: url(https://cdn.example/bg.png); }</style>', false).styles).toEqual(['.hero { background: none; }']);
  });

  test('allowed, the images stay as they are', () => {
    const html = '<img src="https://cdn.example/hero.jpg" alt="Hero image" width="600" height="130"><td style="background: url(https://cdn.example/bg.png)">x</td>';
    expect(body(html, true)).toBe(html);
  });

  test.each([
    [false, "img-src data:;"],
    [true, 'img-src data: https:;'],
  ])('the page\'s policy with images loading %s', (load, images) => {
    const policy = emailPolicy(load);
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain(images);
    // One script runs, the reader's own measuring script, by its hash; the frame keeps no origin.
    const hash = createHash('sha256').update(MEASURE_SCRIPT).digest('base64');
    expect(policy).toContain(`script-src 'sha256-${hash}';`);
    expect(policy.match(/script-src/g)).toHaveLength(1);
    expect(policy).toMatch(/sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox$/);
    expect(policy).not.toContain('allow-same-origin');
  });

  test('the page: the base style, then the email\'s styles and body', () => {
    const page = emailPage({styles: ['p { margin: 0; }'], body: '<p>Hi</p>'});
    expect(page).toMatch(/^<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><style>html, body \{ margin: 0;/);
    expect(page).toMatch(/<style>p \{ margin: 0; \}<\/style><\/head><body><p>Hi<\/p><script>/);
  });

  test('the page ends with the measuring script, after the email, and nothing else runs', () => {
    const page = emailPage(safeEmail('<p>Hi</p><script>steal()</script>', false));
    expect(page.endsWith(`<p>Hi</p><script>${MEASURE_SCRIPT}</script></body></html>`)).toBe(true);
    expect(page.match(/<script/g)).toHaveLength(1);
  });
});
