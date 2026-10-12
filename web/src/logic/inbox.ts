// The Inbox as the list draws it (DESIGN.md › The list; BRIEF.md › The Inbox). The server sends the
// groups in order with their rows and counts (src/domain/inbox.ts there); this decides what the list
// shows of them: which groups the user collapsed (each starts expanded), each row's line, where the
// keyboard cursor can stop, and the counts' at-once changes (DESIGN.md › Interaction rules).
import {INBOX_GROUPS} from '@setpoint/shared';
import type {InboxGroup, InboxGroupOut, InboxOut, MailCountsOut, MessageRowOut, MessageType} from '@setpoint/shared';
import type {IconName} from '../ui/glyphs.ts';
import {countdownChange} from './format.ts';
import type {MailView} from './route.ts';

export const GROUP_LABELS: Record<InboxGroup, string> = {
  pinned: 'Pinned', attention: 'Attention', unsorted: 'Unsorted', security: 'Security', deliveries: 'Deliveries', money: 'Money',
  career: 'Career', people: 'People', updates: 'Updates', other: 'Other', noise: 'Noise',
};

/**
 * Each group's glyph, before its header's label and before All's kind word, so a lane reads at a
 * glance without its word. Shape alone, in the header's `ink3`; only Attention's flag is `caution`, as its
 * count is (Decided while building #119).
 */
export const GROUP_GLYPHS: Record<InboxGroup, IconName> = {
  pinned: 'keep', attention: 'flag', unsorted: 'pending', security: 'lock', deliveries: 'local_shipping', money: 'payments',
  career: 'work', people: 'person', updates: 'notifications', other: 'mail', noise: 'campaign',
};

/** Pinned, Attention and Unsorted always show their rows; every other group has a chevron. */
export const isCollapsible = (group: InboxGroup) => !['pinned', 'attention', 'unsorted'].includes(group);

/**
 * An email that left the server's list during this visit to the view, where it was. Opening an FYI
 * email reads it, and read mail leaves the Inbox; in Unread it keeps its place until the user leaves the
 * view (All, Calendar, another account), so the list doesn't change under them (2026-10-09).
 */
export interface HeldRow {
  group: InboxGroup;
  index: number;
  row: MessageRowOut;
}

export interface GroupView {
  group: InboxGroup;
  label: string;
  count: number;
  collapsible: boolean;
  collapsed: boolean;
  // A collapsed group's first three organisations, "Wingtip Toys · Consolidated Messenger · Southridge Video"; none for Noise, which is a count.
  preview: string | null;
  // The rows shown: none while collapsed.
  rows: MessageRowOut[];
}

/** Collapse as the user left it this session, by group; otherwise expanded. */
export type Collapse = Partial<Record<InboxGroup, boolean>>;

/** The server's groups with the visit's held rows back in their places, in the order they left. */
export const withHeld = (groups: InboxGroupOut[], held: HeldRow[]): InboxGroupOut[] => held.reduce(withOneHeld, groups);

function withOneHeld(groups: InboxGroupOut[], held: HeldRow): InboxGroupOut[] {
  const present = groups.find(group => group.group === held.group);
  if (present?.rows.some(row => row.id === held.row.id)) return groups;
  if (!present) {
    const order = INBOX_GROUPS.indexOf(held.group);
    const at = groups.findIndex(group => INBOX_GROUPS.indexOf(group.group) > order);
    const added: InboxGroupOut = {group: held.group, count: 1, unread: 0, rows: [held.row]};
    return at < 0 ? [...groups, added] : [...groups.slice(0, at), added, ...groups.slice(at)];
  }
  return groups.map(group => {
    if (group !== present) return group;
    const rows = [...group.rows];
    rows.splice(Math.min(held.index, rows.length), 0, held.row);
    return {...group, count: group.count + 1, rows};
  });
}

