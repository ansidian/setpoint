// Todoist's unified API (v1, as v1 used) over plain fetch: the Sync endpoint for the mirror (and,
// SV-249, a repeating task's undo, a Sync command), the completed-tasks list for one-off tasks
// completed in Todoist's own apps, the activity log for a repeating task's occurrences completed
// there (SV-251), and the task endpoints for changes. Errors carry Todoist's own words; 401 and 403 mean the connection was revoked (v1 never
// treated them so, see SV-6), 429 waits.
import {createHash} from 'node:crypto';
import {kindOfStatus, ProviderError} from '../../sync/errors.ts';
import {reasonPhrase, requestJson} from '../http.ts';
import type {HttpOptions, Refusal} from '../http.ts';
import type {TodoistDue} from './due.ts';

export const TODOIST_API = 'https://api.todoist.com';
export const TODOIST_TIMEOUT_MS = 30_000;

export interface TodoistTask {
  id: string;
  content: string;
  project_id?: string | null;
  due?: TodoistDue | null;
  checked?: boolean;
  is_deleted?: boolean;
  completed_at?: string | null;
  child_order?: number;
  parent_id?: string | null;
  order_key?: string | null;
  // F6b: label names.
  labels?: string[];
  // SV-264: Markdown; an empty string when the task has none.
  description?: string;
}

export interface TodoistProject {
  id: string;
  name: string;
  child_order?: number;
  inbox_project?: boolean;
  // A colour name ("berry_red"; shared's TODOIST_COLOURS).
  color?: string;
  is_deleted?: boolean;
  is_archived?: boolean;
}

export interface TodoistLabel {
  id: string;
  name: string;
  item_order?: number;
  is_deleted?: boolean;
}

export interface SyncAnswer {
  sync_token: string;
  full_sync?: boolean;
  items?: TodoistTask[];
  projects?: TodoistProject[];
  labels?: TodoistLabel[];
}

/** One activity log event (GET /api/v1/activities); `extra_data` holds what changed. */
export interface TodoistActivity {
  id?: number | null;
  object_type: string;
  object_id: string;
  event_type: string;
  event_date: string;
  extra_data?: Record<string, unknown> | null;
}

export interface TodoistApiOptions extends HttpOptions {
  baseUrl?: string;
}

/** Todoist's error body: `{"error": "…", "error_code": 15, "error_tag": "…", "http_code": 401}`, or plain text. */
export function readTodoistRefusal(status: number, text: string): Refusal {
  let words = text.trim();
  try {
    const parsed = JSON.parse(text) as {error?: string};
    if (typeof parsed.error === 'string') words = parsed.error;
  } catch {
    // Plain text, as Todoist sometimes answers.
  }
  if (!words || words.length > 300 || words.startsWith('<')) words = reasonPhrase(status);
  const message = `${words} (${status} ${reasonPhrase(status)})`;
  return status === 401 || status === 403 ? {message, kind: 'auth'} : {message};
}

/** Whether Todoist refused the stored sync token (a full sync is due). */
export const isSyncTokenRefused = (error: unknown) => error instanceof ProviderError && error.status === 400 && /sync[_ ]?token/i.test(error.message);

export class TodoistApi {
  private readonly options: TodoistApiOptions;
  private readonly token: string;
  private readonly signal: AbortSignal | undefined;

  constructor(options: TodoistApiOptions, token: string, signal?: AbortSignal) {
    this.options = {timeoutMs: TODOIST_TIMEOUT_MS, ...options};
    this.token = token;
    this.signal = signal;
  }

