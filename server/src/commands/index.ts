// The command layer (after mantel's `control`; BRIEF.md › Decided elsewhere). Every change to a
// provider is a command:
// - created pending, with the mirror changed at once where the change shows at once (opening an
//   email drops the unread counts; a moved event sits at its new time at .5 opacity), and `previous`
//   keeping what Move back restores;
// - carried out by the source's adapter as a durable job, with the one retry policy for what a
//   retry can fix;
// - confirmed when the provider says so, or failed with the provider's own message, staying in
//   place until Try again or Move back. Nothing quietly reverts.
// One command per target at a time: a second change waits until the first settles (enforced by a
// partial unique index too).
import type {Colour, TodoistColour, CommandKind, CommandOut, CommandTarget, ItemWhen, SourceProvider} from '@setpoint/shared';
import {and, eq, inArray, isNull} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {nextCommandState} from '../domain/commandStates.ts';
import type {CommandEvent} from '../domain/commandStates.ts';
import {conflict, notFound} from '../errors.ts';
import {enqueueJob} from '../sync/jobs.ts';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {deleteItemInMirror, restoreItems} from './itemMirror.ts';
import type {ItemDeletion, ItemSnapshot} from './itemMirror.ts';

export type CommandRow = typeof t.commands.$inferSelect;

/** What a command touched, for the live event it rides on. */
export interface Touched {
  messages?: number[];
  accounts?: number[];
  items?: number[];
  calendars?: number[];
}

/** What Move back restores: emails' read and trash state, items' rows, items the change created, and calendars' and Todoist projects' colours. */
export interface Previous {
  messages?: {id: number; unread: boolean; trashedAt: string | null; openedAt: string | null}[];
  calendars?: {id: number; colour: Colour | null}[];
  projects?: {id: number; colour: TodoistColour | null}[];
  items?: ItemSnapshot[];
  created?: number[];
}

export interface NewCommand {
  target: CommandTarget;
  kind: CommandKind;
  sourceId: number | null;
  payload: Record<string, unknown>;
  /**
   * Runs first, in the command's transaction: changes the mirror where the change shows at once,
   * and says which target it's about, what Move back restores and what it touched. A change that
   * shows only once confirmed (deleting an item) changes nothing here.
   */
  prepare: () => Prepared;
}

export interface Prepared {
  targetId: number;
  previous?: Previous | null;
  previousWhen?: ItemWhen | null;
  touched: Touched;
}

const ACTIVE = ['pending', 'failed'] as const;

export function activeCommand(store: Store, target: CommandTarget, targetId: number): CommandRow | null {
  return store.db.select().from(t.commands)
    .where(and(eq(t.commands.target, target), eq(t.commands.targetId, targetId), inArray(t.commands.state, [...ACTIVE]))).get() ?? null;
}

export function activeCommands(store: Store, target?: CommandTarget): CommandRow[] {
  return store.db.select().from(t.commands)
    .where(and(inArray(t.commands.state, [...ACTIVE]), target ? eq(t.commands.target, target) : undefined)).all();
}

function sourceProviders(store: Store): Map<number, SourceProvider> {
  return new Map(store.db.select({id: t.sources.id, provider: t.sources.provider}).from(t.sources).all().map(row => [row.id, row.provider]));
}

export function presentCommand(row: CommandRow, providers: Map<number, SourceProvider>): CommandOut {
  const failed = row.state === 'failed';
  return {
    id: row.id, target: row.target, target_id: row.targetId, kind: row.kind, state: row.state,
    provider: row.sourceId === null ? null : providers.get(row.sourceId) ?? null,
    provider_message: row.providerMessage, can_retry: failed, can_move_back: failed,
    previous: row.previousWhen ?? null, created_at: row.createdAt, settled_at: row.settledAt,
  };
}

/** Presents commands with their providers looked up once. */
export function commandPresenter(store: Store): (row: CommandRow) => CommandOut {
  const providers = sourceProviders(store);
  return row => presentCommand(row, providers);
}

function noteTouched(store: Store, row: CommandRow, touched: Touched) {
  if (row.target === 'item' || row.target === 'calendar' || row.target === 'project') noteLive(store, {type: 'items', items: touched.items ?? [], calendars: touched.calendars ?? [], commands: [row.id]});
  else noteLive(store, {type: 'mail', messages: touched.messages ?? [], accounts: touched.accounts ?? [], commands: [row.id]});
}

/**
 * Creates a pending command, applies it to the mirror where it shows at once, and queues it for its
 * provider. Refused, changing nothing, while the target has another active command.
 */
