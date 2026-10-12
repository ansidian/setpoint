// The sidebar's last-known shape (DESIGN.md › Decided while building #234): the accounts under
// Inbox with their counts, and how many lines Today showed on which day, kept by this browser so
// the next open paints them at once and the answers then settle them in place. Pure: app/lastShape.ts
// keeps it in localStorage.
import type {AccountOut, Colour, MailCountsOut} from '@setpoint/shared';
import {COLOURS} from '@setpoint/shared';

export interface ShapeAccount {
  id: number;
  label: string;
  colour: Colour;
  // Needs sign-in: its `sync_problem` glyph.
  reconnect: boolean;
}

export interface SidebarShape {
  accounts: ShapeAccount[];
  counts: Pick<MailCountsOut, 'attention' | 'unread' | 'accounts'> | null;
  // Today's lines (the event, the tasks, "N more") on the day they were counted.
  today: {date: string; lines: number} | null;
}

const count = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const isAccount = (value: unknown): value is ShapeAccount => {
  const one = value as ShapeAccount | null;
  return typeof one === 'object' && one !== null && count(one.id) && typeof one.label === 'string' && COLOURS.includes(one.colour) && typeof one.reconnect === 'boolean';
};
const isCounts = (value: unknown): value is NonNullable<SidebarShape['counts']> => {
  const counts = value as SidebarShape['counts'];
  return typeof counts === 'object' && counts !== null && count(counts.attention) && count(counts.unread) && Array.isArray(counts.accounts)
    && counts.accounts.every(account => typeof account === 'object' && account !== null && count(account.account_id) && count(account.unread));
};
const isToday = (value: unknown): value is NonNullable<SidebarShape['today']> => {
  const today = value as SidebarShape['today'];
  return typeof today === 'object' && today !== null && typeof today.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(today.date) && count(today.lines);
};

/** The shape as stored, or null for nothing, or anything that isn't one (an older form, a hand edit). */
export function parseShape(text: string | null): SidebarShape | null {
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const shape = value as Partial<SidebarShape> | null;
  if (typeof shape !== 'object' || shape === null || !Array.isArray(shape.accounts) || !shape.accounts.every(isAccount)) return null;
  if (shape.counts !== null && !isCounts(shape.counts)) return null;
  if (shape.today !== null && !isToday(shape.today)) return null;
  return {accounts: shape.accounts, counts: shape.counts ?? null, today: shape.today ?? null};
}

/** What to keep of the sidebar's answers: the accounts in order, and the counts it shows. */
export function shapeOf(accounts: AccountOut[], counts: MailCountsOut | undefined, today: SidebarShape['today']): SidebarShape {
  return {
    accounts: [...accounts].sort((a, b) => a.position - b.position)
      .map(account => ({id: account.id, label: account.label, colour: account.colour, reconnect: account.health.state === 'needs_reconnect'})),
    counts: counts ? {attention: counts.attention, unread: counts.unread, accounts: counts.accounts.map(({account_id, unread}) => ({account_id, unread}))} : null,
    today,
  };
}

/** Today's skeleton lines: as many as it showed today, else three (shell-10). */
export const todayLines = (shape: SidebarShape | null, date: string) => (shape?.today?.date === date ? shape.today.lines : 3);

/** The accounts' skeleton rows on a first visit: three (states-03). */
export const FIRST_ACCOUNTS = 3;
