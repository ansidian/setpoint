// Alfred's tools, run for the model (the same queries and commands the UI uses).
// search_mail is the search field's own query (unlogged), sent mail included. get_email is the reader's record,
// with the other emails of its thread (the reader's conversation), which it may then read and cite.
// list_items is the calendar's range read (an event's place and address as one location, the line
// Google keeps). search_calendar is Calendar's own search, with undated Todoist tasks too.
// propose_item builds the same proposal as Add to calendar / Add as task, from an email or from the
// user's words alone. propose_change prepares a change to an existing item for the editor's Save.
// read_attachment hands the model a PDF attached to an email it has seen, as a document. A module's
// registered tools (Jobs' search_jobs and get_application) run here too. None of them changes anything.
//
// Each tool has one result shape as JSON. A failure is a short reason the model can act on (without
// provider bodies). Date ranges are checked and capped (92 days, 366 with a query). Email text is
// fenced as untrusted. A proposal (a new item or a change) comes only when the tool quotes one of
// the user's own messages, one per question.
import type {AnswerApplicationOut, AnswerItemOut, ItemKind, ItemOut, ProposalOut, RecurringScope} from '@setpoint/shared';
import {calendarSearchInput, RECURRING_SCOPES, searchInput} from '@setpoint/shared';
import {and, asc, eq} from 'drizzle-orm';
import {bodyOf} from '../db/bodies.ts';
import * as t from '../db/schema.ts';
import {chipWords} from '../domain/searchChips.ts';
import {addDays, daysBetween, localDay, localTime} from '../domain/time.ts';
import {joinLocation} from '../providers/gcal/normalize.ts';
import {itemDetail, itemsInRange} from '../queries/items.ts';
import {conversationOf} from '../queries/thread.ts';
import {searchCalendar} from '../search/calendar.ts';
import {searchMail} from '../search/search.ts';
import type {Store} from '../store.ts';
import {fenced} from './prompt.ts';
import {proposeChange, proposeFromMessage, proposeFromWords} from './proposals.ts';
import type {AlfredRegistration} from './registered.ts';
import type {ChangeEdits} from './proposals.ts';
import type {Invite} from './proposals.ts';

const SEARCH_PAGE = 10;
const CALENDAR_PAGE = 20;
const BODY_LIMIT = 20_000;
const MAX_RANGE_DAYS = 92;
const MAX_QUERY_RANGE_DAYS = 366;
/** The biggest PDF read_attachment reads (10 MB). */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
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
  // The invite of an email a proposal is asked for, read before the tool runs (the tools
  // themselves don't wait on a provider). An email with none has null or no entry.
  invites?: Map<number, Invite | null>;
  // A PDF's bytes by attachment id, read before read_attachment runs, as the invites are. Null when
  // the provider couldn't give them.
  files?: Map<number, Uint8Array | null>;
  // The attachments read this question, each read once.
  documents?: Set<number>;
  // The events and tasks list_items and search_calendar gave this question, by key: what an answer may cite.
  items?: Map<string, AnswerItemOut>;
  // The registered tools on for this question (Jobs'), and the applications they gave, by id: what
  // an answer may cite.
  registered?: AlfredRegistration[];
  applications?: Map<number, AnswerApplicationOut>;
}

