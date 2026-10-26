// Todoist into the mirror, polled (the webhook comes at cutover). Adapted from v1's
// `todoist-mirror` (see SV-6): Todoist's sync token is the cursor ("*" for everything), a refused
// token is retried once as a full sync, a full sync is the whole list (open tasks it leaves out
// are gone), deletions arrive as `is_deleted`, and each sync applies in one transaction.
//
// Completed occurrences of repeating tasks are kept (v1's tombstones, ea_completed_tasks):
// completing one in Setpoint makes its row at once (src/commands/items.ts), and ones completed in
// Todoist's apps are read from its completed list, which v1 had stopped reading, so they no longer
// vanish when Todoist moves the task on. Unlike v1, a sync never prunes them for being absent;
// they go only with their task when it's deleted.
import {isTodoistColour} from '@setpoint/shared';
import {and, eq, inArray, isNull, notInArray} from 'drizzle-orm';
import {activeCommands, itemsHeldByCommands} from '../../commands/index.ts';
import type {ItemRow} from '../../commands/itemMirror.ts';
import * as t from '../../db/schema.ts';
import {isoNow, noteLive, transaction} from '../../store.ts';
import type {Store} from '../../store.ts';
import {isSyncTokenRefused} from './api.ts';
import type {SyncAnswer, TodoistApi, TodoistTask} from './api.ts';
import {readDue} from './due.ts';

const DAY = 86_400_000;
// How far back the first look at completed tasks goes.
export const COMPLETED_FIRST_LOOK_MS = 14 * DAY;

/** The one Todoist calendar row ("Todoist", one more toggle), made on connect. */
export function todoistCalendar(store: Store) {
  const found = store.db.select().from(t.calendars).where(eq(t.calendars.provider, 'todoist')).get();
  if (found) return found;
  const position = store.db.select({id: t.calendars.id}).from(t.calendars).all().length;
  return store.db.insert(t.calendars).values({provider: 'todoist', providerId: 'todoist', name: 'Todoist', colour: null, position}).returning().get();
}

/** A task's columns from Todoist; its reminders are Setpoint's own, which Todoist never holds (SV-109). */
function taskColumns(task: TodoistTask, projects: Map<string, string>, timeZone: string): Partial<ItemRow> | null {
  const due = task.due ? readDue(task.due, timeZone) : null;
  // Undated tasks aren't on the calendar (v1's choice too).
  if (!due) return null;
  return {
    kind: 'task', title: task.content, allDay: true, startsAt: null, endsAt: null, startDate: null, endDate: null,
    dueDate: due.dueDate, dueAt: due.dueAt, dueString: task.due?.string ?? null, dueRecurring: Boolean(task.due?.is_recurring),
    project: (task.project_id && projects.get(task.project_id)) || null, recurrence: null, labels: task.labels ?? [],
  };
}

/** One sync: incremental from `cursor`, or everything; returns the next cursor. */
export async function syncTodoist(store: Store, api: TodoistApi, cursor: string | null): Promise<string> {
  let answer: SyncAnswer;
  let full = !cursor;
  try {
    answer = await api.sync(cursor ?? '*');
  } catch (error) {
    if (!cursor || !isSyncTokenRefused(error)) throw error;
    full = true;
    answer = await api.sync('*');
  }
  full = full || Boolean(answer.full_sync);
  applySync(store, answer, full);
  return answer.sync_token;
}