/** A collapsed group's first three senders, newest first. */
function previewOf(group: InboxGroupOut): string | null {
  const names = [...new Set(group.rows.map(sender))];
  return names.length ? names.slice(0, 3).join(' · ') : null;
}

/**
 * The held rows once the server's list changes from what was shown: each row that left it is held
 * where it was, read, unless it was taken out here (Done, Trash, Mark all as read); one back in the
 * list, or taken out, is let go. The Pinned shelf neither holds a row nor counts as its place, so
 * pinning a held email and unpinning it leaves it where it was (SV-24).
 */
export function keepShown(shown: InboxGroupOut[], groups: InboxGroupOut[], held: HeldRow[], takenOut: ReadonlySet<number>): HeldRow[] {
  const present = new Set(groups.filter(group => group.group !== 'pinned').flatMap(group => group.rows.map(row => row.id)));
  const next = held.filter(one => !present.has(one.row.id) && !takenOut.has(one.row.id));
  const kept = new Set(next.map(one => rowKey(one.group, one.row.id)));
  for (const group of shown.filter(one => one.group !== 'pinned')) {
    group.rows.forEach((row, index) => {
      if (present.has(row.id) || takenOut.has(row.id) || kept.has(rowKey(group.group, row.id))) return;
      next.push({group: group.group, index, row: {...row, unread: false}});
    });
  }
  return next;
}

/** The Inbox without the emails Trash is taking out, before the server's list leaves them out too; a group they leave empty goes. */
export function withoutEmails(groups: InboxGroupOut[], ids: ReadonlySet<number>): InboxGroupOut[] {
  if (!ids.size) return groups;
  return groups.flatMap(group => {
    const rows = group.rows.filter(row => !ids.has(row.id));
    if (rows.length === group.rows.length) return [group];
    if (!rows.length) return [];
    const gone = group.rows.filter(row => ids.has(row.id));
    return [{...group, rows, count: group.count - gone.length, unread: group.unread - gone.filter(row => row.unread).length}];
  });
}

export function groupViews(groups: InboxGroupOut[], collapse: Collapse, held: HeldRow[]): GroupView[] {
  return withHeld(groups, held).map(group => {
    const collapsible = isCollapsible(group.group);
    const collapsed = collapsible && (collapse[group.group] ?? false);
    return {
      group: group.group, label: GROUP_LABELS[group.group], count: group.count, collapsible, collapsed,
      preview: collapsed && group.group !== 'noise' ? previewOf(group) : null,
      rows: collapsed ? [] : group.rows,
    };
  });
}

/** Where J and K stop: each row shown, and each collapsed group's header (Enter expands it). */
// All's rows (logic/all.ts) are stops too, under the group 'all', and so is a day's folded Noise.
export type Stop = {key: string; kind: 'row'; group: InboxGroup | 'all'; id: number} | {key: string; kind: 'group'; group: InboxGroup} | {key: string; kind: 'noise'; date: string};

/** All's stops: every row, newest first, by its id. */
export const allStops = (rows: MessageRowOut[]): Stop[] => rows.map(row => ({key: `all:${row.id}`, kind: 'row', group: 'all', id: row.id}));

export const rowKey = (group: InboxGroup, id: number) => `${group}:${id}`;
export const groupKey = (group: InboxGroup) => `group:${group}`;

export function cursorStops(views: GroupView[]): Stop[] {
  return views.flatMap((view): Stop[] => (view.collapsed
    ? [{key: groupKey(view.group), kind: 'group', group: view.group}]
    : view.rows.map(row => ({key: rowKey(view.group, row.id), kind: 'row', group: view.group, id: row.id}))));
}

/** J (+1) and K (−1) from `current`; with no cursor yet, either starts at the top. Stays at the ends. */
export function moveCursor(stops: Stop[], current: string | null, delta: 1 | -1): string | null {
  if (!stops.length) return null;
  const at = current === null ? -1 : stops.findIndex(stop => stop.key === current);
  if (at < 0) return stops[0]!.key;
  return stops[Math.max(0, Math.min(stops.length - 1, at + delta))]!.key;
}