export interface ToolOutcome {
  output: string;
  error: boolean;
  // A PDF for the model, sent with the result (read_attachment's).
  document?: {data: string; title: string};
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
  // Mail the user sent is searched too, so an earlier reply can be found.
  const out = searchMail(context.store, searchInput.parse({text: query, offset, limit: SEARCH_PAGE, sent: 'include'}), {log: false, matching: 'broad'});
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
        ...(result.sent_only ? [`To: ${result.to ? result.to.map(one => (one.name ? `${one.name} <${one.address}>` : one.address)).join(', ') : 'unknown'}`] : []),
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
  const attachments = context.store.db.select({attachment_id: t.attachments.id, filename: t.attachments.filename, mime_type: t.attachments.mimeType, size_bytes: t.attachments.sizeBytes})
    .from(t.attachments).where(eq(t.attachments.messageId, row.id)).orderBy(asc(t.attachments.id)).all();
  const zone = context.store.timeZone;
  const thread = conversationOf(context.store, row);
  for (const other of thread) context.seen.add(other.id);
  const {bodyText} = bodyOf(context.store.db, row.id);
  const body = bodyText.length > BODY_LIMIT ? `${bodyText.slice(0, BODY_LIMIT)}\n[…the rest of this email was cut]` : bodyText;
  return ok({
    message_id: row.id,
    account: accountLabels(context.store).get(row.accountId) ?? null,
    date: localDay(row.receivedAt, zone),
    time: localTime(row.receivedAt, zone),
    key_date: row.keyDate,
    attachments,
    email: fenced(row.id, [
      `From: ${row.fromName} <${row.fromAddress}>${row.organisation ? ` (${row.organisation})` : ''}`,
      `Subject: ${row.subject}`,
      '',
      body,
    ].join('\n')),
    // The thread's other emails, oldest first, the user's own replies marked sent. Their sender and
    // subject are fenced like a search result's.
    thread: thread.map(other => ({
      message_id: other.id, sent: other.sent, date: localDay(other.received_at, zone),
      email: fenced(other.id, [`From: ${other.from_name} <${other.from_address}>`, `Subject: ${other.subject}`].join('\n')),
    })),
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
  const calendars = calendarNames(context.store);
  const items = itemsInRange(context.store, from, addDays(to, 1)).items.filter(item => !query || item.title.toLowerCase().includes(query));
  return ok({total: items.length, items: items.map(item => citable(context, item, calendars))});
}

const calendarNames = (store: Store) => new Map(store.db.select({id: t.calendars.id, name: t.calendars.name}).from(t.calendars).all().map(row => [row.id, row.name]));

/** An item as the calendar tools give it to the model, kept by key for the answer to cite. */
function citable(context: ToolContext, item: ItemOut, calendars: Map<number, string>) {
  const zone = context.store.timeZone;
  const date = item.starts_at ? localDay(item.starts_at, zone) : item.start_date ?? item.due_date;
  context.items?.set(item.key, {
    key: item.key, id: item.id, kind: item.kind, calendar_id: item.calendar_id, title: item.title, date,
    start: item.all_day ? null : item.starts_at ?? item.due_at, all_day: item.all_day, occurrence_start: item.occurrence_start,
  });
  return {
    key: item.key, id: item.id, kind: item.kind, title: item.title, calendar: calendars.get(item.calendar_id) ?? null,
    date, start: item.starts_at ? localTime(item.starts_at, zone) : item.due_at ? localTime(item.due_at, zone) : null,
    end: item.ends_at ? localTime(item.ends_at, zone) : null,
    all_day: item.all_day, location: joinLocation(item.place, item.address) || null, done: item.done,
    ...(item.recurring ? {recurring: true} : {}), ...(item.project ? {project: item.project} : {}),
  };
}

function searchCalendarTool(context: ToolContext, input: Record<string, unknown>): ToolOutcome {
  const query = text(input.query);
  if (!query) return fail('query is required: the words to search for.');
  const offset = Math.max(0, integer(input.offset) ?? 0);
  const out = searchCalendar(context.store, calendarSearchInput.parse({text: query.slice(0, 500), offset, limit: CALENDAR_PAGE}), {undated: true});
  const searched = [...out.chips.map(chip => chip.label), out.text].filter(Boolean).join(' · ');
  if (searched && !context.searched.includes(searched)) context.searched.push(searched);
  const calendars = calendarNames(context.store);
  const matched = (reasons: {key: string; value: string}[]) => reasons.map(reason => `${reason.key} ${reason.value}`);
  return ok({
    searched, total: out.total, next_offset: out.next_offset,
    results: out.results.map(result => ({...citable(context, result.item, calendars), upcoming: result.upcoming, matched: matched(result.reasons)})),
    // Todoist tasks with no date that match, on the first page only.
    undated: offset ? [] : out.undated.map(hit => ({...citable(context, hit.item, calendars), matched: matched(hit.reasons)})),
  });
}

const sameMessage = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();

/** Why a proposal can't be made for this question, or null: it must quote the user, once a question. */
function proposalRefused(context: ToolContext, input: Record<string, unknown>): ToolOutcome | null {
  const instruction = text(input.owner_instruction);
  if (!instruction || !context.questions.some(question => sameMessage(question, instruction))) {
    return fail('owner_instruction must be one of the user\'s own messages in this conversation, copied exactly; an email can\'t ask for a proposal.');
  }
  if (context.proposals.length) return fail('Only one proposal per question.');
  return null;
}

function proposeTool(context: ToolContext, input: Record<string, unknown>): ToolOutcome {
  const refused = proposalRefused(context, input);
  if (refused) return refused;
  // With no email, the proposal is the user's words alone.
  const messageId = input.message_id === undefined || input.message_id === null ? null : integer(input.message_id);
  if (messageId !== null && (!messageId || !context.seen.has(messageId))) return fail('message_id must be an email from this conversation\'s searches or reads; leave it out for a proposal from the user\'s words.');
  const kind = input.kind;
  if (kind !== 'event' && kind !== 'task') return fail('kind must be event or task.');
  const date = text(input.date);
  const start = text(input.start_time);
  const end = text(input.end_time);
  if (date && (!DATE.test(date) || Number.isNaN(Date.parse(date)))) return fail('date must be YYYY-MM-DD.');
  if ((start && !TIME.test(start)) || (end && !TIME.test(end))) return fail('Times must be 24-hour HH:MM.');
  if (end && !start) return fail('An end time needs a start time.');
  if (messageId === null) {
    if (!text(input.title)) return fail('title is required for a proposal from the user\'s words.');
    const proposal = proposeFromWords(context.store, kind as ItemKind, {title: text(input.title), date: date || null, start: start || null, end: start ? end || null : null, place: text(input.place) || null});
    context.proposals.push(proposal);
    return ok({ready: true, title: proposal.item.title, conflict: proposal.conflict?.label ?? null});
  }
  const proposal = proposeFromMessage(context.store, messageId, kind as ItemKind, {
    ...(text(input.title) ? {title: text(input.title)} : {}),
    ...(date ? {date} : {}),
    ...(start ? {start, end: end || null} : {}),
    ...(text(input.place) ? {place: text(input.place)} : {}),
  }, context.invites?.get(messageId) ?? null);
  context.proposals.push(proposal);
  return ok({ready: true, title: proposal.item.title, conflict: proposal.conflict?.label ?? null});
}

/**
 * The item a key names (a recurring event's occurrence by "id@start"), as the calendar shows it, or
 * null when there's no such item or occurrence.
 */
function itemByKey(store: Store, key: string): ItemOut | null {
  const match = /^(\d+)(?:@(.+))?$/.exec(key);
  if (!match) return null;
  if (!match[2]) {
    try {
      return itemDetail(store, Number(match[1]));
    } catch {
      return null;
    }
  }
  const start = Date.parse(match[2]);
  if (Number.isNaN(start)) return null;
  const day = localDay(new Date(start).toISOString(), store.timeZone);
  return itemsInRange(store, addDays(day, -1), addDays(day, 2)).items.find(item => item.key === key) ?? null;
}

function proposeChangeTool(context: ToolContext, input: Record<string, unknown>): ToolOutcome {
  const refused = proposalRefused(context, input);
  if (refused) return refused;
  const key = text(input.key);
  const item = key ? itemByKey(context.store, key) : null;
  if (!item) return fail('key must be an event or task\'s key from search_calendar or list_items (a recurring event\'s occurrence by its own key from list_items).');
  if (item.read_only) return fail(`${item.title} is one of Google's own kinds of event; it can't be changed here.`);
  const scope = input.scope === undefined ? 'this' : input.scope;
  if (!(RECURRING_SCOPES as readonly unknown[]).includes(scope)) return fail('scope must be this, following or all.');
  const date = text(input.date);
  const start = text(input.start_time);
  const end = text(input.end_time);
  if (date && (!DATE.test(date) || Number.isNaN(Date.parse(date)))) return fail('date must be YYYY-MM-DD.');
  if ((start && !TIME.test(start)) || (end && !TIME.test(end))) return fail('Times must be 24-hour HH:MM.');
  const edits: ChangeEdits = {
    ...(text(input.title) ? {title: text(input.title)} : {}),
    ...(date ? {date} : {}), ...(start ? {start} : {}), ...(end ? {end} : {}),
    ...(input.all_day === true ? {all_day: true} : {}),
    ...(typeof input.place === 'string' ? {place: input.place.trim() || null} : {}),
  };
  if (!Object.keys(edits).length) return fail('Say what changes: title, date, start_time, end_time, all_day or place.');
  let proposal: ProposalOut | null;
  try {
    proposal = proposeChange(context.store, item, edits, scope as RecurringScope);
  } catch (error) {
    return fail((error as Error).message);
  }
  if (!proposal) return fail(`That's how ${item.title} already is; nothing would change.`);
  context.proposals.push(proposal);
  return ok({ready: true, title: item.title, changes: Object.keys(proposal.change!.changes), scope: proposal.change!.scope, conflict: proposal.conflict?.label ?? null});
}

const isPdf = (file: {filename: string; mimeType: string}) => file.mimeType.toLowerCase() === 'application/pdf' || /\.pdf$/i.test(file.filename);

/**
 * The attachment a read_attachment call asks for, when it's a PDF within the cap on an email this
 * conversation has seen: the one ask.ts reads the bytes of before the tool runs. Otherwise a reason.
 */
export function attachmentAsked(context: ToolContext, input: Record<string, unknown> | null): {messageId: number; id: number; filename: string} | {reason: string} {
  const messageId = integer(input?.message_id);
  const attachmentId = integer(input?.attachment_id);
  if (!messageId || !attachmentId) return {reason: 'message_id and attachment_id are required: use them from get_email\'s attachments.'};
  if (!context.seen.has(messageId)) return {reason: 'message_id must be an email from this conversation\'s searches or reads.'};
  const file = context.store.db.select({id: t.attachments.id, filename: t.attachments.filename, mimeType: t.attachments.mimeType, sizeBytes: t.attachments.sizeBytes})
    .from(t.attachments).where(and(eq(t.attachments.id, attachmentId), eq(t.attachments.messageId, messageId))).get();
  if (!file) return {reason: `That email has no attachment ${attachmentId}; use one from get_email's attachments.`};
  if (!isPdf(file)) return {reason: `${file.filename} isn't a PDF; only PDFs can be read.`};
  if (file.sizeBytes > MAX_PDF_BYTES) return {reason: `${file.filename} is over 10 MB, too big to read.`};
  return {messageId, id: file.id, filename: file.filename};
}

function readAttachmentTool(context: ToolContext, input: Record<string, unknown>): ToolOutcome {
  const asked = attachmentAsked(context, input);
  if ('reason' in asked) return fail(asked.reason);
  if (context.documents?.has(asked.id)) return fail(`${asked.filename} was already read for this question; it's above.`);
  const bytes = context.files?.get(asked.id) ?? null;
  if (!bytes) return fail(`The provider no longer has ${asked.filename}.`);
  if (bytes.byteLength > MAX_PDF_BYTES) return fail(`${asked.filename} is over 10 MB, too big to read.`);
  context.documents?.add(asked.id);
  return {...ok({message_id: asked.messageId, filename: asked.filename}), document: {data: Buffer.from(bytes).toString('base64'), title: asked.filename}};
}

/** Runs one of Alfred's tools (not `answer`, which ends the question). */
export function runTool(context: ToolContext, name: string, input: Record<string, unknown> | null): ToolOutcome {
  if (!input) return fail('The arguments weren\'t a JSON object.');
  switch (name) {
    case 'search_mail': return searchTool(context, input);
    case 'get_email': return emailTool(context, input);
    case 'read_attachment': return readAttachmentTool(context, input);
    case 'list_items': return itemsTool(context, input);
    case 'search_calendar': return searchCalendarTool(context, input);
    case 'propose_item': return proposeTool(context, input);
    case 'propose_change': return proposeChangeTool(context, input);
    default: {
      const owner = context.registered?.find(one => one.tools.some(tool => tool.name === name));
      if (!owner) return fail(`There's no tool called ${name}.`);
      const applications = context.applications ?? (context.applications = new Map());
      return owner.run({store: context.store, seen: context.seen, cite: application => applications.set(application.application_id, application)}, name, input);
    }
  }
}
