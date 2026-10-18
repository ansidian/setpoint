// The phone's shell (DESIGN.md › Phone; board 21): below 640 px the same pages and routes in one
// column, with Inbox and Agenda in a tab bar at the bottom in place of the sidebar. Settings stays on
// the desktop: a Settings link (a reconnect alert's) says so here, with Sign out.
import type {MailCountsOut} from '@setpoint/shared';
import {useSyncExternalStore} from 'react';
import {useResource} from '../api/client.ts';
import {COUNTS_PATH} from '../api/mail.ts';
import type {Route} from '../logic/route.ts';
import {routePath} from '../logic/route.ts';
import {viewport} from '../tokens.ts';
import {Icon, Mark} from '../ui/Icon.tsx';
import {currentRoute, navigate} from './router.ts';
import {askSignOut} from './signOut.ts';
import {toInbox} from './toInbox.ts';

const PHONE = window.matchMedia(`(max-width: ${viewport.phoneBelow - 1}px)`);
// The compact tier (#140): an iPad or a half-width window, the sidebar a rail and the panes over
// what they'd squeeze.
const COMPACT = window.matchMedia(`(min-width: ${viewport.phoneBelow}px) and (max-width: ${viewport.compactBelow - 1}px)`);
const follow = (query: MediaQueryList) => (listener: () => void) => {
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
};
const [onPhone, onCompact] = [follow(PHONE), follow(COMPACT)];

/** Whether the page is laid out for the phone (phone.css's breakpoint). */
export const usePhone = () => useSyncExternalStore(onPhone, () => PHONE.matches);
/** The same, read once (a key handler's). */
export const isPhone = () => PHONE.matches;
/**
 * Whether the page is in the compact tier, 640 to 1099 px (styles.css's and calendar.css's): the
 * sidebar is a rail, and Calendar's grid takes the width with the right pane over it.
 */
export const useCompact = () => useSyncExternalStore(onCompact, () => COMPACT.matches);

const TABS: {label: string; icon: 'inbox' | 'calendar_today'; page: Route['page']; to: Route; scroller: string}[] = [
  {label: 'Inbox', icon: 'inbox', page: 'inbox', to: {page: 'inbox', account: null, open: null}, scroller: '.content > .list'},
  {label: 'Agenda', icon: 'calendar_today', page: 'calendar', to: {page: 'calendar', date: null, item: null, at: null}, scroller: '.ph-agenda'},
];

/**
 * The tab bar (#142): the current tab in its filled glyph; the Inbox tab badged with the attention
 * count while Attention waits and the Inbox isn't showing (its header has the pill); a tap on the
 * current tab takes its list back to the top (the agenda to today), as the page's inner scroller is
 * out of reach of iOS's tap on the status bar.
 */
export function PhoneTabs({route}: {route: Route}) {
  const {data: counts} = useResource<MailCountsOut>(COUNTS_PATH);
  const waiting = route.page !== 'inbox' && counts ? counts.attention : 0;
  return (
    <nav className="ph-tabs" aria-label="Pages">
      {TABS.map(tab => {
        const on = route.page === tab.page;
        return (
          <a key={tab.page} className={on ? 'ph-tab on' : 'ph-tab'} href={routePath(tab.to)} aria-current={on ? 'page' : undefined} onClick={event => {
            event.preventDefault();
            const was = currentRoute().page;
            navigate(tab.page === 'inbox' ? toInbox() : tab.to);
            if (was === tab.page) document.querySelector(tab.scroller)?.scrollTo({top: 0, behavior: 'smooth'});
          }}>
            <Icon name={on ? `${tab.icon}-fill` : tab.icon} size={22} />{tab.label}
            {tab.page === 'inbox' && waiting > 0 && <span className="ph-badge num" title="Attention, not Done">{waiting}</span>}
          </a>
        );
      })}
    </nav>
  );
}

/** A Settings page's address on the phone. */
export function PhoneSettings() {
  return (
    <>
      <header className="hd">
        <Mark />
        <h1 className="hd-title">Settings</h1>
      </header>
      <div className="content ph-settings">
        <p>Settings is on the desktop</p>
        <button className="btn ghost" type="button" onClick={askSignOut}><Icon name="door_open" size={17} />Sign out</button>
      </div>
    </>
  );
}
