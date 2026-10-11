// The Todoist adapter: one source, polled every 5 minutes (the webhook comes at cutover), with the
// access token from Todoist's OAuth (stored as the source's key; Todoist's tokens don't expire).
// Changes go through the command layer: create, change, complete (a repeating task's occurrence),
// reopen and delete, and a project's colour (SV-25), each pending until Todoist answers. Adapted from v1's `todoist` and
// `tasks-service` (see SV-6): `due_lang: en` so a due string reads as English, the occurrence check
// before a repeating task is closed (src/commands/items.ts), Todoist's own words when it refuses.
import {and, eq} from 'drizzle-orm';
import type {CommandRow} from '../../commands/index.ts';
import type {ItemRow} from '../../commands/itemMirror.ts';
import * as t from '../../db/schema.ts';
import {getSettings} from '../../settings.ts';
import {isoNow} from '../../store.ts';
import type {Store} from '../../store.ts';
import type {AdapterContext, SourceAdapter} from '../../sync/adapter.ts';
import {ProviderError} from '../../sync/errors.ts';
import {claimProviderId} from '../../commands/itemMirror.ts';
import {requestIdFor, TodoistApi} from './api.ts';
import type {TodoistApiOptions, TodoistTask} from './api.ts';
import {readDue, repeatOf, writeDue} from './due.ts';
import {syncCompleted, syncTodoist} from './sync.ts';

export type TodoistOptions = TodoistApiOptions;

function api(options: TodoistOptions, context: AdapterContext): TodoistApi {
  const credentials = context.credentials();
  if (credentials?.kind !== 'api_key') throw new ProviderError('auth', 'Todoist isn\'t connected; connect it in Settings › Todoist.');
  return new TodoistApi(options, credentials.key, context.signal);
}

const itemRow = (store: Store, id: number) => store.db.select().from(t.items).where(eq(t.items.id, id)).get() ?? null;

/** A row's due as Todoist is sent it: with its repeat, when it repeats. */
const dueOf = (store: Store, row: ItemRow) => ({...writeDue({dueDate: row.dueDate, dueAt: row.dueAt, repeat: row.dueRecurring ? repeatOf(row.dueString) : null}, store.timeZone), due_lang: 'en'});

/** Todoist's answer is the truth for the due it worked out: "every mon starting Wed" lands on Monday. */
function takeDue(store: Store, rowId: number, task: TodoistTask) {
  const due = task.due ? readDue(task.due, store.timeZone) : null;
  if (!due) return;
  store.db.update(t.items).set({dueDate: due.dueDate, dueAt: due.dueAt, dueString: task.due!.string ?? null, dueRecurring: Boolean(task.due!.is_recurring)}).where(eq(t.items.id, rowId)).run();
}

/**
 * A project's Todoist id by name; else Settings' default project's (a name too, as the editor and
 * proposals show it); else Todoist's Inbox (by leaving it out).
 */
function projectId(store: Store, name: string | null): string | undefined {
  return namedProject(store, name) ?? namedProject(store, getSettings(store).todoist.default_project);
}

const namedProject = (store: Store, name: string | null) =>
  (name ? store.db.select().from(t.todoistProjects).where(eq(t.todoistProjects.name, name)).get()?.providerId : undefined);

/** A project the user chose to make (SV-24, D50): made in Todoist, then listed here at once rather than at the next sync. */
async function newProject(store: Store, todoist: TodoistApi, name: string, requestId: string): Promise<string> {
  const project = await todoist.createProject(name, requestId);
  store.db.insert(t.todoistProjects).values({providerId: project.id, name: project.name, position: project.child_order ?? 0, inbox: false}).onConflictDoNothing().run();
  return project.id;
}

function readCursor(store: Store, sourceId: number, scope: string) {
  return store.db.select().from(t.syncCursors).where(and(eq(t.syncCursors.sourceId, sourceId), eq(t.syncCursors.scope, scope))).get()?.cursor ?? null;
}

