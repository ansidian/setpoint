// What Setpoint on job boards reads on Indeed's job pages (SV-202). Indeed's class names are
// generated, so it reads its test ids and job keys (README.md › What it reads on Indeed):
//
// - The job pane, one header on a search, the home feed and a job's own page: its title in
//   vj-job-title, its company the first line of company-info-metadata. It carries no job key of its
//   own, so where the open job's card is on the page it's read only once its title and company are
//   the card's: a pane still showing the last job isn't read as this one.
// - A card: an a[data-jk] whose title is #jobTitle-<jk>, its company the company-name in the nearest
//   ancestor holding one. Indeed hides a made-up card among them, which is skipped.
import {unreadOf} from './posting.ts';
import type {PageRead, Posting} from './posting.ts';

const HEADER = '[data-testid="desktop-job-header"]';
const COMPANY = '[data-testid="company-name"]';
const KEY = /^[0-9a-f]+$/i;

const textOf = (element: Element | null | undefined) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

/** The job open: `jk` on a job's own page, `vjk` on a search, else the home feed's pressed card. */
export function jobKeyOf(url: URL, doc: Document = document): string | null {
  const key = url.searchParams.get(url.pathname.startsWith('/viewjob') ? 'jk' : 'vjk');
  if (key && KEY.test(key)) return key;
  const pressed = doc.querySelector<HTMLElement>('a[data-jk][aria-pressed="true"]')?.dataset.jk;
  return pressed && KEY.test(pressed) ? pressed : null;
}

/** What a page should let it read: the pane on a job's own page, and the pane and cards on a search with a job open. */
export function expects(url: URL): {pane: boolean; cards: boolean} {
  if (url.pathname.startsWith('/viewjob')) return {pane: KEY.test(url.searchParams.get('jk') ?? ''), cards: false};
  // A search with results always has one open; one with none opens nothing and shows no cards.
  const open = url.pathname === '/jobs' && KEY.test(url.searchParams.get('vjk') ?? '');
  return {pane: open, cards: open};
}

/** The list's cards drawn so far, each with the line its company is on. */
export function readCards(doc: Document = document): Posting[] {
  const cards: Posting[] = [];
  for (const link of doc.querySelectorAll<HTMLElement>('a[data-jk]')) {
    const jobId = link.dataset.jk ?? '';
    // Indeed hides a made-up card among the real ones, out of sight and out of the screen readers'.
    if (!KEY.test(jobId) || link.closest('[aria-hidden="true"]')) continue;
    const title = textOf(link.querySelector(`[id="jobTitle-${jobId}"]`));
    // The card is the link's nearest ancestor naming a company; one holding other jobs' links has
    // climbed out of it, as from a carousel's card, which names none.
    let card = link.parentElement;
    while (card && !card.querySelector(COMPANY)) card = card.parentElement;
    if (!title || !card || card.querySelectorAll('a[data-jk]').length > 1) continue;
    const name = card.querySelector(COMPANY);
    const company = textOf(name);
    // The name clips itself with an ellipsis, so the chip goes on the line around it.
    const line = name?.parentElement;
    if (company && line) cards.push({jobId, company, title, line});
  }
  return cards;
}

/** The posting the pane shows for this job, and the line its title is on; null until it's drawn for it. */
export function readPane(jobKey: string, doc: Document = document, cards: Posting[] = readCards(doc)): Posting | null {
  const header = doc.querySelector(HEADER);
  const line = header?.querySelector('[data-testid="vj-job-title"]');
  const title = textOf(line);
  // The company's name, a link to its page; the line after it is the place.
  const company = textOf(header?.querySelector('[data-testid="company-info-metadata"] [dir="ltr"]'));
  if (!line || !title || !company) return null;
  const card = cards.find(posting => posting.jobId === jobKey);
  if (card && (card.title !== title || card.company !== company)) return null;
  return {jobId: jobKey, company, title, line};
}

/** The page as read now: what it expects that it couldn't read, the pane, and the cards. */
export function readPage(url: URL, doc: Document = document): PageRead {
  const cards = readCards(doc);
  const key = jobKeyOf(url, doc);
  const pane = key ? readPane(key, doc, cards) : null;
  return {unread: unreadOf(expects(url), pane, cards), pane, cards};
}
