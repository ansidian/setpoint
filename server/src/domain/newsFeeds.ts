// RSS 2.0, RSS 1.0 (RDF) and Atom feeds as items (N2): each item's link, headline, summary, byline,
// date and best image, from Media RSS (media:content, media:group, media:thumbnail), an enclosure, or
// failing those the first image in its HTML (v1's order, from its news-poller's normalizeFeedItem).
// Google News search is RSS too, with each item's outlet in <source>. Pure: a string in, items out.
import type {Element} from 'domhandler';
import {getAttributeValue, isTag, textContent} from 'domutils';
import {parseDocument} from 'htmlparser2';
import {plainText, SUMMARY_MAX} from './newsIngest.ts';

export interface FeedItem {
  url: string;
  guid: string | null;
  headline: string;
  summary: string | null;
  byline: string | null;
  // As the feed wrote it; the adapter reads it as an instant.
  published: string | null;
  imageUrl: string | null;
  // Google News: the outlet that published it.
  source: {name: string; url: string | null} | null;
}

export interface Feed {
  title: string | null;
  items: FeedItem[];
}

/** Not a feed at all (an HTML page, an error page, garbage). */
export class NotAFeed extends Error {}

const elementsOf = (element: {children: unknown[]}) => element.children.filter(isTag as (node: unknown) => node is Element);
// Feeds write their tags' case loosely ("pubdate"), so names match in any case.
const children = (element: Element, name: string) => elementsOf(element).filter(child => child.name.toLowerCase() === name.toLowerCase());
const child = (element: Element, name: string) => children(element, name)[0];
const textOf = (element: Element | undefined) => (element ? textContent(element).trim() : '');
const attr = (element: Element, name: string) => getAttributeValue(element, name)?.trim() || null;

