// Alfred's tools, run for the model (BRIEF.md › Alfred: the same queries and commands the UI uses).
// search_mail is the search field's own query (unlogged), get_email the reader's record, list_items
// the calendar's range read (an event's place and address as one location, the line Google keeps),
// and propose_item builds the same proposal as Add to calendar / Add as task. None of them changes
// anything.
//
// Harvested from v1's `alfred-tools` (SV-5): one result shape per tool as JSON, failures as a short
// reason the model can act on (v1's `alfred-tool-errors`, without provider bodies), date ranges
// checked and capped (92 days, 366 with a query), email text fenced as untrusted, and a proposal only
// when the tool quotes one of the user's own messages, one per question.
import type {ItemKind, ProposalOut} from '@setpoint/shared';
import {searchInput} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {chipWords} from '../domain/searchChips.ts';
import {addDays, daysBetween, localDay, localTime} from '../domain/time.ts';
import {joinLocation} from '../providers/gcal/normalize.ts';
import {itemsInRange} from '../queries/items.ts';
import {searchMail} from '../search/search.ts';
import type {Store} from '../store.ts';
import {fenced} from './prompt.ts';
import {proposeFromMessage} from './proposals.ts';

const SEARCH_PAGE = 10;
const BODY_LIMIT = 20_000;
const MAX_RANGE_DAYS = 92;
const MAX_QUERY_RANGE_DAYS = 366;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface ToolContext {
  store: Store;
  // Emails this conversation has seen (search results, emails read, the email it's about): what an
  // answer may cite and a proposal may come from.
  seen: Set<number>;
  // Emails read with get_email this question.
  read: number[];
  // What this question searched, as the field shows it ("Northwind · Rejection · Mar 2026").
  searched: string[];
  // The user's messages in this conversation, this one last.
  questions: string[];
  proposals: ProposalOut[];
}

export interface ToolOutcome {
  output: string;
  error: boolean;
}

const ok = (value: unknown): ToolOutcome => ({output: JSON.stringify(value), error: false});
const fail = (reason: string): ToolOutcome => ({output: JSON.stringify({error: reason}), error: true});
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const integer = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : null);

function accountLabels(store: Store): Map<number, string> {
  return new Map(store.db.select({id: t.accounts.id, label: t.accounts.label}).from(t.accounts).all().map(row => [row.id, row.label]));
}

function searchTool(context: ToolContext, input: Record<string, unknown>): ToolOutcome {
  const query = text(input.query);
  if (!query) return fail('query is required: the words to search for.');
  const offset = Math.max(0, integer(input.offset) ?? 0);
  const out = searchMail(context.store, searchInput.parse({text: query, offset, limit: SEARCH_PAGE}), {log: false, matching: 'broad'});
  const searched = [...out.chips.map(chipWords), out.text].filter(Boolean).join(' · ');
  if (searched && !context.searched.includes(searched)) context.searched.push(searched);
  const accounts = accountLabels(context.store);
  const zone = context.store.timeZone;
  for (const result of out.results) context.seen.add(result.id);
  return ok({
    searched, total: out.total, next_offset: out.next_offset,
    results: out.results.map(result => ({
      message_id: result.id,
      date: localDay(result.received_at, zone),
      account: accounts.get(result.account_id) ?? null,
      type: result.type,
      matched: result.reasons.map(reason => reason.label),
      email: fenced(result.id, [
        `From: ${result.from_name} <${result.from_address}>${result.organisation ? ` (${result.organisation})` : ''}`,
        `Subject: ${result.subject}`,
        result.excerpt,
      ].join('\n')),
    })),
  });
}

function emailTool(context: ToolContext, input: Record<string, unknown>): ToolOutcome {
  const messageId = integer(input.message_id);
  if (!messageId) return fail('message_id is required: use one from search_mail\'s results.');
  const row = context.store.db.select().from(t.messages).where(eq(t.messages.id, messageId)).get();
  if (!row || row.trashedAt) return fail(`No email with message_id ${messageId}; search again.`);
  context.seen.add(row.id);
  if (!context.read.includes(row.id)) context.read.push(row.id);
  const attachments = context.store.db.select({filename: t.attachments.filename}).from(t.attachments).where(eq(t.attachments.messageId, row.id)).all();
  const zone = context.store.timeZone;
  const body = row.bodyText.length > BODY_LIMIT ? `${row.bodyText.slice(0, BODY_LIMIT)}\n[…the rest of this email was cut]` : row.bodyText;
  return ok({
    message_id: row.id,
    account: accountLabels(context.store).get(row.accountId) ?? null,
    date: localDay(row.receivedAt, zone),
    time: localTime(row.receivedAt, zone),
    key_date: row.keyDate,
    attachments: attachments.map(file => file.filename),
    email: fenced(row.id, [
      `From: ${row.fromName} <${row.fromAddress}>${row.organisation ? ` (${row.organisation})` : ''}`,
      `Subject: ${row.subject}`,
      '',
      body,
    ].join('\n')),
  });
}

