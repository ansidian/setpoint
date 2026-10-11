// Web pages read for News (N2): an article's readable text and its og:image, and the posts a page
// read lists where a lab has no feed (Anthropic's news page and Mistral's, as a list of links to
// posts; the Claude release notes, as dated sections of one page). Pure: HTML in, text and posts
// out. No outlet's layout is assumed beyond what most pages share, so a page that changes keeps
// reading if it can, and a page read that finds nothing says so (the adapter fails it).
import type {ChildNode, Document} from 'domhandler';
import {Element, Text} from 'domhandler';
import {findAll, findOne, getAttributeValue, isTag, removeElement, textContent} from 'domutils';
import {parseDocument} from 'htmlparser2';
import {clip, readDate} from './newsIngest.ts';
import type {PostDate} from './newsIngest.ts';

const attr = (element: Element, name: string) => getAttributeValue(element, name)?.trim() || null;
const all = (root: Document | Element, test: (element: Element) => boolean) => findAll(test, root.children);
const textOf = (node: ChildNode | ChildNode[]) => clip(textContent(node));

function absolute(raw: string | null, base: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

// ---- Boilerplate ----

const NOISE_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'nav', 'header', 'footer', 'aside', 'form', 'iframe', 'svg', 'button', 'select', 'input',
  'textarea', 'figure', 'figcaption', 'picture', 'video', 'audio', 'dialog', 'menu', 'object', 'embed', 'canvas',
]);
const NOISE_ROLES = new Set(['navigation', 'banner', 'contentinfo', 'complementary', 'search', 'dialog', 'alert', 'menu', 'menubar']);
const NOISE_WORDS = new Set([
  'nav', 'navbar', 'navigation', 'menu', 'footer', 'sidebar', 'share', 'sharing', 'social', 'related', 'recommended', 'promo', 'newsletter',
  'subscribe', 'subscription', 'advert', 'advertisement', 'ad', 'ads', 'sponsor', 'sponsored', 'cookie', 'cookies', 'consent', 'comment',
  'comments', 'breadcrumb', 'breadcrumbs', 'caption', 'outbrain', 'taboola', 'popup', 'modal', 'signup', 'paywall', 'toolbar', 'byline',
]);
// A paragraph that is the page talking about itself, not the article.
const NOISE_TEXT = /^(advertisement|sponsored|sign up|subscribe|read more|related:|click here|share this|copyright|©|all rights reserved|follow us|this story has been updated)/i;

const words = (element: Element) => `${attr(element, 'class') ?? ''} ${attr(element, 'id') ?? ''}`.toLowerCase().split(/[^a-z]+/).filter(Boolean);
const LONG_PARAGRAPH = 200;

/** Whether an element is the page's furniture rather than its content. */
function isNoise(element: Element): boolean {
  const name = element.name.toLowerCase();
  if (NOISE_TAGS.has(name)) return true;
  if (NOISE_ROLES.has(attr(element, 'role')?.toLowerCase() ?? '')) return true;
  if (element.attribs.hidden !== undefined || attr(element, 'aria-hidden') === 'true' || /display\s*:\s*none/i.test(attr(element, 'style') ?? '')) return true;
  if (name === 'article' || name === 'main' || name === 'body') return false;
  if (!words(element).some(word => NOISE_WORDS.has(word))) return false;
  // A layout's wrapper can carry such a word ("with-sidebar"): it isn't noise if it holds the article.
  return !findOne(node => node.name === 'p' && textOf(node).length >= LONG_PARAGRAPH, element.children);
}

function stripNoise(root: Document | Element) {
  for (const element of all(root, isNoise)) if (element.parent) removeElement(element);
}

// ---- An article's text ----

const BLOCK_TAGS = new Set(['p', 'div', 'section', 'article', 'main', 'ul', 'ol', 'li', 'table', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'header', 'footer', 'figure']);
const hasBlockChild = (element: Element) => element.children.some(node => isTag(node) && BLOCK_TAGS.has(node.name.toLowerCase()));