/** A link resolved against the feed, when it's http(s). */
function absolute(raw: string | null | undefined, base: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim(), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

const IMAGE_PATH = /\.(jpe?g|png|webp|gif|avif)(\?|$)/i;

/** Media RSS's images among an element's children (and its media:group's), largest first. */
function mediaImages(element: Element, tag: 'media:content' | 'media:thumbnail', base: string): string[] {
  const groups = children(element, 'media:group');
  const candidates = [element, ...groups].flatMap(parent => children(parent, tag)).filter(media => {
    if (tag === 'media:thumbnail') return true;
    const medium = attr(media, 'medium');
    const type = attr(media, 'type');
    return medium === 'image' || type?.startsWith('image/') || (!medium && !type && IMAGE_PATH.test(attr(media, 'url') ?? ''));
  });
  return candidates
    .map(media => ({url: absolute(attr(media, 'url'), base), width: Number(attr(media, 'width')) || 0}))
    .filter((media): media is {url: string; width: number} => media.url !== null)
    .sort((a, b) => b.width - a.width)
    .map(media => media.url);
}

/** The first <img> in an item's HTML, when it's absolute http(s) (v1: feeds that only inline their images). */
function firstInlineImage(html: string, base: string): string | null {
  if (!html.includes('<img')) return null;
  const document = parseDocument(html);
  const stack = [...document.children];
  while (stack.length) {
    const node = stack.shift()!;
    if (!isTag(node)) continue;
    if (node.name === 'img') {
      const src = attr(node, 'src');
      if (src && /^https?:\/\//i.test(src)) return absolute(src, base);
    }
    stack.unshift(...node.children);
  }
  return null;
}

/** The best image: Media RSS content, then an enclosure, then a thumbnail, then the HTML's first. */
function itemImage(item: Element, html: string, base: string): string | null {
  const enclosures = [...children(item, 'enclosure'), ...children(item, 'link').filter(link => attr(link, 'rel') === 'enclosure')]
    .filter(enclosure => attr(enclosure, 'type')?.startsWith('image/') || IMAGE_PATH.test(attr(enclosure, 'url') ?? attr(enclosure, 'href') ?? ''))
    .map(enclosure => absolute(attr(enclosure, 'url') ?? attr(enclosure, 'href'), base));
  return mediaImages(item, 'media:content', base)[0]
    ?? enclosures.find(url => url !== null)
    ?? mediaImages(item, 'media:thumbnail', base)[0]
    ?? firstInlineImage(html, base);
}

/** RSS's author is "email (Name)" or an email; a name is a byline, an address isn't. */
function byline(raw: string): string | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const named = /^\S+@\S+\s*\((.+)\)$/.exec(text);
  if (named) return named[1]!.trim();
  return /^\S+@\S+$/.test(text) ? null : text;
}

function rssItem(item: Element, base: string): FeedItem | null {
  const guidElement = child(item, 'guid');
  const guid = textOf(guidElement) || null;
  const permalink = guidElement && attr(guidElement, 'ispermalink') !== 'false' && attr(guidElement, 'isPermaLink') !== 'false' ? guid : null;
  const atomLink = children(item, 'atom:link').find(link => (attr(link, 'rel') ?? 'alternate') === 'alternate');
  const url = absolute(textOf(child(item, 'link')), base) ?? absolute(atomLink ? attr(atomLink, 'href') : null, base) ?? absolute(permalink, base) ?? absolute(attr(item, 'rdf:about'), base);
  const headline = plainText(textOf(child(item, 'title')));
  if (!url || !headline) return null;
  const description = textOf(child(item, 'description'));
  const content = textOf(child(item, 'content:encoded'));
  const summary = plainText(description || content, SUMMARY_MAX) || null;
  const sourceElement = child(item, 'source');
  return {
    url, guid, headline, summary,
    byline: byline(textOf(child(item, 'dc:creator')) || textOf(child(item, 'author'))),
    // An air district's feed dates its items in <startDate>; without it, each would count as published when read.
    published: textOf(child(item, 'pubDate')) || textOf(child(item, 'dc:date')) || textOf(child(item, 'atom:updated')) || textOf(child(item, 'startDate')) || null,
    imageUrl: itemImage(item, content || description, base),
    source: sourceElement && textOf(sourceElement) ? {name: plainText(textOf(sourceElement)), url: absolute(attr(sourceElement, 'url'), base)} : null,
  };
}

function atomEntry(entry: Element, base: string): FeedItem | null {
  const links = children(entry, 'link');
  const link = links.find(candidate => (attr(candidate, 'rel') ?? 'alternate') === 'alternate') ?? links.find(candidate => !attr(candidate, 'rel'));
  const url = absolute(link ? attr(link, 'href') : null, base);
  const headline = plainText(textOf(child(entry, 'title')));
  if (!url || !headline) return null;
  const summaryText = textOf(child(entry, 'summary'));
  const content = textOf(child(entry, 'content'));
  const author = child(entry, 'author');
  return {
    url, guid: textOf(child(entry, 'id')) || null, headline,
    summary: plainText(summaryText || content, SUMMARY_MAX) || null,
    byline: author ? byline(textOf(child(author, 'name'))) : null,
    published: textOf(child(entry, 'published')) || textOf(child(entry, 'updated')) || null,
    imageUrl: itemImage(entry, content || summaryText, base),
    source: null,
  };
}

/** A feed's items in its own order. Throws NotAFeed for anything that isn't RSS or Atom. */
export function parseFeed(xml: string, feedUrl: string): Feed {
  const document = parseDocument(xml.replace(/^\uFEFF/, ''), {xmlMode: true});
  const root = elementsOf(document).find(element => ['rss', 'feed', 'rdf:rdf'].includes(element.name.toLowerCase()));
  if (!root) throw new NotAFeed('This isn\'t an RSS or Atom feed.');
  if (root.name.toLowerCase() === 'feed') {
    return {title: plainText(textOf(child(root, 'title'))) || null, items: children(root, 'entry').flatMap(entry => atomEntry(entry, feedUrl) ?? [])};
  }
  const channel = child(root, 'channel');
  // RSS 2.0 keeps its items in the channel; RSS 1.0 beside it.
  const items = [...(channel ? children(channel, 'item') : []), ...children(root, 'item')];
  return {title: channel ? plainText(textOf(child(channel, 'title'))) || null : null, items: items.flatMap(item => rssItem(item, feedUrl) ?? [])};
}
