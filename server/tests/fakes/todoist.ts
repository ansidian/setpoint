// A fake Todoist on 127.0.0.1: API v1's Sync endpoint (sync tokens, full and incremental), the
// completed-tasks list, the activity log, the task endpoints, a project's update (its colour), and
// OAuth's token exchange. Repeating tasks move on when closed, as Todoist's do, and the closed
// occurrence is only in the activity log (a `completed` event naming its day), never in the
// completed list, which lists only tasks really checked (SV-251, seen on the user's Todoist). A due
// change, an undo's included, is an `updated` event with the new due; the log has no `uncompleted`
// for an undo, and its `completed` event stays. Event dates are Todoist's UTC instants, a day's due
// its local end (23:59:59), in the user's zone (Los Angeles here). The Sync
// endpoint takes `item_update_date_complete` with `is_forward: 0`, the undo of a repeating task's
// completion (SV-249), and `reopen` does nothing on a task that isn't checked, as Todoist's doesn't. Errors are
// Todoist's: 401 for a token it didn't issue (or revoked), 400 for a sync token it doesn't know,
// 404 for a task that isn't there.
import type {TodoistLabel, TodoistProject, TodoistTask} from '../../src/providers/todoist/api.ts';
import {addDays, localDay, localTime, zonedInstant} from '../../src/domain/time.ts';
import {fakeServer, on} from './server.ts';
import type {FakeRequest, FakeResponse} from './server.ts';

const todoistError = (status: number, error: string, tag: string): FakeResponse => ({status, body: {error, error_code: status * 10, error_extra: {}, error_tag: tag, http_code: status}});

type Task = TodoistTask & {seq: number; everyDays?: number};

export interface ActivityEvent {
  id: number;
  object_type: 'item';
  object_id: string;
  event_type: 'added' | 'updated' | 'completed' | 'deleted';
  event_date: string;
  parent_project_id: string | null;
  parent_item_id: null;
  initiator_id: null;
  extra_data: Record<string, unknown>;
}

const ZONE = 'America/Los_Angeles';
// Todoist's UTC form in the log: "2026-11-11T07:59:59.000000Z".
const logInstant = (instant: string) => new Date(instant).toISOString().replace(/\.\d{3}Z$/, '.000000Z');
/** A due as the log words it: the instant, a day's at its local 23:59:59. */
function logDue(due: TodoistTask['due']): {utc: string; local: string; hasTime: boolean} | null {
  if (!due) return null;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(due.date);
  const utc = day ? new Date(Date.parse(zonedInstant(due.date, '23:59', ZONE)) + 59_000).toISOString()
    : /(?:Z|[+-]\d{2}:\d{2})$/.test(due.date) ? new Date(due.date).toISOString() : zonedInstant(due.date.slice(0, 10), due.date.slice(11, 16), ZONE);
  return {utc: logInstant(utc), local: `${localDay(utc, ZONE)}T${localTime(utc, ZONE)}:${day ? '59' : '00'}`, hasTime: !day};
}