export function createCommand(store: Store, command: NewCommand): CommandRow {
  return transaction(store, () => {
    const prepared = command.prepare();
    const active = activeCommand(store, command.target, prepared.targetId);
    if (active) {
      throw active.state === 'pending'
        ? conflict('command_pending', 'The last change is still waiting for its provider.')
        : conflict('command_failed', 'The last change failed; try it again or move it back first.');
    }
    const row = store.db.insert(t.commands).values({
      target: command.target, targetId: prepared.targetId, kind: command.kind, sourceId: command.sourceId,
      payload: {...command.payload, touched: prepared.touched}, previous: (prepared.previous ?? null) as Record<string, unknown> | null,
      previousWhen: prepared.previousWhen ?? null, createdAt: isoNow(store),
    }).returning().get();
    enqueueJob(store, {kind: 'command', key: `command:${row.id}`, commandId: row.id, sourceId: command.sourceId});
    noteTouched(store, row, prepared.touched);
    return row;
  });
}

const touchedOf = (row: CommandRow) => (row.payload.touched ?? {}) as Touched;

function transition(store: Store, commandId: number, event: CommandEvent, then: (row: CommandRow) => Partial<CommandRow>): CommandRow {
  return transaction(store, () => {
    const row = store.db.select().from(t.commands).where(eq(t.commands.id, commandId)).get();
    if (!row) throw notFound('No such command.');
    const next = nextCommandState(row.state, event);
    if (!next) throw conflict('command_state', `A ${row.state} change can't be ${event === 'move_back' ? 'moved back' : event === 'retry' ? 'tried again' : `${event}ed`}.`);
    const updated = store.db.update(t.commands).set({state: next, ...then(row)}).where(eq(t.commands.id, commandId)).returning().get()!;
    noteTouched(store, updated, touchedOf(updated));
    return updated;
  });
}

/**
 * Effects that show only once the provider confirms: a deleted item goes, and so does a task created
 * with no date (SV-74), which isn't on the calendar, as a sync leaves undated tasks out.
 */
function applyOnConfirm(store: Store, row: CommandRow) {
  if (row.kind === 'item_delete') deleteItemInMirror(store, row.payload as unknown as ItemDeletion);
  if (row.kind === 'item_create') {
    store.db.delete(t.items).where(and(eq(t.items.id, row.targetId), eq(t.items.kind, 'task'), isNull(t.items.dueDate))).run();
  }
}

/** Move back: what the mirror held before the change, restored as it was. */
function restorePrevious(store: Store, row: CommandRow) {
  const previous = row.previous as Previous | null;
  if (!previous) return;
  for (const message of previous.messages ?? []) {
    store.db.update(t.messages).set({unread: message.unread, trashedAt: message.trashedAt, openedAt: message.openedAt}).where(eq(t.messages.id, message.id)).run();
  }
  for (const calendar of previous.calendars ?? []) store.db.update(t.calendars).set({colour: calendar.colour}).where(eq(t.calendars.id, calendar.id)).run();
  for (const project of previous.projects ?? []) store.db.update(t.todoistProjects).set({colour: project.colour}).where(eq(t.todoistProjects.id, project.id)).run();
  if (previous.items || previous.created) restoreItems(store, previous.items ?? [], previous.created ?? []);
}

/** The provider confirmed. */
export function confirmCommand(store: Store, commandId: number): CommandRow {
  return transition(store, commandId, 'confirm', row => {
    applyOnConfirm(store, row);
    return {settledAt: isoNow(store), providerMessage: null};
  });
}

/** The provider refused, in its own words. */
export function failCommand(store: Store, commandId: number, providerMessage: string): CommandRow {
  return transition(store, commandId, 'fail', () => ({settledAt: isoNow(store), providerMessage}));
}

/** Try again: pending once more, and back in the provider's queue. */
export function retryCommand(store: Store, commandId: number): CommandRow {
  return transaction(store, () => {
    const row = transition(store, commandId, 'retry', () => ({settledAt: null, providerMessage: null, attempts: 0}));
    enqueueJob(store, {kind: 'command', key: `command:${row.id}`, commandId: row.id, sourceId: row.sourceId});
    return row;
  });
}

/** Move back: the change is abandoned and the mirror shows what it held before. */
export function moveBackCommand(store: Store, commandId: number): CommandRow {
  return transition(store, commandId, 'move_back', row => {
    restorePrevious(store, row);
    return {settledAt: isoNow(store)};
  });
}

export function getCommand(store: Store, commandId: number): CommandRow {
  const row = store.db.select().from(t.commands).where(eq(t.commands.id, commandId)).get();
  if (!row) throw notFound('No such command.');
  return row;
}

/**
 * Items a change still holds (pending or failed): its target, the item it names, and the rows it
 * created or snapshotted. A sync leaves these as they are, so a pending change isn't undone by the
 * provider's older state and a failed one stays in place until Try again or Move back (B5).
 */
export function itemsHeldByCommands(store: Store): Set<number> {
  const held = new Set<number>();
  for (const row of activeCommands(store, 'item')) {
    held.add(row.targetId);
    if (typeof row.payload.item_id === 'number') held.add(row.payload.item_id);
    const previous = row.previous as Previous | null;
    for (const id of previous?.created ?? []) held.add(id);
    for (const item of previous?.items ?? []) held.add(item.id);
  }
  return held;
}