/**
 * The cursor once the list changed: where it was if still there, else the stop that took its place
 * (the next one that remains, or the one before at the end), else none.
 */
export function keepCursor(before: Stop[], after: Stop[], current: string | null): string | null {
  if (current === null) return null;
  const remaining = new Set(after.map(stop => stop.key));
  if (remaining.has(current)) return current;
  const at = before.findIndex(stop => stop.key === current);
  if (at < 0) return null;
  for (const stop of before.slice(at + 1)) if (remaining.has(stop.key)) return stop.key;
  for (const stop of before.slice(0, at).reverse()) if (remaining.has(stop.key)) return stop.key;
  return null;
}

/** The stop of an email, in the first group that shows it (the Pinned shelf, then its own). */
export function stopOf(stops: Stop[], id: number): Stop | null {
  return stops.find(stop => stop.kind === 'row' && stop.id === id) ?? null;
}

/** The email after (+1) or before (−1) `id` among the rows, for the reader's ↑ ↓. */
export function neighbour(stops: Stop[], id: number, delta: 1 | -1): number | null {
  const rows = stops.filter((stop): stop is Extract<Stop, {kind: 'row'}> => stop.kind === 'row');
  const at = rows.findIndex(stop => stop.id === id);
  if (at < 0) return null;
  return rows[at + delta]?.id ?? null;
}

/** Who a row is from: the organisation ("Northwind Talent"), else the sender's name. */
export const sender = (row: Pick<MessageRowOut, 'organisation' | 'from_name'>) => row.organisation ?? row.from_name;

/**
 * A one-line row's text: its lead, then " · " and the rest in `ink3`. The summary, when triage wrote
 * one, takes the subject's place, and the subject moves to the row's tooltip (SV-25); otherwise the
 * subject leads. A security row's lead is its decisive fact ("New sign-in · MacBook Pro · Los
 * Angeles"); a code row shows its code. The platform ("via Workday") ends the line, as the Attention
 * row has it after the sender.
 */
export interface RowLine {
  from: string;
  subject: string;
  summary: string | null;
  code: {value: string; expires_at: string} | null;
  title: string | null;
}

export function rowLine(row: MessageRowOut): RowLine {
  const from = sender(row);
  if (row.code) return {from, subject: row.subject, summary: null, code: row.code, title: null};
  if (row.fact) {
    const [what, ...rest] = row.fact.split(' · ');
    return {from, subject: what ?? row.fact, summary: rest.length ? rest.join(' · ') : null, code: null, title: null};
  }
  const via = row.via ? `via ${row.via}` : null;
  if (row.summary) return {from, subject: row.summary, summary: via, code: null, title: row.subject};
  return {from, subject: row.subject, summary: via, code: null, title: null};
}

/** Each email's rows, wherever the Inbox shows it. */
function rowsOf(inbox: InboxOut, id: number): {group: InboxGroupOut; row: MessageRowOut}[] {
  return inbox.groups.flatMap(group => group.rows.filter(row => row.id === id).map(row => ({group, row})));
}

function countsAfter(counts: MailCountsOut, row: MessageRowOut, change: {read: boolean; leavesAttention: boolean}): MailCountsOut {
  const read = change.read && row.unread;
  return {
    attention: counts.attention - (change.leavesAttention ? 1 : 0),
    unread: counts.unread - (read ? 1 : 0),
    unread_fyi: counts.unread_fyi - (read && row.lane === 'fyi' ? 1 : 0),
    accounts: counts.accounts.map(account => (read && account.account_id === row.account_id ? {...account, unread: account.unread - 1} : account)),
  };
}

/**
 * Opening an unread email reads it: the unread counts drop at once, its account's too; the
 * attention pill doesn't (it drops only on Done). The row stays where it is, read.
 */
