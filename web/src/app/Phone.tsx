// The phone's shell (DESIGN.md › Phone; board 21): below 640 px the same pages and routes in one
// column, with Inbox and Agenda in a tab bar at the bottom in place of the sidebar. Settings stays on
// the desktop: a Settings link (a reconnect alert's) says so here, with Sign out.
import {useSyncExternalStore} from 'react';
import type {Route} from '../logic/route.ts';
import {routePath} from '../logic/route.ts';
import {Icon, Mark} from '../ui/Icon.tsx';
import {navigate} from './router.ts';
import {askSignOut} from './signOut.ts';
import {toInbox} from './toInbox.ts';

const PHONE = window.matchMedia('(max-width: 639px)');
const subscribe = (listener: () => void) => {
  PHONE.addEventListener('change', listener);
  return () => PHONE.removeEventListener('change', listener);
};

/** Whether the page is laid out for the phone (phone.css's breakpoint). */
export const usePhone = () => useSyncExternalStore(subscribe, () => PHONE.matches);
/** The same, read once (a key handler's). */
export const isPhone = () => PHONE.matches;

const TABS: {label: string; icon: 'inbox' | 'calendar_today'; page: Route['page']; to: Route}[] = [
  {label: 'Inbox', icon: 'inbox', page: 'inbox', to: {page: 'inbox', view: 'unread', account: null, open: null}},
  {label: 'Agenda', icon: 'calendar_today', page: 'calendar', to: {page: 'calendar', date: null, item: null, at: null}},
];

export function PhoneTabs({route}: {route: Route}) {
  return (
    <nav className="ph-tabs" aria-label="Pages">
      {TABS.map(tab => (
        <a key={tab.page} className={route.page === tab.page ? 'ph-tab on' : 'ph-tab'} href={routePath(tab.to)} onClick={event => {
          event.preventDefault();
          navigate(tab.page === 'inbox' ? toInbox() : tab.to);
        }}>
          <Icon name={tab.icon} size={22} />{tab.label}
        </a>
      ))}
    </nav>
  );
}

/** A Settings page's address on the phone. */
export function PhoneSettings() {
  return (
    <>
      <header className="hd">
        <Mark />
        <span className="hd-title">Settings</span>
      </header>
      <div className="content ph-settings">
        <p>Settings is on the desktop</p>
        <button className="btn ghost" type="button" onClick={askSignOut}><Icon name="door_open" size={17} />Sign out</button>
      </div>
    </>
  );
}
