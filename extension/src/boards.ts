// The job boards Setpoint on job boards reads (SV-174, D433; SV-202, D450), each by its own readers,
// picked by the page's host. The manifest's content script matches the same hosts.
import * as indeed from './indeed.ts';
import * as linkedin from './linkedin.ts';
import type {PageRead} from './posting.ts';

/** A board as the badge names it. */
export type BoardName = 'LinkedIn' | 'Indeed';

export interface Board {
  name: BoardName;
  readPage: (url: URL, doc?: Document) => PageRead;
}

const BOARDS: Record<string, Board> = {
  'www.linkedin.com': {name: 'LinkedIn', readPage: linkedin.readPage},
  'www.indeed.com': {name: 'Indeed', readPage: indeed.readPage},
};

/** The board a page is on, or null for a host it doesn't read. */
export const boardOf = (hostname: string): Board | null => BOARDS[hostname] ?? null;