export function countsAfterOpen(counts: MailCountsOut, row: MessageRowOut): MailCountsOut {
  return countsAfter(counts, row, {read: true, leavesAttention: false});
}

export function inboxAfterOpen(inbox: InboxOut, id: number): InboxOut {
  const found = rowsOf(inbox, id)[0];
  if (!found?.row.unread) return inbox;
  return {
    ...inbox,
    groups: inbox.groups.map(group => (group.rows.some(row => row.id === id)
      ? {...group, unread: group.unread - 1, rows: group.rows.map(row => (row.id === id ? {...row, unread: false} : row))}
      : group)),
    counts: countsAfterOpen(inbox.counts, found.row),
  };
}

/**
 * Done takes an email out of the Inbox's lane groups (the Pinned shelf keeps a pinned one): the
 * attention pill drops if it was in Attention, and an unread one leaves the unread counts with it.
 */
export function countsAfterDone(counts: MailCountsOut, row: MessageRowOut, wasAttention: boolean): MailCountsOut {
  return countsAfter(counts, row, {read: true, leavesAttention: wasAttention});
}

export function inboxAfterDone(inbox: InboxOut, id: number): InboxOut {
  const found = rowsOf(inbox, id).find(({group}) => group.group !== 'pinned');
  if (!found) return inbox;
  const wasAttention = found.group.group === 'attention';
  const groups = inbox.groups.flatMap(group => {
    if (group.group === 'pinned' || !group.rows.some(row => row.id === id)) return [group];
    const rows = group.rows.filter(row => row.id !== id);
    return rows.length ? [{...group, count: group.count - 1, unread: group.unread - (found.row.unread ? 1 : 0), rows}] : [];
  });
  return {...inbox, groups, counts: countsAfterDone(inbox.counts, found.row, wasAttention)};
}

/**
 * Pin puts an email on the Pinned shelf, newest pin first, and leaves it in its group too (the
 * server's rule); Unpin takes it off the shelf. Shown at once, before the server answers. An email
 * the Inbox doesn't hold (pinned from All) comes from `from`, onto the shelves of its account's Inbox.
 */
export function inboxAfterPin(inbox: InboxOut, id: number, pinned: boolean, from: MessageRowOut | null = null): InboxOut {
  const outside = from && (inbox.account_id === null || inbox.account_id === from.account_id) ? from : undefined;
  const found = rowsOf(inbox, id).find(({group}) => group.group !== 'pinned')?.row ?? rowsOf(inbox, id)[0]?.row ?? outside;
  if (!found) return inbox;
  const flagged = (rows: MessageRowOut[]) => rows.map(row => (row.id === id ? {...row, pinned} : row));
  const rest = inbox.groups.filter(group => group.group !== 'pinned').map(group => ({...group, rows: flagged(group.rows)}));
  const shelf = inbox.groups.find(group => group.group === 'pinned');
  const rows = (shelf?.rows ?? []).filter(row => row.id !== id);
  if (pinned) rows.unshift({...found, pinned: true});
  if (!rows.length) return {...inbox, groups: rest};
  const pinnedGroup: InboxGroupOut = {group: 'pinned', count: rows.length, unread: rows.filter(row => row.unread).length, rows};
  return {...inbox, groups: [pinnedGroup, ...rest]};
}

/** A Security row (a code, a sign-in alert): Mark all as read leaves it unread (UX #4). */
const isSecurity = (row: MessageRowOut) => row.lane === 'fyi' && row.kind === 'security';

/**
 * Mark all as read (for one account, or all): every unread email outside Attention and Security reads. FYI and
 * Noise rows leave, as read mail does; Unsorted and the Pinned shelf keep theirs, read; Attention is
 * untouched. The counts drop by each email that read.
 */
