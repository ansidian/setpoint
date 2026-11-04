// What Setpoint on LinkedIn reads on LinkedIn's job pages (SV-174). LinkedIn's class names are
// generated and change, so it reads only what has stayed put (README.md › What it reads on LinkedIn):
//
// - The job pane: the job's id in the address (`currentJobId`, or /jobs/view/<id>/), the company's
//   "Company, …" label, whose componentkey ends in that id, and the page's title, "<title> |
//   <company> | LinkedIn". LinkedIn sets the title after it draws the pane, so a pane whose title
//   still names the last job isn't read until it names this one.
// - A card: the innermost element keyed job-card-component-ref-<id> (each card is keyed twice), its
//   title from its "Dismiss <title> job" button, its company the line after the title's.

const CARD_KEY = 'job-card-component-ref-';
const CARDS = `[componentkey^="${CARD_KEY}"]`;

/** A posting as LinkedIn shows it, and the line its chip goes at the end of. */
export interface Posting {
  jobId: string;
  company: string;
  title: string;
  line: Element;
}

/** The job open: the search's `currentJobId`, or the id in /jobs/view/<id>/. */
export function jobIdOf(url: URL): string | null {
  const current = url.searchParams.get('currentJobId');
  if (current && /^\d+$/.test(current)) return current;
  return /^\/jobs\/view\/(\d+)/.exec(url.pathname)?.[1] ?? null;
}

/** What a page should let it read: the pane wherever a job is open, and cards on a search's results. */
export function expects(url: URL): {pane: boolean; cards: boolean} {
  if (!url.pathname.startsWith('/jobs')) return {pane: false, cards: false};
  const open = jobIdOf(url) !== null;
  // A search with results always has one open; one with none opens nothing and shows no cards.
  return {pane: open, cards: open && url.pathname.startsWith('/jobs/search')};
}

/** The posting the pane shows for this job, and the line its title is on; null until it's all drawn. */
export function readPane(jobId: string, doc: Document = document): Posting | null {
  const label = [...doc.querySelectorAll('[aria-label^="Company, "]')]
    .find(element => (element.getAttribute('componentkey') ?? '').endsWith(`-${jobId}`));
  if (!label) return null;
  // "Company, Proseware, Inc.." names "Proseware, Inc.": only the label's own full stop goes.
  const company = (label.getAttribute('aria-label') ?? '').slice('Company, '.length).replace(/\.$/, '').trim();
  // "(3) Software Engineer I | Fabrikam | LinkedIn": the count is LinkedIn's notifications.
  const page = doc.title.replace(/^\(\d+\)\s*/, '').replace(/\s*\|\s*LinkedIn$/, '');
  if (!company || !page.endsWith(` | ${company}`)) return null;
  const title = page.slice(0, -` | ${company}`.length).trim();
  if (!title) return null;
  // The pane's top is the label's nearest ancestor holding the title. One that holds the list's cards
  // has climbed out of the pane: the title is still the last job's at the same company, found on its card.
  let top = label.parentElement;
  while (top && !top.textContent?.includes(title)) top = top.parentElement;
  if (!top || top.querySelector(CARDS)) return null;
  const line = [...top.querySelectorAll('p, h1, h2')].find(element => element.textContent?.trim() === title);
  return line ? {jobId, company, title, line} : null;
}

/** The list's cards drawn so far, each with the line its company is on. */
export function readCards(doc: Document = document): Posting[] {
  const cards: Posting[] = [];
  for (const card of doc.querySelectorAll(CARDS)) {
    const key = card.getAttribute('componentkey') ?? '';
    // Each card is keyed twice, one inside the other: the inner one is read.
    if (card.querySelector(`[componentkey="${key}"]`)) continue;
    const dismiss = card.querySelector('[aria-label^="Dismiss "][aria-label$=" job"]')?.getAttribute('aria-label');
    const title = dismiss?.slice('Dismiss '.length, -' job'.length).trim();
    if (!title) continue;
    // The title's line holds it twice, the screen readers' copy with more ("Selected, …", "… (Verified
    // job)"); the company's line comes next.
    const lines = [...card.querySelectorAll('p')];
    const at = lines.findIndex(line => line.textContent?.includes(title));
    const line = at >= 0 ? lines[at + 1] : undefined;
    const company = line?.textContent?.trim();
    if (line && company) cards.push({jobId: key.slice(CARD_KEY.length), company, title, line});
  }
  return cards;
}

/** What a page that should be readable couldn't be read, or null when it read (or expects nothing). */
export type Unread = 'pane' | 'cards' | 'both';

/** The page as read now: what it expects that it couldn't read, the pane, and the cards. */
export function readPage(url: URL, doc: Document = document): {unread: Unread | null; pane: Posting | null; cards: Posting[]} {
  const jobId = jobIdOf(url);
  const pane = jobId && url.pathname.startsWith('/jobs') ? readPane(jobId, doc) : null;
  const cards = url.pathname.startsWith('/jobs') ? readCards(doc) : [];
  const expected = expects(url);
  const paneMissing = expected.pane && !pane;
  const cardsMissing = expected.cards && !cards.length;
  const unread = paneMissing && cardsMissing ? 'both' : paneMissing ? 'pane' : cardsMissing ? 'cards' : null;
  return {unread, pane, cards};
}
