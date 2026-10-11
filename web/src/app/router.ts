// The address bar as the app's route (logic/route.ts has the paths), darma's way: history.pushState
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
 * last used (DESIGN.md › Week view).
 */
function withView(route: Route): Route {
  if (route.page !== 'calendar' || route.view) return route;
  const here = currentRoute();
  const view = here.page === 'calendar' ? here.view ?? 'month' : rememberedMode();
  return {...route, view};
}

// An address opened from outside (a reload, an ntfy link) that names no view opens in the last one used.
{
  const first = currentRoute();
  if (first.page === 'calendar' && !first.view && rememberedMode() === 'week') {
    window.history.replaceState(window.history.state, '', routePath({...first, view: 'week'}));
  }
}

export function navigate(route: Route, {replace = false} = {}) {
  const path = routePath(withView(route));
  if (path === address()) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
  notify();
}
