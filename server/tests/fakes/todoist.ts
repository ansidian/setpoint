// A fake Todoist on 127.0.0.1: API v1's Sync endpoint (sync tokens, full and incremental), the
// completed-tasks list, the task endpoints, a project's update (its colour), and OAuth's token exchange. Repeating tasks move on
// when closed, as Todoist's do, and the closed occurrence goes to the completed list. Errors are
// Todoist's: 401 for a token it didn't issue (or revoked), 400 for a sync token it doesn't know,
// 404 for a task that isn't there.
import type {TodoistLabel, TodoistProject, TodoistTask} from '../../src/providers/todoist/api.ts';
import {addDays} from '../../src/domain/time.ts';
import {fakeServer, on} from './server.ts';
import type {FakeRequest, FakeResponse} from './server.ts';

const todoistError = (status: number, error: string, tag: string): FakeResponse => ({status, body: {error, error_code: status * 10, error_extra: {}, error_tag: tag, http_code: status}});

type Task = TodoistTask & {seq: number; everyDays?: number};

export async function fakeTodoist() {
  let seq = 0;
  let ids = 1000;
  const tokens = new Set<string>(['todoist-token']);
  const codes = new Map<string, string>();
  const tasks = new Map<string, Task>();
  const projects = new Map<string, TodoistProject & {seq: number}>();
  const labels = new Map<string, TodoistLabel & {seq: number}>();
  const completed: (TodoistTask & {completed_at: string})[] = [];
  const requestIds: string[] = [];
  let clock = () => new Date();

  const authorized = (request: FakeRequest) => tokens.has((request.headers.authorization ?? '').replace(/^Bearer /, ''));
  const unauthorized = () => todoistError(401, 'Invalid token', 'AUTH_INVALID_TOKEN');
  const save = (task: Omit<Task, 'seq'>) => {
    const stored = {...task, seq: (seq += 1)};
    tasks.set(task.id, stored);
    return stored;
  };
  const show = ({seq: _seq, everyDays: _every, ...task}: Task): TodoistTask => task;
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

  const server = await fakeServer([
    on('POST', /^\/api\/v1\/sync$/, request => {
      if (!authorized(request)) return unauthorized();
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
      return {status: 200, body: show(save({...task, ...(body.content ? {content: String(body.content)} : {}), ...(Array.isArray(body.labels) ? {labels: body.labels as string[]} : {}), due: dueFrom(body, task.due)}))};
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
        save({...task, checked: false});
        return {status: 204};
      }
      completed.push({...show(task), completed_at: clock().toISOString()});
      // A repeating task moves on to its next day; a one-off is checked.
      if (task.everyDays && task.due) save({...task, due: {...task.due, date: addDays(task.due.date.slice(0, 10), task.everyDays)}});
      else save({...task, checked: true});
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
    /** The user completes a task in Todoist's own app. */
    completeInTodoist(id: string, at: Date) {
      const task = tasks.get(id)!;
      completed.push({...show(task), completed_at: at.toISOString()});
      if (task.everyDays && task.due) save({...task, due: {...task.due, date: addDays(task.due.date.slice(0, 10), task.everyDays)}});
      else save({...task, checked: true});
    },
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