export function applySync(store: Store, answer: SyncAnswer, full: boolean) {
  transaction(store, () => {
    const calendar = todoistCalendar(store);
    // Projects first, so tasks get their names. A full sync lists them all, so one it leaves out is
    // gone; the others keep their ids, which a colour change's command names (SV-25).
    const projectRows = answer.projects ?? [];
    const before = JSON.stringify(store.db.select().from(t.todoistProjects).all());
    if (full) store.db.delete(t.todoistProjects).where(notInArray(t.todoistProjects.providerId, projectRows.map(project => project.id))).run();
    // A colour waiting for Todoist, or failed in place, stays until Try again or Change back.
    const heldProjects = new Set(activeCommands(store, 'project').map(row => row.targetId));
    for (const project of projectRows) {
      if (project.is_deleted || project.is_archived) {
        store.db.delete(t.todoistProjects).where(eq(t.todoistProjects.providerId, project.id)).run();
        continue;
      }
      const values = {name: project.name, position: project.child_order ?? 0, inbox: Boolean(project.inbox_project), colour: isTodoistColour(project.color) ? project.color : null};
      const found = store.db.select().from(t.todoistProjects).where(eq(t.todoistProjects.providerId, project.id)).get();
      if (found) store.db.update(t.todoistProjects).set(heldProjects.has(found.id) ? {...values, colour: found.colour} : values).where(eq(t.todoistProjects.id, found.id)).run();
      else store.db.insert(t.todoistProjects).values({providerId: project.id, ...values}).run();
    }
    const projectsChanged = JSON.stringify(store.db.select().from(t.todoistProjects).all()) !== before;
    const projects = new Map(store.db.select().from(t.todoistProjects).all().map(row => [row.providerId, row.name]));
    // Labels, for the editor's picker (F6b); a task names its labels itself.
    if (full) store.db.delete(t.todoistLabels).run();
    for (const label of answer.labels ?? []) {
      if (label.is_deleted) {
        store.db.delete(t.todoistLabels).where(eq(t.todoistLabels.providerId, label.id)).run();
        continue;
      }
      const values = {name: label.name, position: label.item_order ?? 0};
      store.db.insert(t.todoistLabels).values({providerId: label.id, ...values}).onConflictDoUpdate({target: t.todoistLabels.providerId, set: values}).run();
    }

    const held = itemsHeldByCommands(store);
    const tasks = store.db.select().from(t.items).where(and(eq(t.items.calendarId, calendar.id), isNull(t.items.recurringItemId))).all();
    const byId = new Map(tasks.map(row => [row.providerId, row]));
    const seen = new Set<number>();
    const touched = new Set<number>();
    const now = isoNow(store);

    for (const task of answer.items ?? []) {
      const found = byId.get(task.id);
      if (found) seen.add(found.id);
      if (found && held.has(found.id)) continue;
      const columns = task.is_deleted ? null : taskColumns(task, projects, store.timeZone);
      if (!columns) {
        // Deleted, or no longer dated: it leaves the calendar (with its completed occurrences).
        if (found) {
          store.db.delete(t.items).where(eq(t.items.id, found.id)).run();
          touched.add(found.id);
        }
        continue;
      }
      const doneAt = task.checked ? (found?.doneAt ?? task.completed_at ?? now) : null;
      if (found) {
        const updated = store.db.update(t.items).set({...columns, doneAt}).where(eq(t.items.id, found.id)).returning().get()!;
        if (JSON.stringify(found) !== JSON.stringify(updated)) touched.add(found.id);
      } else {
        const row = store.db.insert(t.items).values({calendarId: calendar.id, providerId: task.id, ...columns, reminders: [], doneAt} as typeof t.items.$inferInsert).returning().get();
        seen.add(row.id);
        touched.add(row.id);
      }
    }
    // A full sync lists every open task: an open one it left out is gone. Done ones are history
    // (a full sync leaves completed tasks out).
    if (full) {
      for (const row of tasks) {
        if (seen.has(row.id) || held.has(row.id) || row.doneAt !== null || row.providerId.startsWith('local-')) continue;
        store.db.delete(t.items).where(eq(t.items.id, row.id)).run();
        touched.add(row.id);
      }
    }
    // A project's new colour redraws its tasks' rings.
    if (touched.size || projectsChanged) noteLive(store, {type: 'items', items: [...touched].sort((a, b) => a - b), calendars: [calendar.id], commands: []});
  });
}

/**
 * Occurrences completed in Todoist's apps since the last look: each completed occurrence of a
 * repeating task becomes its done row on its day (once); a one-off task is marked done.
 */
export async function syncCompleted(store: Store, api: TodoistApi, since: string | null): Promise<string> {
  const until = isoNow(store);
  const from = since ?? new Date(store.now().getTime() - COMPLETED_FIRST_LOOK_MS).toISOString();
  const completed = await api.completed(from, until);
  transaction(store, () => {
    const calendar = todoistCalendar(store);
    const held = itemsHeldByCommands(store);
    const touched = new Set<number>();
    const ids = [...new Set(completed.map(task => task.id))];
    const tasks = ids.length ? store.db.select().from(t.items).where(and(eq(t.items.calendarId, calendar.id), inArray(t.items.providerId, ids), isNull(t.items.recurringItemId))).all() : [];
    const byId = new Map(tasks.map(row => [row.providerId, row]));
    for (const task of completed) {
      const row = byId.get(task.id);
      const due = task.due ? readDue(task.due, store.timeZone) : null;
      if (!row || !due || held.has(row.id)) continue;
      const doneAt = task.completed_at ? new Date(task.completed_at).toISOString() : until;
      if (task.due?.is_recurring || row.dueRecurring) {
        // The occurrence it completed, unless Setpoint already holds it.
        const exists = store.db.select({id: t.items.id}).from(t.items).where(and(eq(t.items.recurringItemId, row.id), eq(t.items.originalStart, due.dueDate))).get();
        if (exists) continue;
        const {id: _id, ...base} = row;
        const created = store.db.insert(t.items).values({
          ...base, providerId: `${row.providerId}@${due.dueDate}`, dueDate: due.dueDate, dueAt: due.dueAt, recurringItemId: row.id, originalStart: due.dueDate, doneAt, cancelled: false,
        }).returning({id: t.items.id}).get();
        touched.add(created.id);
      } else if (row.doneAt === null) {
        store.db.update(t.items).set({doneAt}).where(eq(t.items.id, row.id)).run();
        touched.add(row.id);
      }
    }
    if (touched.size) noteLive(store, {type: 'items', items: [...touched].sort((a, b) => a - b), calendars: [calendar.id], commands: []});
  });
  return until;
}
