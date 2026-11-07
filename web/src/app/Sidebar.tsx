// The sidebar (DESIGN.md › Layout › Shell): the mark and Setpoint; Inbox with the red unread badge
// (SV-221, D471), its only count, and no account rows under it (D476); Calendar; News, with no count ever
// (D87); Jobs while it's on (jobs/, a wiring point); the page's section (Today on mail pages and News, the mini-month and Calendars on Calendar);
// Settings pinned to the bottom.
//
// From 640 to 1099 px (the compact tier, #140) it's a 56 px rail: the mark, then Inbox, Calendar, News
// and Settings as icons, each named in its tooltip, with the unread badge on Inbox. The page's
// section gives way; ⌘K still toggles calendars.
import type {MailCountsOut} from '@setpoint/shared';
import type {CSSProperties, MouseEvent, ReactNode} from 'react';
import {useResource} from '../api/client.ts';
import {COUNTS_PATH, markAllRead} from '../api/mail.ts';
import type {Route} from '../logic/route.ts';
import {routePath} from '../logic/route.ts';
import {Icon, Mark} from '../ui/Icon.tsx';
import {CalendarSidebar} from './calendar/CalendarSidebar.tsx';
import {openContextMenu} from './ContextMenu.tsx';
import {useCompact} from './Phone.tsx';
import {TodayBlock} from './TodayBlock.tsx';
import {UnreadBadge} from './UnreadBadge.tsx';
import {JobsNavItem} from './jobs/index.ts';
import {offered} from './palette/commands.ts';
import {currentRoute, navigate} from './router.ts';
import {openSettings} from './settings/store.ts';
import {toastFailure} from './toast.ts';
import {toInbox} from './toInbox.ts';

/** A link that the app follows itself; ⌘-click still opens a new tab. `tip` names it, in its tooltip and for a screen reader. */
function Link({to, className, style, tip, onContextMenu, children}: {
  to: Route;
  className: string;
  style?: CSSProperties;
  tip?: string;
  onContextMenu?: (event: MouseEvent<HTMLAnchorElement>) => void;
  children: ReactNode;
}) {
  const onClick = (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(to);
  };
  return <a className={className} style={style} aria-label={tip} data-tip={tip} href={routePath(to)} onClick={onClick} onContextMenu={onContextMenu}>{children}</a>;
}

/**
 * Mark all as read from Inbox's right-click (DESIGN.md #248): the Inbox page's own, with its Undo,
 * while it shows; otherwise as ⌘K's is.
 */
function markAllReadNow(): () => void {
  const page = offered().commands.find(command => command.id === 'mark-all-read');
  if (page && currentRoute().page === 'inbox') return page.run;
  return () => void markAllRead().catch(toastFailure('Couldn\'t mark all as read'));
}

/** The sidebar. */
export function Sidebar({route}: {route: Route}) {
  const {data: counts} = useResource<MailCountsOut>(COUNTS_PATH);
  const rail = useCompact();
  // The rail names each icon in its tooltip and for a screen reader; the full sidebar shows the names.
  const named = (label: string) => (rail ? label : undefined);

  return (
    <aside className="sb">
      <div className="sb-top">
        <Mark />
        {!rail && <span className="sb-name">Setpoint</span>}
      </div>
      <Link className={route.page === 'inbox' ? 'nav on' : 'nav'} tip={named('Inbox')} to={toInbox()}
        onContextMenu={event => counts && counts.unread > 0 && openContextMenu(event, event.currentTarget, [
          {id: 'mark-all-read', label: 'Mark all as read', icon: 'mark_email_read', hint: '⇧I', run: markAllReadNow()},
        ])}>
        <Icon name="inbox" />
        <span className="grow">Inbox</span>
        {counts && <UnreadBadge value={counts.unread} tip="Unread" />}
      </Link>
      <Link className={route.page === 'calendar' ? 'nav on' : 'nav'} tip={named('Calendar')} to={{page: 'calendar', date: null, item: null, at: null}}>
        <Icon name="calendar_month" />
        <span className="grow">Calendar</span>
      </Link>
      <Link className={route.page === 'news' ? 'nav on' : 'nav'} tip={named('News')} to={{page: 'news', view: 'all', story: null, article: null}}>
        <Icon name="newspaper" />
        <span className="grow">News</span>
      </Link>
      <JobsNavItem current={route.page === 'jobs'} />
      {!rail && (route.page === 'calendar' ? <CalendarSidebar route={route} /> : <TodayBlock />)}
      <div className="sb-foot">
        {/* Settings opens over the page (settings/store.ts); its address still works in a new tab. */}
        <a className="nav" aria-label={named('Settings')} data-tip={named('Settings · ⌘,')} href={routePath({page: 'settings', section: 'accounts'})} onClick={event => {
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
