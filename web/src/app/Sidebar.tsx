// The sidebar (DESIGN.md › Layout › Shell): the mark and Setpoint; Inbox with the attention pill
// (not-Done attention, read or not) and the unread count; each account with its dot, label and
// unread count, filtering the Inbox (not on Calendar, board 11); Calendar; News, with no count ever
// (D87); the page's section (Today on mail pages and News, the mini-month and Calendars on Calendar);
// Settings pinned to the bottom.
// Counts left out at 0, as board 04 draws them.
//
// From 640 to 1099 px (the compact tier, #258) it's a 56 px rail: the mark, then Inbox, Calendar, News
// and Settings as icons, each named in its tooltip, with the attention pill as a badge on Inbox. The
// accounts and the page's section give way; ⌘K still filters by account and toggles calendars.
import type {MailCountsOut} from '@setpoint/shared';
import type {CSSProperties, MouseEvent, ReactNode} from 'react';
import {useResource} from '../api/client.ts';
import {COUNTS_PATH} from '../api/mail.ts';
import type {Route} from '../logic/route.ts';
import {routePath} from '../logic/route.ts';
import {Icon, Mark} from '../ui/Icon.tsx';
import {CalendarSidebar} from './calendar/CalendarSidebar.tsx';
import {useCompact} from './Phone.tsx';
import {TodayBlock} from './TodayBlock.tsx';
import {dotStyle, useAccounts} from './accounts.ts';
import {navigate} from './router.ts';
import {openSettings} from './settings/store.ts';
import {toInbox} from './toInbox.ts';

/** A link that the app follows itself; ⌘-click still opens a new tab. */
function Link({to, className, style, title, children}: {to: Route; className: string; style?: CSSProperties; title?: string; children: ReactNode}) {
  const onClick = (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(to);
  };
  return <a className={className} style={style} title={title} href={routePath(to)} onClick={onClick}>{children}</a>;
}

export function Sidebar({route}: {route: Route}) {
  const {data: counts} = useResource<MailCountsOut>(COUNTS_PATH);
  const {list: accounts} = useAccounts();
  const unreadOf = (id: number) => counts?.accounts.find(account => account.account_id === id)?.unread ?? 0;
  const filtered = route.page === 'inbox' ? route.account : null;
  const rail = useCompact();
  // The rail names each icon in its tooltip; the full sidebar shows the names.
  const named = (label: string) => (rail ? label : undefined);

  return (
    <aside className="sb">
      <div className="sb-top">
        <Mark />
        {!rail && <span className="sb-name">Setpoint</span>}
      </div>
      <Link className={route.page === 'inbox' && !filtered ? 'nav on' : 'nav'} title={named('Inbox')} to={route.page === 'inbox' ? {...route, account: null, open: null} : toInbox()}>
        <Icon name="inbox" />
        <span className="grow">Inbox</span>
        {counts && counts.attention > 0 && <span className="apill num" title="Attention, not Done">{counts.attention}</span>}
        {counts && counts.unread > 0 && <span className="cnt num">{counts.unread}</span>}
      </Link>
      {/* On Calendar the accounts give way to the page's section (board 11). */}
      {!rail && route.page !== 'calendar' && accounts.map(account => {
        const unread = unreadOf(account.id);
        const on = filtered === account.id;
        return (
          <Link key={account.id} className={on ? 'acct on' : 'acct'} style={dotStyle(account.colour)}
            to={route.page === 'inbox' ? {...route, account: on ? null : account.id, open: null} : toInbox(account.id)}>
            <span className="dot sm" />
            {account.label}
            {account.health.state === 'needs_reconnect' && <span className="reconnect" title={`${account.label} needs sign-in`}><Icon name="sync_problem" size={16} /></span>}
            {unread > 0 && <span className="cnt num">{unread}</span>}
          </Link>
        );
      })}
      <Link className={route.page === 'calendar' ? 'nav on' : 'nav'} title={named('Calendar')} style={route.page === 'calendar' || rail ? undefined : {marginTop: 2}} to={{page: 'calendar', date: null, item: null, at: null}}>
        <Icon name="calendar_month" />
        <span className="grow">Calendar</span>
      </Link>
      <Link className={route.page === 'news' ? 'nav on' : 'nav'} title={named('News')} to={{page: 'news', view: 'all', story: null, article: null}}>
        <Icon name="newspaper" />
        <span className="grow">News</span>
      </Link>
      {!rail && (route.page === 'calendar' ? <CalendarSidebar route={route} /> : <TodayBlock />)}
      <div className="sb-foot">
        {/* Settings opens over the page (settings/store.ts); its address still works in a new tab. */}
        <a className="nav" title={named('Settings · ⌘,')} href={routePath({page: 'settings', section: 'accounts'})} onClick={event => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          openSettings('accounts');
        }}>
          <Icon name="settings" />
          <span className="grow">Settings</span>
          <span className="kbd">⌘,</span>
        </a>
      </div>
    </aside>
  );
}
