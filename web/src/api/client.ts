// Setpoint's JSON API, with darma's small shared cache: a view shows what it last fetched at once
// and refreshes behind it, on mount, on focus and when a live event names it (live.ts). A write's
// answer, or its at-once effect (opening an email drops the counts), goes into the cache straight
// away. A 401 means the session is gone, and the sign-in card takes over (auth.ts), unless this
// browser has replaced it meanwhile. This folder is the only place that talks to the server (the lint
// enforces it).
import type {ApiError} from '@setpoint/shared';
import {useEffect, useSyncExternalStore} from 'react';

export class ApiFailure extends Error {
  // 0 when the server couldn't be reached.
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let unauthorized: () => Promise<boolean> = async () => false;

/** What a 401 does: auth.ts asks whether this browser is still signed in, and shows the sign-in card if it isn't. */
export function onUnauthorized(handler: () => Promise<boolean>) {
  unauthorized = handler;
}

// Why changes are refused for now (offline: live.ts), or null. They're refused, never queued.
let refusal: string | null = null;
export function refuseWrites(reason: string | null) {
  refusal = reason;
}

// Writes made since a load began can't be in its answer, so a load only stands if none came after.
let writes = 0;

async function request<T>(method: string, path: string, body?: unknown, {quiet401 = false, keepalive = false} = {}, again = false): Promise<T> {
  let response: Response;
  let json: unknown;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: {Accept: 'application/json', ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
      body: body === undefined ? undefined : JSON.stringify(body),
      // A change sent as the page goes away (a delete still waiting out its Undo) outlives it.
      keepalive,
    });
    json = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  } catch {
    throw new ApiFailure(0, 'unreachable', 'Can’t reach Setpoint');
  }
  // A change in Settings › Security ends every session and answers with a new one, so a request that
  // left under the old one and reached the server after the change is refused though this browser is
  // still signed in: then it's asked once more, under the new one.
  if (response.status === 401 && !quiet401 && !again && await unauthorized()) return request<T>(method, path, body, {quiet401, keepalive}, true);
  if (!response.ok) {
    const error = (json as ApiError | undefined)?.error;
    throw new ApiFailure(response.status, error?.code ?? 'http_error', error?.message ?? response.statusText, error?.details);
  }
  return json as T;
}

export const getJson = <T>(path: string, options?: {quiet401?: boolean}) => request<T>('GET', path, undefined, options);

export async function sendJson<T>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown, options?: {quiet401?: boolean; keepalive?: boolean}): Promise<T> {
  if (refusal) throw new ApiFailure(0, 'offline', refusal);
  writes += 1;
  try {
    return await request<T>(method, path, body, options);
  } finally {
    writes += 1;
  }
}

interface Entry {
  data?: unknown;
  error?: Error;
  loading?: Promise<void>;
  // A load queued behind the one in flight, for a change made after that one began.
  again?: Promise<void>;
  // Bumped by setCached, so a load that began earlier doesn't overwrite what a write showed.
  version: number;
  // When the load whose answer `data` is began (or the write that put it there was made), so a view
  // can tell an answer asked for since it opened from one it found waiting.
  askedAt?: number;
  snapshot: {data?: unknown; error?: Error; askedAt?: number};
}

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
const mounted = new Map<string, number>();
const notify = () => listeners.forEach(listener => listener());

function entry(path: string): Entry {
  let found = cache.get(path);
  if (!found) {
    found = {snapshot: {}, version: 0};
    cache.set(path, found);
  }
  return found;
}

/** Loads `path`; a load already in flight that began before a later write loads once more after it. */
export function refresh(path: string): Promise<void> {
  const current = entry(path);
  if (current.loading) {
    current.again ??= current.loading.then(() => {
      current.again = undefined;
      return refresh(path);
    });
    return current.again;
  }
  const version = current.version;
  const writesAtStart = writes;
  const askedAt = Date.now();
  current.loading = getJson<unknown>(path).then(
    data => {
      if (current.version !== version) return;
      current.data = data;
      current.error = undefined;
      current.askedAt = askedAt;
      // A write went out meanwhile, so this answer may be from before it: load again.
      if (writes !== writesAtStart) queueMicrotask(() => void refresh(path));
    },
    (error: Error) => {
      current.error = error;
    },
  ).finally(() => {
    current.loading = undefined;
    current.snapshot = {data: current.data, error: current.error, askedAt: current.askedAt};
    notify();
  });
  return current.loading;
}