/**
 * The text blocks of a container, in order: its paragraphs, and divs that hold only inline text
 * (Apple's newsroom writes its paragraphs as divs), long enough to be prose and not the page's own.
 */
function blockElements(root: Document | Element): {element: Element; text: string}[] {
  const found = all(root, element => {
    const name = element.name.toLowerCase();
    if (name === 'p') return true;
    // A div holding a paragraph deeper down is counted once, as the paragraph.
    return name === 'div' && !hasBlockChild(element) && !findOne(node => node.name === 'p', element.children) && textOf(element).length >= 80;
  });
  return found.map(element => ({element, text: textOf(element)})).filter(({text}) => text.length >= 25 && !NOISE_TEXT.test(text));
}

function blocks(container: Element): string[] {
  const texts: string[] = [];
  for (const {text} of blockElements(container)) if (texts.at(-1) !== text) texts.push(text);
  return texts;
}

const length = (texts: string[]) => texts.reduce((sum, text) => sum + text.length, 0);

/** Below this an extraction found a teaser or a wall, not the article. */
const MIN_ARTICLE_CHARS = 200;
const MAX_ARTICLE_CHARS = 60_000;

/** The container that holds the article: the <article> with the most text, the articleBody, <main>, or the element whose paragraphs weigh most. */
function articleContainer(document: Document): Element | null {
  const byText = (candidates: Element[]) => candidates.map(element => ({element, size: length(blocks(element))})).sort((a, b) => b.size - a.size)[0];
  const article = byText(all(document, element => element.name.toLowerCase() === 'article'));
  if (article && article.size >= MIN_ARTICLE_CHARS) return article.element;
  const body = byText(all(document, element => attr(element, 'itemprop') === 'articleBody'));
  if (body && body.size >= MIN_ARTICLE_CHARS) return body.element;
  const main = byText(all(document, element => element.name.toLowerCase() === 'main' || attr(element, 'role') === 'main'));
  if (main && main.size >= MIN_ARTICLE_CHARS) return main.element;
  // Readability's idea: each paragraph scores its parent fully and its grandparent half.
  const scores = new Map<Element, number>();
  for (const {element: paragraph, text} of blockElements(document)) {
    const size = text.length;
    const parent = paragraph.parent instanceof Element ? paragraph.parent : null;
    if (parent) scores.set(parent, (scores.get(parent) ?? 0) + size);
    const grandparent = parent?.parent instanceof Element ? parent.parent : null;
    if (grandparent) scores.set(grandparent, (scores.get(grandparent) ?? 0) + size / 2);
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** The articleBody of the page's JSON-LD, when an outlet gives one: a fallback for pages the DOM doesn't yield. */
function jsonLdBody(document: Document): {text: string | null; image: string | null} {
  const out = {text: null as string | null, image: null as string | null};
  for (const script of all(document, element => element.name === 'script' && attr(element, 'type') === 'application/ld+json')) {
    let data: unknown;
    try {
      data = JSON.parse(textContent(script));
    } catch {
      continue;
    }
    const queue: unknown[] = [data];
    while (queue.length) {
      const item = queue.shift();
      if (Array.isArray(item)) queue.push(...item);
      else if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        if (Array.isArray(record['@graph'])) queue.push(...record['@graph']);
        if (typeof record.articleBody === 'string' && record.articleBody.length > (out.text?.length ?? 0)) out.text = record.articleBody;
        const image = record.image;
        const imageUrl = typeof image === 'string' ? image : Array.isArray(image) ? image.find(entry => typeof entry === 'string') : image && typeof image === 'object' ? (image as {url?: unknown}).url : null;
        if (!out.image && typeof imageUrl === 'string') out.image = imageUrl;
      }
    }
  }
  return out;
}

export interface ExtractedArticle {
  // Paragraphs separated by a blank line (the article view's shape); null when none could be found.
  text: string | null;
  // The page's own image for sharing (og:image, twitter:image, the JSON-LD's).
  imageUrl: string | null;
}

/** The meta tags' image: og:image first, then Twitter's. */
function metaImage(document: Document, base: string): string | null {
  const metas = all(document, element => element.name.toLowerCase() === 'meta');
  for (const key of ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']) {
    const meta = metas.find(element => (attr(element, 'property') ?? attr(element, 'name'))?.toLowerCase() === key);
    const url = meta ? absolute(attr(meta, 'content'), base) : null;
    if (url) return url;
  }
  return null;
}

const joinParagraphs = (paragraphs: string[]) => {
  let total = 0;
  const kept: string[] = [];
  for (const paragraph of paragraphs) {
    if (total + paragraph.length > MAX_ARTICLE_CHARS) break;
    kept.push(paragraph);
    total += paragraph.length;
  }
  return kept.join('\n\n');
};

/**
 * An article page's readable text, paragraphs only (no navigation, sharing, promotions or the page's
 * own lines), and its image. A page that yields too little (a teaser, a consent wall, an app shell
 * that draws itself with scripts) has no text, and the article falls back to its feed summary.
 */
export function extractArticle(html: string, pageUrl: string): ExtractedArticle {
  const document = parseDocument(html);
  const imageUrl = metaImage(document, pageUrl);
  const ld = jsonLdBody(document);
  stripNoise(document);
  const container = articleContainer(document);
  const paragraphs = container ? blocks(container) : [];
  let text = length(paragraphs) >= MIN_ARTICLE_CHARS ? joinParagraphs(paragraphs) : null;
  if (!text && ld.text) {
    const fromLd = ld.text.split(/\n\s*\n|\r\n\s*\r\n|\n/).map(paragraph => clip(paragraph)).filter(paragraph => paragraph.length > 0);
    if (length(fromLd) >= MIN_ARTICLE_CHARS) text = joinParagraphs(fromLd);
  }
  return {text, imageUrl: imageUrl ?? absolute(ld.image, pageUrl)};
}

// ---- Page reads ----

export interface PagePost {
  url: string;
  // When the post is a section of the page itself (release notes), the anchor that makes it its own.
  anchor: string | null;
  headline: string;
  date: PostDate | null;
  // A dated section's own text (release notes); a listed post's is read from its page.
  text: string | null;
}

const sameSite = (a: URL, b: URL) => a.hostname.replace(/^www\./, '') === b.hostname.replace(/^www\./, '');
const ARCHIVE_SEGMENTS = /\/(category|categories|tag|tags|topic|topics|page|author|authors|search|feed|rss)(\/|$)/i;
const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

/**
 * The card a post's link sits in: its ancestors, up to three, while they link nowhere else (a list
 * of posts is the first that does), so the title and date found there are this post's and no other's.
 */
function cardOf(link: Element, href: string, base: string): Element {
  let card = link;
  for (let level = 0; level < 3; level += 1) {
    const parent = card.parent instanceof Element ? card.parent : null;
    if (!parent) break;
    const elsewhere = findOne(element => element.name.toLowerCase() === 'a' && absolute(attr(element, 'href'), base)?.replace(/#.*$/, '') !== href, parent.children);
    if (elsewhere) break;
    card = parent;
  }
  return card;
}

/** A post's title: its link's heading, else the one heading in its card, else its link's own text. */
function postTitle(link: Element, card: Element): string {
  const heading = findOne(element => HEADINGS.includes(element.name.toLowerCase()), link.children);
  if (heading) return textOf(heading);
  const headings = all(card, element => HEADINGS.includes(element.name.toLowerCase()));
  if (headings.length === 1) return textOf(headings[0]!);
  const own = textOf(link);
  return /^(read more|learn more|continue reading|more)$/i.test(own) ? '' : own;
}

/** A post's date: a <time> in its card, else a text there that reads as a date. */
function postDate(card: Element): PostDate | null {
  const time = card.name.toLowerCase() === 'time' ? card : findOne(element => element.name.toLowerCase() === 'time', card.children);
  if (time) return readDate(attr(time, 'datetime')) ?? readDate(textOf(time));
  for (const element of [card, ...all(card, () => true)]) {
    for (const node of element.children) if (node instanceof Text && readDate(node.data)) return readDate(node.data);
  }
  return null;
}

/**
 * The posts a news page lists (Anthropic's, Mistral's): links on the same site below the page's
 * own path (/news/a-post under /news), not to archives (categories, tags, pages, authors), each
 * once, in the page's order, with its title and, when the page shows one, its date.
 */
export function listedPosts(html: string, pageUrl: string): PagePost[] {
  const document = parseDocument(html);
  stripNoise(document);
  const page = new URL(pageUrl);
  const prefix = `${page.pathname.replace(/\/+$/, '')}/`;
  const posts = new Map<string, PagePost>();
  for (const link of all(document, element => element.name.toLowerCase() === 'a' && attr(element, 'href') !== null)) {
    const href = absolute(attr(link, 'href'), pageUrl);
    if (!href) continue;
    const url = new URL(href);
    url.hash = '';
    if (!sameSite(url, page) || !url.pathname.startsWith(prefix) || url.pathname.replace(/\/+$/, '') === prefix.slice(0, -1) || ARCHIVE_SEGMENTS.test(url.pathname.slice(prefix.length - 1))) continue;
    const key = url.toString();
    const card = cardOf(link, key, pageUrl);
    const headline = postTitle(link, card);
    const known = posts.get(key);
    if (known) {
      // A card often links twice (its image and its title): keep the better title and any date.
      if (headline.length > known.headline.length && headline.length <= 200) known.headline = headline;
      known.date ??= postDate(card);
      continue;
    }
    posts.set(key, {url: key, anchor: null, headline, date: postDate(card), text: null});
  }
  return [...posts.values()].filter(post => post.headline.length >= 4).map(post => ({...post, headline: clip(post.headline, 200)}));
}

function insideListItem(element: Element): boolean {
  for (let parent = element.parent; parent instanceof Element; parent = parent.parent) if (parent.name.toLowerCase() === 'li') return true;
  return false;
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const firstSentence = (text: string) => clip(/^(.{20,}?[.!?])(\s|$)/.exec(text)?.[1] ?? text, 160);

/**
 * The dated sections of a release notes page (the Claude release notes): each heading that reads as
 * a date starts one, up to the next heading at its level or above, and each is its own post: its
 * anchor on the page, its first line as the headline, and its paragraphs and list items as its text.
 */
export function datedSections(html: string, pageUrl: string): PagePost[] {
  const document = parseDocument(html);
  stripNoise(document);
  const order: Element[] = all(document, () => true);
  const posts: PagePost[] = [];
  const level = (element: Element) => HEADINGS.indexOf(element.name.toLowerCase());
  for (let index = 0; index < order.length; index += 1) {
    const heading = order[index]!;
    if (level(heading) < 0) continue;
    const date = readDate(textOf(heading));
    if (!date) continue;
    const lines: string[] = [];
    for (let next = index + 1; next < order.length; next += 1) {
      const element = order[next]!;
      if (level(element) >= 0 && (level(element) <= level(heading) || readDate(textOf(element)))) break;
      const name = element.name.toLowerCase();
      if (name !== 'p' && name !== 'li') continue;
      // What's inside a list item is counted once, as the item.
      if (insideListItem(element)) continue;
      const text = textOf(element);
      if (text && lines.at(-1) !== text) lines.push(text);
    }
    if (!lines.length) continue;
    const anchor = attr(heading, 'id') ?? slug(textOf(heading));
    posts.push({url: `${pageUrl.replace(/#.*$/, '')}#${anchor}`, anchor, headline: firstSentence(lines[0]!), date, text: lines.join('\n\n')});
  }
  return posts;
}
