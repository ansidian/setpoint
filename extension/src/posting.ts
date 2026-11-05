// What every board's readers give the content script (SV-174, SV-202): the postings on a page, each
// with the line its chip goes at the end of, and what the page should have let them read but didn't.

/** A posting as the board shows it, and the line its chip goes at the end of. */
export interface Posting {
  jobId: string;
  company: string;
  title: string;
  line: Element;
}

/** What a page that should be readable couldn't be read, or null when it read (or expects nothing). */
export type Unread = 'pane' | 'cards' | 'both';

/** A page as read now: what it expects that it couldn't read, the job pane, and the list's cards. */
export interface PageRead {
  unread: Unread | null;
  pane: Posting | null;
  cards: Posting[];
}

/** What a page expected to read and didn't. */
export function unreadOf(expected: {pane: boolean; cards: boolean}, pane: Posting | null, cards: Posting[]): Unread | null {
  const paneMissing = expected.pane && !pane;
  const cardsMissing = expected.cards && !cards.length;
  return paneMissing && cardsMissing ? 'both' : paneMissing ? 'pane' : cardsMissing ? 'cards' : null;
}
