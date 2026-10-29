// Live updates: one Server-Sent Events stream, GET /api/events, while the user is signed in
// (shared/src/api/live.ts). Each event names what changed, and the app refetches only what it
// shows of that (logic/live.ts); `resync` refetches everything on screen. The browser reconnects on
// its own after a dropped connection with the last id; a stream that's refused (the server down, or
// the session gone) reconnects after a few seconds and asks whether it's still signed in.
//
// While the stream is down Setpoint is offline (DESIGN.md › Health and states): changes are refused
// at once rather than queued (client.ts), and if it's still down after a 2 s grace the pill says since
// when and the page dims, still readable (the polish audit's states-05), so a laptop waking or a
// Wi-Fi handoff never cries wolf. Retry now reconnects at once.
import {LIVE_EVENT_TYPES} from '@setpoint/shared';
import type {LiveEvent} from '@setpoint/shared';
import {useSyncExternalStore} from 'react';
import {pathsForEvent} from '../logic/live.ts';
import {serverNow} from './auth.ts';
import {mountedPaths, refresh, refreshAll, refuseWrites} from './client.ts';

/** How long a refused stream, or a launch that found Setpoint unreachable (Root), waits to try again. */
export const RECONNECT_MS = 5000;

let source: EventSource | null = null;
let lastId: string | null = null;
let timer: number | undefined;
let onRefused: () => void = () => {};

/** How long the stream may be down before the page says so (states-05). */
export const OFFLINE_GRACE_MS = 2000;

/** Down since this moment (the server's clock), or null while the stream is up; changes are refused meanwhile. */
let downSince: number | null = null;
/** The same moment once the grace has passed and the page says so, or null. */
let offlineSince: number | null = null;
let grace: number | undefined;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach(listener => listener());

function setOffline(offline: boolean) {
  if (offline === (downSince !== null)) return;
  downSince = offline ? serverNow() : null;
  refuseWrites(offline ? 'Setpoint is offline: changes wait until it’s back.' : null);
  window.clearTimeout(grace);
  if (offline) {
    grace = window.setTimeout(() => {
      offlineSince = downSince;
      tell();
    }, OFFLINE_GRACE_MS);
  } else {
    offlineSince = null;
  }
  tell();
  // Back: whatever changed meanwhile shows.
  if (!offline) refreshAll();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Offline since this moment, once it's lasted the grace: the pill and the dim show it. */
export const useOfflineSince = () => useSyncExternalStore(subscribe, () => offlineSince);

/** Whether changes are refused now: from the moment the stream drops, before the pill shows. */
export const writesRefused = () => downSince !== null;
export const useDown = () => useSyncExternalStore(subscribe, writesRefused);

function connect() {
  timer = undefined;
  const stream = new EventSource(lastId ? `/api/events?last_event_id=${encodeURIComponent(lastId)}` : '/api/events');
  source = stream;
  const note = (event: MessageEvent) => {
    if (event.lastEventId) lastId = event.lastEventId;
  };
  stream.addEventListener('ready', event => {
    note(event);
    setOffline(false);
  });
  for (const type of LIVE_EVENT_TYPES) {
    stream.addEventListener(type, event => {
      note(event);
      let live: LiveEvent;
      try {
        live = JSON.parse(event.data as string) as LiveEvent;
      } catch {
        return;
      }
      for (const path of pathsForEvent(live, mountedPaths())) void refresh(path);
    });
  }
  stream.addEventListener('resync', event => {
    note(event);
    refreshAll();
  });
  stream.onerror = () => {
    if (source !== stream) return;
    setOffline(true);
    if (stream.readyState !== EventSource.CLOSED) return;
    source = null;
    onRefused();
    timer = window.setTimeout(connect, RECONNECT_MS);
  };
}

/** Opens the stream; `refused` runs when it's turned away, to check the session. */
export function startLive(refused: () => void) {
  onRefused = refused;
  if (source || timer !== undefined) return;
  connect();
}

/** Closes the stream (signed out); signing in again resumes from the last id. */
export function stopLive() {
  window.clearTimeout(timer);
  timer = undefined;
  source?.close();
  source = null;
  setOffline(false);
}

/** The offline pill's Retry now: a fresh connection now, rather than at the browser's next try. */
export function retryNow() {
  window.clearTimeout(timer);
  timer = undefined;
  source?.close();
  connect();
}

// The browser losing its network drops the stream at once (an open stream would otherwise hang until
// TCP gives up), and getting it back reconnects without waiting for the next try.
window.addEventListener('offline', () => {
  if (!source && timer === undefined) return;
  setOffline(true);
  retryNow();
});
window.addEventListener('online', () => {
  if (source || timer !== undefined) retryNow();
});