  private call<T>(method: string, path: string, {query, body, requestId}: {query?: Record<string, string | undefined>; body?: unknown; requestId?: string} = {}): Promise<T> {
    const url = new URL(`${(this.options.baseUrl ?? TODOIST_API).replace(/\/+$/, '')}/api/v1/${path}`);
    for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined) url.searchParams.set(key, value);
    return requestJson<T>(this.options, {
      method, url: url.href, body, signal: this.signal,
      headers: {authorization: `Bearer ${this.token}`, ...(requestId ? {'x-request-id': requestId} : {})},
    }, readTodoistRefusal, 'Todoist');
  }

  /** Items, projects and labels since `syncToken` ("*" for everything). */
  sync(syncToken: string): Promise<SyncAnswer> {
    return this.call('POST', 'sync', {body: new URLSearchParams({sync_token: syncToken, resource_types: JSON.stringify(['items', 'projects', 'labels'])})});
  }

  /**
   * One Sync command (SV-249), its uuid the command's request id so Todoist drops a repeat. Todoist
   * answers 200 either way: `sync_status[uuid]` is "ok", or its refusal with Todoist's own words.
   */
  async command(type: string, args: Record<string, unknown>, uuid: string): Promise<void> {
    const answer = await this.call<{sync_status?: Record<string, unknown>}>('POST', 'sync', {body: new URLSearchParams({commands: JSON.stringify([{type, uuid, args}])})});
    const status = answer?.sync_status?.[uuid];
    if (status === 'ok') return;
    if (!status || typeof status !== 'object') throw new ProviderError('transient', 'Todoist didn\'t say whether it took the change.');
    const code = typeof (status as {http_code?: unknown}).http_code === 'number' ? (status as {http_code: number}).http_code : 400;
    const refusal = readTodoistRefusal(code, JSON.stringify(status));
    throw new ProviderError(refusal.kind ?? kindOfStatus(code), refusal.message, {status: code});
  }

  /** Tasks completed between two instants, every page. */
  async completed(since: string, until: string): Promise<TodoistTask[]> {
    const tasks: TodoistTask[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.call<{items?: TodoistTask[]; next_cursor?: string | null}>('GET', 'tasks/completed/by_completion_date', {query: {since, until, limit: '200', cursor}});
      tasks.push(...(page?.items ?? []));
      cursor = page?.next_cursor ?? undefined;
    } while (cursor);
    return tasks;
  }

  /** A task event type's activity log entries in [since, until), every page (SV-251). */
  async activities(eventType: 'completed' | 'updated', since: string, until: string): Promise<TodoistActivity[]> {
    const events: TodoistActivity[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.call<{results?: TodoistActivity[]; next_cursor?: string | null}>('GET', 'activities', {
        query: {object_type: 'item', event_type: eventType, date_from: since, date_to: until, limit: '200', cursor},
      });
      events.push(...(page?.results ?? []));
      cursor = page?.next_cursor ?? undefined;
    } while (cursor);
    return events;
  }

  createProject(name: string, requestId: string): Promise<TodoistProject> {
    return this.call('POST', 'projects', {body: {name}, requestId});
  }

  updateProject(id: string, body: Record<string, unknown>, requestId: string): Promise<TodoistProject> {
    return this.call('POST', `projects/${encodeURIComponent(id)}`, {body, requestId});
  }

  createTask(body: Record<string, unknown>, requestId: string): Promise<TodoistTask> {
    return this.call('POST', 'tasks', {body, requestId});
  }

  updateTask(id: string, body: Record<string, unknown>, requestId: string): Promise<TodoistTask> {
    return this.call('POST', `tasks/${encodeURIComponent(id)}`, {body, requestId});
  }

  moveTask(id: string, projectId: string, requestId: string): Promise<unknown> {
    return this.call('POST', `tasks/${encodeURIComponent(id)}/move`, {body: {project_id: projectId}, requestId});
  }

  closeTask(id: string, requestId: string): Promise<unknown> {
    return this.call('POST', `tasks/${encodeURIComponent(id)}/close`, {requestId});
  }

  reopenTask(id: string, requestId: string): Promise<unknown> {
    return this.call('POST', `tasks/${encodeURIComponent(id)}/reopen`, {requestId});
  }

  deleteTask(id: string, requestId: string): Promise<unknown> {
    return this.call('DELETE', `tasks/${encodeURIComponent(id)}`, {requestId});
  }
}

/** The same request id for every attempt of one command, so Todoist can drop a repeat. */
export const requestIdFor = (commandId: number, step = '') => {
  const hex = createHash('sha256').update(`setpoint-command:${commandId}:${step}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