export async function fakeTodoist() {
  let seq = 0;
  let ids = 1000;
  const tokens = new Set<string>(['todoist-token']);
  const codes = new Map<string, string>();
  const tasks = new Map<string, Task>();
  const projects = new Map<string, TodoistProject & {seq: number}>();
  const labels = new Map<string, TodoistLabel & {seq: number}>();
  const completed: (TodoistTask & {completed_at: string})[] = [];
  const activities: ActivityEvent[] = [];
  let activityIds = 5000;
  const requestIds: string[] = [];
  const refusals: Record<string, unknown>[] = [];
  let clock = () => new Date();

  const authorized = (request: FakeRequest) => tokens.has((request.headers.authorization ?? '').replace(/^Bearer /, ''));
  const unauthorized = () => todoistError(401, 'Invalid token', 'AUTH_INVALID_TOKEN');
  const save = (task: Omit<Task, 'seq'>) => {
    const stored = {...task, seq: (seq += 1)};
    tasks.set(task.id, stored);
    return stored;
  };
  const show = ({seq: _seq, everyDays: _every, ...task}: Task): TodoistTask => task;
  const log = (task: TodoistTask, event_type: ActivityEvent['event_type'], extra: Record<string, unknown>) => {
    activities.push({
      id: (activityIds += 1), object_type: 'item', object_id: task.id, event_type, event_date: clock().toISOString(), parent_project_id: task.project_id ?? null,
      parent_item_id: null, initiator_id: null, extra_data: {content: task.content, client: 'Setpoint test', ...extra},
    });
  };
  /** A due change, as the log has it: the new due and the one before. */
  const logDueChange = (before: TodoistTask, after: TodoistTask) => {
    if (JSON.stringify(before.due ?? null) === JSON.stringify(after.due ?? null)) return;
    log(after, 'updated', {due_date: logDue(after.due)?.utc ?? null, last_due_date: logDue(before.due)?.utc ?? null});
  };
  /**
   * A close, from the API or Todoist's app: a repeating task moves on and its occurrence is only in
   * the log; a one-off is checked, in the log and the completed list.
   */
  const close = (task: Task) => {
    const occurrence = logDue(task.due);
    const repeating = Boolean(task.everyDays && task.due);
    const after = repeating ? save({...task, due: {...task.due!, date: addDays(task.due!.date.slice(0, 10), task.everyDays!) + task.due!.date.slice(10)}}) : save({...task, checked: true});
    if (!repeating) completed.push({...show(after), completed_at: clock().toISOString()});
    log(after, 'completed', {
      is_recurring: repeating, has_time: occurrence?.hasTime ?? false, completed_due_date: occurrence?.utc ?? null, completed_due_date_local: occurrence?.local ?? null,
      due_date: repeating ? logDue(after.due)?.utc ?? null : null, completed_date_source: 'due_date',
    });
  };
  const record = (request: FakeRequest) => {
    const id = request.headers['x-request-id'];
    if (typeof id === 'string') requestIds.push(id);
  };
  const dueFrom = (body: Record<string, unknown>, recurring: TodoistTask['due']) => {
    // Enough of Todoist's due words for a repeat: "every <weekday>[ at HH:MM] starting YYYY-MM-DD"
    // (or "from YYYY-MM-DD until …", SV-113) lands on that weekday on or after the start, as Todoist's
    // does; other repeats on the start.
    // "no date" takes the date off, as Todoist's does (SV-74).
    if (body.due_string === 'no date') return null;
    if (typeof body.due_string === 'string') {
      const words = body.due_string;
      const start = /(?:starting|from) (\d{4}-\d{2}-\d{2})/.exec(words)?.[1] ?? clock().toISOString().slice(0, 10);
      const weekday = /^every (sun|mon|tue|wed|thu|fri|sat)\b/i.exec(words)?.[1]?.toLowerCase();
      let date = start;
      if (weekday) while (new Date(`${date}T12:00:00Z`).toUTCString().slice(0, 3).toLowerCase() !== weekday) date = addDays(date, 1);
      const time = /\bat (\d{2}):(\d{2})\b/.exec(words);
      return {date: time ? `${date}T${time[1]}:${time[2]}:00` : date, timezone: null, string: words, is_recurring: /\bevery\b/i.test(words), lang: 'en'};
    }
    if (typeof body.due_datetime === 'string') return {date: body.due_datetime, timezone: 'America/Los_Angeles', string: body.due_datetime, is_recurring: false, lang: 'en'};
    if (typeof body.due_date === 'string') return {date: body.due_date, timezone: null, string: body.due_date, is_recurring: false, lang: 'en'};
    return recurring ?? null;
  };

  // Sync commands: each answered in `sync_status` by its uuid, "ok" or Todoist's refusal.
  const runCommands = (commands: {type: string; uuid: string; args: Record<string, unknown>}[]): FakeResponse => {
    const status: Record<string, unknown> = {};
    for (const {type, uuid, args} of commands) {
      requestIds.push(uuid);
      const task = tasks.get(String(args.id));
      const refused = refusals.shift();
      if (refused) status[uuid] = refused;
      else if (type !== 'item_update_date_complete' || args.is_forward !== 0) status[uuid] = {error: 'Unknown command', error_code: 0, error_tag: 'UNKNOWN_COMMAND', http_code: 400, error_extra: {}};
      else if (!task || task.is_deleted) status[uuid] = {error: 'Item not found', error_code: 22, error_tag: 'ITEM_NOT_FOUND', http_code: 404, error_extra: {}};
      else {
        logDueChange(task, save({...task, due: args.due as TodoistTask['due']}));
        status[uuid] = 'ok';
      }
    }
    return {status: 200, body: {sync_status: status, temp_id_mapping: {}, sync_token: `sync-${seq}`, full_sync: false}};
  };

  const server = await fakeServer([
    on('POST', /^\/api\/v1\/sync$/, request => {
      if (!authorized(request)) return unauthorized();
      const commands = (request.body as Record<string, string>).commands;
      if (commands) return runCommands(JSON.parse(commands));
      const token = (request.body as Record<string, string>).sync_token;
      if (token !== '*' && !/^sync-\d+$/.test(token ?? '')) return todoistError(400, 'Invalid sync token', 'INVALID_SYNC_TOKEN');
      const full = token === '*';
      const since = full ? -1 : Number(token!.slice(5));
      return {status: 200, body: {
        sync_token: `sync-${seq}`, full_sync: full,
        items: [...tasks.values()].filter(task => task.seq > since && (!full || (!task.checked && !task.is_deleted))).map(show),
        projects: [...projects.values()].filter(project => project.seq > since).map(({seq: _seq, ...project}) => project),
        labels: [...labels.values()].filter(label => label.seq > since).map(({seq: _seq, ...label}) => label),
      }};
    }),
    on('GET', /^\/api\/v1\/tasks\/completed\/by_completion_date$/, request => {
      if (!authorized(request)) return unauthorized();
      const since = request.query.get('since')!;
      const until = request.query.get('until')!;
      return {status: 200, body: {items: completed.filter(task => task.completed_at >= since && task.completed_at <= until), next_cursor: null}};
    }),
    // The activity log, newest first, in pages of `limit` (Todoist's cursor is opaque; here it's the
    // offset). `date_from` is inclusive, `date_to` exclusive.
    on('GET', /^\/api\/v1\/activities$/, request => {
      if (!authorized(request)) return unauthorized();
      const query = request.query;
      const from = query.get('date_from');
      const to = query.get('date_to');
      const matching = activities
        .filter(event => (!query.get('object_type') || event.object_type === query.get('object_type')) && (!query.get('event_type') || event.event_type === query.get('event_type')))
        .filter(event => (!from || event.event_date >= new Date(from).toISOString()) && (!to || event.event_date < new Date(to).toISOString()))
        .sort((a, b) => b.event_date.localeCompare(a.event_date) || b.id - a.id);
      const limit = Number(query.get('limit') ?? 50);
      const offset = Number(/^o\.(\d+)$/.exec(query.get('cursor') ?? '')?.[1] ?? 0);
      const page = matching.slice(offset, offset + limit);
      return {status: 200, body: {results: page, next_cursor: offset + limit < matching.length ? `o.${offset + limit}` : null}};
    }),
    on('POST', /^\/api\/v1\/projects$/, request => {
      if (!authorized(request)) return unauthorized();
      record(request);
      const body = request.body as Record<string, unknown>;
      if (!body.name) return todoistError(400, 'Required argument is missing', 'ARGUMENT_MISSING');
      const project = {id: `p-${(ids += 1)}`, name: String(body.name), child_order: projects.size, seq: (seq += 1)};
      projects.set(project.id, project);
      return {status: 200, body: {id: project.id, name: project.name, child_order: project.child_order}};
    }),
    on('POST', /^\/api\/v1\/projects\/([^/]+)$/, (request, match) => {
      if (!authorized(request)) return unauthorized();
      record(request);
      const project = projects.get(match[1]!);
      if (!project || project.is_deleted) return todoistError(404, 'Project not found', 'NOT_FOUND');
      const {seq: _seq, ...updated} = {...project, ...(request.body as Partial<TodoistProject>)};
      projects.set(project.id, {...updated, seq: (seq += 1)});
      return {status: 200, body: updated};
    }),
    on('POST', /^\/api\/v1\/tasks$/, request => {
      if (!authorized(request)) return unauthorized();
      record(request);
      const body = request.body as Record<string, unknown>;
      if (!body.content) return todoistError(400, 'Required argument is missing', 'ARGUMENT_MISSING');
      const task = save({
        id: String((ids += 1)), content: String(body.content), project_id: (body.project_id as string) ?? 'inbox', due: dueFrom(body, null), checked: false, is_deleted: false,
        labels: Array.isArray(body.labels) ? body.labels as string[] : [],
      });
      return {status: 200, body: show(task)};
    }),
    on('POST', /^\/api\/v1\/tasks\/([^/]+)$/, (request, match) => {
      if (!authorized(request)) return unauthorized();
      record(request);
      const task = tasks.get(match[1]!);
      if (!task || task.is_deleted) return todoistError(404, 'Task not found', 'NOT_FOUND');
      const body = request.body as Record<string, unknown>;
      const updated = save({...task, ...(body.content ? {content: String(body.content)} : {}), ...(Array.isArray(body.labels) ? {labels: body.labels as string[]} : {}), due: dueFrom(body, task.due)});
      logDueChange(task, updated);
      return {status: 200, body: show(updated)};
    }),
    on('POST', /^\/api\/v1\/tasks\/([^/]+)\/(close|reopen|move)$/, (request, match) => {
      if (!authorized(request)) return unauthorized();
      record(request);
      const task = tasks.get(match[1]!);
      if (!task || task.is_deleted) return todoistError(404, 'Task not found', 'NOT_FOUND');
      if (match[2] === 'move') {
        save({...task, project_id: (request.body as {project_id: string}).project_id});
        return {status: 204};
      }
      if (match[2] === 'reopen') {
        // Nothing to reopen: Todoist answers 204 and changes nothing (SV-249's live test).
        if (task.checked) save({...task, checked: false});
        return {status: 204};
      }
      close(task);
      return {status: 204};
    }),
    on('DELETE', /^\/api\/v1\/tasks\/([^/]+)$/, (request, match) => {
      if (!authorized(request)) return unauthorized();
      record(request);
      const task = tasks.get(match[1]!);
      if (!task || task.is_deleted) return todoistError(404, 'Task not found', 'NOT_FOUND');
      save({...task, is_deleted: true});
      return {status: 204};
    }),
    on('POST', /^\/oauth\/access_token$/, request => {
      const form = request.body as Record<string, string>;
      if (form.client_id !== 'todoist-client' || form.client_secret !== 'todoist-secret') return {status: 400, body: {error: 'invalid_client'}};
      const token = codes.get(form.code ?? '');
      if (!token) return {status: 400, body: {error: 'bad_authorization_code'}};
      codes.delete(form.code!);
      tokens.add(token);
      return {status: 200, body: {access_token: token, token_type: 'Bearer'}};
    }),
  ]);

  return {
    ...server,
    requestIds,
    useClock(now: () => Date) {
      clock = now;
    },
    addProject(project: TodoistProject) {
      projects.set(project.id, {...project, seq: (seq += 1)});
    },
    project: (id: string) => projects.get(id),
    addLabel(label: TodoistLabel) {
      labels.set(label.id, {...label, seq: (seq += 1)});
    },
    /** A task as it is in Todoist; `everyDays` makes it repeat. */
    put(task: TodoistTask & {everyDays?: number}) {
      return show(save({checked: false, is_deleted: false, ...task}));
    },
    task(id: string): TodoistTask | undefined {
      const found = tasks.get(id);
      return found ? show(found) : undefined;
    },
    tasks: () => [...tasks.values()].map(show),
    /** Todoist refuses the next Sync command with this, in its `sync_status`. */
    refuseCommand(error: Record<string, unknown>) {
      refusals.push(error);
    },
    /** The user completes a task in Todoist's own app, now. */
    completeInTodoist(id: string) {
      close(tasks.get(id)!);
    },
    /** The user presses Undo on Todoist's pop-up: the due goes back, an `updated` event, nothing else. */
    undoInTodoist(id: string, due: TodoistTask['due']) {
      const task = tasks.get(id)!;
      logDueChange(task, save({...task, due}));
    },
    activities: () => [...activities],
    /** The consent page would hand this code back for this token. */
    grant(code: string, token: string) {
      codes.set(code, token);
    },
    revoke() {
      tokens.clear();
    },
  };
}

export type FakeTodoist = Awaited<ReturnType<typeof fakeTodoist>>;