export function inboxAfterMarkAllRead(inbox: InboxOut, account: number | null): InboxOut {
  const reads = (row: MessageRowOut, group: InboxGroup) => row.unread && group !== 'attention' && !isSecurity(row) && (account === null || row.account_id === account);
  const read = new Map<number, MessageRowOut>();
  const groups = inbox.groups.flatMap(group => {
    if (group.group === 'attention') return [group];
    for (const row of group.rows) if (reads(row, group.group)) read.set(row.id, row);
    if (group.group === 'pinned' || group.group === 'unsorted') {
      const rows = group.rows.map(row => (reads(row, group.group) ? {...row, unread: false} : row));
      return [{...group, rows, unread: rows.filter(row => row.unread).length}];
    }
    const rows = group.rows.filter(row => !reads(row, group.group));
    return rows.length ? [{...group, rows, count: group.count - (group.rows.length - rows.length), unread: rows.filter(row => row.unread).length}] : [];
  });
  return {...inbox, groups, counts: [...read.values()].reduce((counts, row) => countsAfterOpen(counts, row), inbox.counts)};
}

/**
 * The emails Mark all as read reads, as the server picks them: unread, outside Attention unless Done,
 * and outside Security (UX #4); each once, though the Pinned shelf shows it twice. Its toast counts
 * them, and Undo marks them unread again.
 */
export const markAllReadIds = (groups: InboxGroupOut[]): number[] =>
  [...new Set(groups.flatMap(group => group.rows.filter(row => row.unread && !(row.lane === 'attention' && !row.done) && !isSecurity(row)).map(row => row.id)))];

/** Mark unread (⌘K): its dot comes back where it shows, and it counts as unread again. */
export function inboxAfterUnread(inbox: InboxOut, id: number): InboxOut {
  const found = rowsOf(inbox, id)[0];
  if (!found || found.row.unread) return inbox;
  const row = found.row;
  const counts = inbox.counts;
  return {
    ...inbox,
    groups: inbox.groups.map(group => (group.rows.some(one => one.id === id)
      ? {...group, unread: group.unread + 1, rows: group.rows.map(one => (one.id === id ? {...one, unread: true} : one))}
      : group)),
    counts: {
      ...counts, unread: counts.unread + 1, unread_fyi: counts.unread_fyi + (row.lane === 'fyi' ? 1 : 0),
      accounts: counts.accounts.map(one => (one.account_id === row.account_id ? {...one, unread: one.unread + 1} : one)),
    },
  };
}

/**
 * The view going to the Inbox opens (D106): Unread while anything waits there, an unread email or
 * Attention not yet Done, else All. An account's Inbox counts its own unread mail; the Attention
 * count is every account's, so it keeps Unread. Before the counts have come, Unread.
 */
export function arrivalView(counts: MailCountsOut | undefined, account: number | null = null): MailView {
  if (!counts) return 'unread';
  const unread = account === null ? counts.unread : counts.accounts.find(one => one.account_id === account)?.unread ?? 0;
  return unread > 0 || counts.attention > 0 ? 'unread' : 'all';
}

/**
 * Whether nothing waits: nothing in Attention, nothing unread and no read row Unread still holds
 * (DESIGN.md #20), so the list says "All caught up".
 */
export function caughtUp(groups: InboxGroupOut[], held: HeldRow[]): boolean {
  return withHeld(groups, held).every(group => group.group === 'pinned');
}

/**
 * Whether a row shows its change waiting for the provider (.5 opacity). Opening an email reads it
 * by the way, so its mark-read waits quietly; a change the user asked for (Trash, Mark all as read, Mark
 * unread) shows until the provider confirms it.
 */
export const showsPending = (row: Pick<MessageRowOut, 'command'>) => row.command?.state === 'pending' && row.command.kind !== 'open';

/**
 * The email that opens after Done or Trash on the open one (2026-10-07, replacing part of
 * D10): the next email row in list order, the one that takes its place, skipping group headers and
 * collapsed groups and the same email shown again (the Pinned shelf). None at the end: the reader
 * closes.
 */