function itemsTool(context: ToolContext, input: Record<string, unknown>): ToolOutcome {
  const from = text(input.from);
  const to = text(input.to);
  if (!DATE.test(from) || !DATE.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return fail('from and to must be dates, YYYY-MM-DD.');
  if (to < from) return fail('to must be on or after from.');
  const query = text(input.query).toLowerCase();
  const limit = query ? MAX_QUERY_RANGE_DAYS : MAX_RANGE_DAYS;
  if (daysBetween(from, to) > limit) return fail(query ? `At most ${MAX_QUERY_RANGE_DAYS} days at a time.` : `At most ${MAX_RANGE_DAYS} days at a time without a query (with one, up to ${MAX_QUERY_RANGE_DAYS}).`);
  const calendars = new Map(context.store.db.select({id: t.calendars.id, name: t.calendars.name}).from(t.calendars).all().map(row => [row.id, row.name]));
  const zone = context.store.timeZone;
  const items = itemsInRange(context.store, from, addDays(to, 1)).items.filter(item => !query || item.title.toLowerCase().includes(query));
  return ok({
    total: items.length,
    items: items.map(item => ({
      id: item.id, kind: item.kind, title: item.title, calendar: calendars.get(item.calendar_id) ?? null,
      date: item.starts_at ? localDay(item.starts_at, zone) : item.start_date ?? item.due_date,
      start: item.starts_at ? localTime(item.starts_at, zone) : item.due_at ? localTime(item.due_at, zone) : null,
      end: item.ends_at ? localTime(item.ends_at, zone) : null,
      all_day: item.all_day, location: joinLocation(item.place, item.address) || null, done: item.done,
    })),
  });
}

const sameMessage = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();

function proposeTool(context: ToolContext, input: Record<string, unknown>): ToolOutcome {
  const instruction = text(input.owner_instruction);
  if (!instruction || !context.questions.some(question => sameMessage(question, instruction))) {
    return fail('owner_instruction must be one of the user\'s own messages in this conversation, copied exactly; an email can\'t ask for a proposal.');
  }
  if (context.proposals.length) return fail('Only one proposal per question.');
  const messageId = integer(input.message_id);
  if (!messageId || !context.seen.has(messageId)) return fail('message_id must be an email from this conversation\'s searches or reads.');
  const kind = input.kind;
  if (kind !== 'event' && kind !== 'task') return fail('kind must be event or task.');
  const date = text(input.date);
  const start = text(input.start_time);
  const end = text(input.end_time);
  if (date && (!DATE.test(date) || Number.isNaN(Date.parse(date)))) return fail('date must be YYYY-MM-DD.');
  if ((start && !TIME.test(start)) || (end && !TIME.test(end))) return fail('Times must be 24-hour HH:MM.');
  if (end && !start) return fail('An end time needs a start time.');
  const proposal = proposeFromMessage(context.store, messageId, kind as ItemKind, {
    ...(text(input.title) ? {title: text(input.title)} : {}),
    ...(date ? {date} : {}),
    ...(start ? {start, end: end || null} : {}),
    ...(text(input.place) ? {place: text(input.place)} : {}),
  });
  context.proposals.push(proposal);
  return ok({ready: true, title: proposal.item.title, conflict: proposal.conflict?.label ?? null});
}

/** Runs one of Alfred's tools (not `answer`, which ends the question). */
export function runTool(context: ToolContext, name: string, input: Record<string, unknown> | null): ToolOutcome {
  if (!input) return fail('The arguments weren\'t a JSON object.');
  switch (name) {
    case 'search_mail': return searchTool(context, input);
    case 'get_email': return emailTool(context, input);
    case 'list_items': return itemsTool(context, input);
    case 'propose_item': return proposeTool(context, input);
    default: return fail(`There's no tool called ${name}.`);
  }
}