/**
 * Loads `path` ahead of the view that shows it (Settings' pages, as Settings opens): only one that
 * has no answer and isn't on its way, so it never asks twice.
 */
export function prefetch(path: string) {
  const found = cache.get(path);
  if (found && (found.loading || found.data !== undefined)) return;
  void refresh(path);
}

/** The resources on screen. */
export const mountedPaths = () => [...mounted.keys()];

/** Refreshes a resource on screen; one that isn't is forgotten, so it loads fresh when it shows. */
export function refreshIfShown(path: string) {
  if (mounted.has(path)) void refresh(path);
  else cache.delete(path);
}

/** Refreshes everything on screen (focus, a resync, signing in again). */
export function refreshAll() {
  for (const path of [...cache.keys()]) refreshIfShown(path);
}

/** Forgets every answer, after signing out. */
export function clearCache() {
  cache.clear();
  notify();
}

/** What `path` last answered, or what a write put there. */
export const getCached = <T>(path: string) => cache.get(path)?.data as T | undefined;

/** Shows a write's answer or at-once effect now. */
export function setCached(path: string, data: unknown) {
  const current = entry(path);
  current.version += 1;
  current.data = data;
  current.error = undefined;
  current.askedAt = Date.now();
  current.snapshot = {data, askedAt: current.askedAt};
  notify();
}

/** Changes what `path` shows now, if it has loaded. */
export function updateCached<T>(path: string, change: (data: T) => T) {
  const data = getCached<T>(path);
  if (data !== undefined) setCached(path, change(data));
}

/** Every loaded path that starts with `prefix`. */
export const cachedPaths = (prefix: string) => [...cache.keys()].filter(path => path === prefix || path.startsWith(`${prefix}?`) || path.startsWith(`${prefix}/`));

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function mountResource(path: string): () => void {
  const shown = mounted.has(path);
  mounted.set(path, (mounted.get(path) ?? 0) + 1);
  if (!shown) void refresh(path);
  return () => {
    const count = (mounted.get(path) ?? 1) - 1;
    if (count) mounted.set(path, count);
    else mounted.delete(path);
  };
}

const EMPTY = {};

/**
 * The latest answer for `path` (undefined until the first), refreshed while it's on screen, and when
 * the load it came from began (`askedAt`).
 */
export function useResource<T>(path: string | null): {data: T | undefined; error: Error | undefined; askedAt?: number} {
  const read = () => (path ? entry(path).snapshot : EMPTY);
  const snapshot = useSyncExternalStore(subscribe, read, read);
  useEffect(() => (path ? mountResource(path) : undefined), [path]);
  return snapshot as {data: T | undefined; error: Error | undefined; askedAt?: number};
}

// useResources' last answer per list of paths, so it hands React the same array until one changes.
const lists = new Map<string, {snapshots: Entry['snapshot'][]; data: unknown[]}>();

/** The latest answers for several paths at once (All's pages), each refreshed while on screen. */
export function useResources<T>(paths: string[]): (T | undefined)[] {
  const key = paths.join('\n');
  const read = () => {
    const snapshots = paths.map(path => entry(path).snapshot);
    const last = lists.get(key);
    if (last && last.snapshots.every((snapshot, index) => snapshot === snapshots[index])) return last.data;
    const data = snapshots.map(snapshot => snapshot.data);
    lists.set(key, {snapshots, data});
    return data;
  };
  const data = useSyncExternalStore(subscribe, read, read);
  useEffect(() => {
    const unmount = key ? key.split('\n').map(mountResource) : [];
    return () => {
      unmount.forEach(done => done());
      lists.delete(key);
    };
  }, [key]);
  return data as (T | undefined)[];
}

if (typeof window !== 'undefined') window.addEventListener('focus', refreshAll);

/**
 * A command on an email or an item while its last one still waits for the provider (opening it,
 * then Trash at once; Undo while Trash or Complete is on its way) is refused with `command_pending`:
 * it's sent again once that one settles, for up to ten seconds.
 */
export async function afterPending<T>(send: () => Promise<T>, waitMs = 10_000): Promise<T> {
  const ends = Date.now() + waitMs;
  for (;;) {
    try {
      return await send();
    } catch (error) {
      if (!(error instanceof ApiFailure && error.code === 'command_pending') || Date.now() > ends) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
}
