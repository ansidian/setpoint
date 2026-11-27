// The phone's shell (board 21): below 640 px the same pages and routes in one
// column, with Inbox, Agenda and News in a tab bar at the bottom in place of the sidebar. Settings is
// a page of its own (settings/PhoneSettings.tsx), and News is its own page's (news/NewsPage.tsx), in
// one column.
import type {MailCountsOut} from '@setpoint/shared';
import {useSyncExternalStore} from 'react';
import {useResource} from '../api/client.ts';
import {COUNTS_PATH} from '../api/mail.ts';
import type {PlacePage} from '../logic/keptPlace.ts';
import type {Route} from '../logic/route.ts';
import {routePath} from '../logic/route.ts';
import {viewport} from '../tokens.ts';
import type {IconName} from '../ui/glyphs.ts';
import {Icon} from '../ui/Icon.tsx';
import {agendaToToday} from './calendar/agendaToday.ts';
import {useOverdue} from './calendar/overdueGroup.ts';
import {currentRoute, goTo} from './router.ts';
import {SelectBar, useSelectBar} from './phone/selectBar.tsx';

const PHONE = window.matchMedia(`(max-width: ${viewport.phoneBelow - 1}px)`);
// The compact tier: an iPad or a half-width window, the sidebar a rail and the panes over
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

// Each tab's glyph, and its filled one for the current tab. Material's newspaper is the same path filled.
const TABS: {label: string; icon: IconName; on: IconName; page: PlacePage; to: Route; scroller: string}[] = [
  {label: 'Inbox', icon: 'inbox', on: 'inbox-fill', page: 'inbox', to: {page: 'inbox', open: null}, scroller: '.content > .list'},
  {label: 'Agenda', icon: 'calendar_today', on: 'calendar_today-fill', page: 'calendar', to: {page: 'calendar', date: null, item: null, at: null}, scroller: '.ph-agenda'},
  {label: 'News', icon: 'newspaper', on: 'newspaper', page: 'news', to: {page: 'news', view: 'all', story: null, article: null}, scroller: '.ph-news'},
];

/**
 * The tab bar. The current tab shows in its filled glyph. The Inbox tab is badged with the attention
 * count while Attention waits and the Inbox isn't showing All or Attention (whose header has the pill), and the Agenda
 * tab with the overdue tasks' while any are and the Agenda isn't showing (its Overdue group lists
 * them). On Sent, Drafts, Snoozed and Settings the Inbox tab is lit, and a tap on it goes to the Inbox. A tap on the current tab takes its list back to the top, the agenda to today under its past
 * week, as the page's inner scroller is out of reach of iOS's tap on the status bar. While the
 * Inbox's Select is on, its bar takes the tabs' place.
 */
export function PhoneTabs({route}: {route: Route}) {
  const {data: counts} = useResource<MailCountsOut>(COUNTS_PATH);
  const pill = route.page === 'inbox' && (!route.view || route.view === 'all' || route.view === 'attention');
  const waiting = !pill && counts ? counts.attention : 0;
  const overdue = useOverdue().length;
  const late = route.page !== 'calendar' ? overdue : 0;
  const select = useSelectBar();
  if (select && route.page === 'inbox') return <SelectBar bar={select} />;
  return (
    <nav data-theme="night" className="ph-tabs" aria-label="Pages">
      {TABS.map(tab => {
        // Sent, Drafts, Snoozed and Settings are the Inbox's, from its title menu, as the desktop's rail lights Inbox on its lists.
        const on = route.page === tab.page || (tab.page === 'inbox' && (route.page === 'sent' || route.page === 'drafts' || route.page === 'snoozed' || route.page === 'settings'));
        return (
          <a key={tab.page} className={on ? 'ph-tab on' : 'ph-tab'} href={routePath(tab.to)} aria-current={on ? 'page' : undefined} onClick={event => {
            event.preventDefault();
            const was = currentRoute().page;
            // On the Agenda its glide to today is its fresh start: it leaves search and the open item.
            if (was === 'calendar' && tab.page === 'calendar' && agendaToToday()) return;
            goTo(tab.page);
            if (was === tab.page) document.querySelector(tab.scroller)?.scrollTo({top: 0, behavior: 'smooth'});
          }}>
            <Icon name={on ? tab.on : tab.icon} size={22} />{tab.label}
            {tab.page === 'inbox' && waiting > 0 && <span className="ph-badge num" data-tip="Attention, not Done">{waiting}</span>}
            {tab.page === 'calendar' && late > 0 && <span className="ph-badge num" data-tip="Overdue">{late}</span>}
          </a>
        );
      })}
    </nav>
  );
}
