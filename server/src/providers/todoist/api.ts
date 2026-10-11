// Todoist's unified API (v1, as v1 used) over plain fetch: the Sync endpoint for the mirror, the
// completed-tasks list for occurrences completed in Todoist's own apps, and the task endpoints for
// changes. Errors carry Todoist's own words; 401 and 403 mean the connection was revoked (v1 never
// treated them so, see SV-6), 429 waits.
import {createHash} from 'node:crypto';
import {ProviderError} from '../../sync/errors.ts';
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
  // F6b: label names.
  labels?: string[];
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