export function nextAfterLeaving(stops: Stop[], key: string | null, id: number): number | null {
  const rows = stops.filter((stop): stop is Extract<Stop, {kind: 'row'}> => stop.kind === 'row');
  let at = key === null ? -1 : rows.findIndex(stop => stop.key === key && stop.id === id);
  if (at < 0) at = rows.findIndex(stop => stop.id === id);
  if (at < 0) return null;
  return rows.slice(at + 1).find(stop => stop.id !== id)?.id ?? null;
}

/** Whether a code's row has expired: it leaves the Inbox then (DESIGN.md › The list), before the server's next answer. */
export const codeExpired = (row: Pick<MessageRowOut, 'code'>, now: number) => row.code !== null && Date.parse(row.code.expires_at) <= now;

/**
 * The next moment a code row changes by itself, its countdown's words or its leaving at expiry, so
 * the list moves on then rather than on the app's next 15 s tick; null with no code showing.
 */
export function nextCodeChange(rows: Pick<MessageRowOut, 'code'>[], now: number): number | null {
  const moments = rows.flatMap(row => {
    const at = row.code ? countdownChange(row.code.expires_at, now) : null;
    return at === null ? [] : [at];
  });
  return moments.length ? Math.min(...moments) : null;
}

/** The Inbox without code rows past their expiry; a group they leave empty goes too. */
export function withoutExpiredCodes(groups: InboxGroupOut[], now: number): InboxGroupOut[] {
  if (!groups.some(group => group.rows.some(row => codeExpired(row, now)))) return groups;
  return groups.flatMap(group => {
    const rows = group.rows.filter(row => !codeExpired(row, now));
    if (rows.length === group.rows.length) return [group];
    if (!rows.length) return [];
    return [{...group, rows, count: rows.length, unread: rows.filter(row => row.unread).length}];
  });
}

/**
 * A pattern prompt (BRIEF.md › Triage; DESIGN.md › Pattern prompt): mail of one organisation and
 * type that the user keeps marking Done from the row without opening. B3 offers these; until it does
 * there's no route for them in @setpoint/shared, so this is the shape the web expects.
 */
export interface PatternPrompt {
  id: number;
  organisation: string;
  type: MessageType | null;
  count: number;
  protected?: boolean;
}

const TYPE_PLURALS: Record<MessageType, string> = {
  confirmation: 'confirmations', rejection: 'rejections', receipt: 'receipts', shipping: 'shipping updates', deadline: 'deadlines',
  reminder: 'reminders', verification_code: 'codes', alert: 'alerts', newsletter: 'newsletters', statement: 'statements',
};

/** "You've cleared 4 Northwind newsletters without opening them. Send these to FYI from now on?" */
export const promptText = (prompt: PatternPrompt) =>
  `You've cleared ${prompt.count} ${prompt.organisation} ${prompt.type ? TYPE_PLURALS[prompt.type] : 'emails'} without opening them. Send these to FYI from now on?`;

/** The one prompt Attention shows: the first not answered here, never one about protected mail. */
export function visiblePrompt(prompts: PatternPrompt[] | undefined, answered: ReadonlySet<number>): PatternPrompt | null {
  return prompts?.find(prompt => !prompt.protected && !answered.has(prompt.id) && prompt.count > 0) ?? null;
}

// The 7 px dot, its 6 px gap and a pixel for the type's rounding.
const ACCOUNT_DOT = 14;
const ACCOUNT_LEAST = 76;
const ACCOUNT_MOST = 160;

/**
 * The rows' account column: the longest label (its width at 12 px) with its dot, so every row's
 * account lines up and none runs into the age; 76 px at least, 160 at most, a longer label cut.
 */
export function accountColumn(labelWidths: number[]): number {
  return Math.min(ACCOUNT_MOST, Math.max(ACCOUNT_LEAST, Math.ceil(Math.max(0, ...labelWidths) + ACCOUNT_DOT)));
}
