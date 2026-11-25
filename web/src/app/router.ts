// The address bar as the app's route (logic/route.ts has the paths): history.pushState
// and a store React reads with useSyncExternalStore.
import {useSyncExternalStore} from 'react';
import {parseRoute, routePath} from '../logic/route.ts';
import type {Route} from '../logic/route.ts';
import {rememberedMode} from './calendar/mode.ts';

const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
window.addEventListener('popstate', notify);

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const address = () => `${window.location.pathname}${window.location.search}`;

let lastAddress = '';
let lastRoute: Route = parseRoute('/');
/** The route now, the same object until the address changes. */
export function currentRoute(): Route {
  const here = address();
  if (here !== lastAddress) {
    lastAddress = here;
    lastRoute = parseRoute(window.location.pathname, window.location.search);
  }
  return lastRoute;
}

export const useRoute = () => useSyncExternalStore(subscribe, currentRoute);

/**
 * A calendar address that names no view keeps the one showing, and from another page takes the one
 * last used.
 */
function withView(route: Route): Route {
  if (route.page !== 'calendar' || route.view) return route;
  const here = currentRoute();
  const view = here.page === 'calendar' ? here.view ?? 'month' : rememberedMode();
  return {...route, view};
}

// An address opened from outside (a reload, an ntfy link) that names no view opens in the last one used.
// An Inbox address from the account filter's time (?account=2) is the plain Inbox's.
{
  const first = currentRoute();
  if (first.page === 'calendar' && !first.view && rememberedMode() === 'week') {
    window.history.replaceState(window.history.state, '', routePath({...first, view: 'week'}));
  } else if (first.page === 'inbox' && new URLSearchParams(window.location.search).has('account')) {
    window.history.replaceState(window.history.state, '', routePath(first));
  }
}

/**
 * `overList` marks the entry as one the app's Back leaves with the history's Back (logic/phone.ts's
 * readerStep): the list it was opened from is the entry under it.
 */
export function navigate(route: Route, {replace = false, overList = false} = {}) {
  const path = routePath(withView(route));
  if (path === address()) return;
  window.history[replace ? 'replaceState' : 'pushState'](overList ? {overList: true} : null, '', path);
  notify();
}

/** Whether the entry showing was marked by navigate's `overList`. */
export const overList = () => (window.history.state as {overList?: unknown} | null)?.overList === true;

/** The history's Back, as the browser's: settles once the route has followed it. */
export function back(): Promise<void> {
  return new Promise(resolve => {
    window.addEventListener('popstate', () => resolve(), {once: true});
    window.history.back();
  });
}