function writeCursor(store: Store, sourceId: number, scope: string, cursor: string) {
  const updatedAt = isoNow(store);
  store.db.insert(t.syncCursors).values({sourceId, scope, cursor, updatedAt}).onConflictDoUpdate({target: [t.syncCursors.sourceId, t.syncCursors.scope], set: {cursor, updatedAt}}).run();
}

async function poll(options: TodoistOptions, context: AdapterContext, cursor: string | null, full: boolean): Promise<string> {
  const todoist = api(options, context);
  const next = await syncTodoist(context.store, todoist, full ? null : cursor);
  writeCursor(context.store, context.source.id, 'completed', await syncCompleted(context.store, todoist, readCursor(context.store, context.source.id, 'completed')));
  return next;
}

async function execute(options: TodoistOptions, context: AdapterContext, command: CommandRow) {
  const {store} = context;
  const todoist = api(options, context);
  const requestId = (step = '') => requestIdFor(command.id, step);
  if (command.kind === 'project_colour') {
    const project = store.db.select().from(t.todoistProjects).where(eq(t.todoistProjects.id, command.targetId)).get();
    if (!project) throw new ProviderError('permanent', 'This project is no longer in Todoist.');
    await todoist.updateProject(project.providerId, {color: command.payload.colour}, requestId());
    return;
  }
  const target = itemRow(store, command.targetId);
  switch (command.kind) {
    case 'item_create': {
      if (!target) return;
      const create = (command.payload.input as {create_project?: boolean} | undefined)?.create_project && target.project && !namedProject(store, target.project);
      const project = create ? await newProject(store, todoist, target.project!, requestId('project')) : projectId(store, target.project);
      const task = await todoist.createTask({
        content: target.title, ...(project ? {project_id: project} : {}), ...dueOf(store, target), ...(target.labels?.length ? {labels: target.labels} : {}),
      }, requestId());
      claimProviderId(store, target.id, task.id);
      takeDue(store, target.id, task);
      return;
    }
    case 'item_update': {
      if (!target) return;
      const changes = (command.payload.changes ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (changes.title !== undefined) body.content = target.title;
      if (changes.due_date !== undefined || changes.due_at !== undefined || changes.repeat !== undefined) Object.assign(body, dueOf(store, target));
      if (changes.labels !== undefined) body.labels = target.labels ?? [];
      if (Object.keys(body).length) takeDue(store, target.id, await todoist.updateTask(target.providerId, body, requestId('update')));
      if (changes.project !== undefined) {
        const project = projectId(store, target.project);
        if (project) await todoist.moveTask(target.providerId, project, requestId('move'));
      }
      return;
    }
    case 'item_complete': {
      if (!target) return;
      // A repeating task's occurrence closes the task itself; Todoist moves it on.
      const task: ItemRow | null = target.recurringItemId === null ? target : itemRow(store, target.recurringItemId);
      if (task) await todoist.closeTask(task.providerId, requestId());
      return;
    }
    case 'item_reopen':
      if (target) await todoist.reopenTask(target.providerId, requestId());
      return;
    case 'item_delete': {
      const row = itemRow(store, command.payload.item_id as number);
      if (!row) return;
      try {
        await todoist.deleteTask(row.providerId, requestId());
      } catch (error) {
        // Already gone in Todoist: the delete is done.
        if (!(error instanceof ProviderError && error.status === 404)) throw error;
      }
      return;
    }
    default:
      throw new ProviderError('permanent', `Todoist can't ${command.kind.replace('item_', '')} a task.`);
  }
}

export function todoistAdapter(options: TodoistOptions = {}): SourceAdapter {
  return {
    async sync(context, cursor) {
      return {cursor: await poll(options, context, cursor, false)};
    },
    // The sweep: everything again, repairing what an incremental sync missed.
    async sweep(context) {
      writeCursor(context.store, context.source.id, '', await poll(options, context, null, true));
    },
    execute: (context, command) => execute(options, context, command),
  };
}

