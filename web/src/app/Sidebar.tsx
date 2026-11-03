// The sidebar (DESIGN.md › Layout › Shell): the mark and Setpoint; Inbox with the attention pill
// (not-Done attention, read or not) and the unread count; each account with its dot, label and
// unread count, filtering the Inbox (not on Calendar, board 11); Calendar; News, with no count ever
// (D87); Jobs while it's on (jobs/, a wiring point); the page's section (Today on mail pages and News, the mini-month and Calendars on Calendar);
// Settings pinned to the bottom.
// Counts left out at 0, as board 04 draws them.
//
// From 640 to 1099 px (the compact tier, #140) it's a 56 px rail: the mark, then Inbox, Calendar, News
// and Settings as icons, each named in its tooltip, with the attention pill as a badge on Inbox. The
// accounts and the page's section give way; ⌘K still filters by account and toggles calendars.
import type {AccountOut, MailCountsOut} from '@setpoint/shared';
import {useEffect, useMemo, useRef, useState} from 'react';
import type {CSSProperties, MouseEvent, ReactNode} from 'react';
import {useResource} from '../api/client.ts';
import {ACCOUNTS_PATH, COUNTS_PATH, markAllRead} from '../api/mail.ts';
import type {Route} from '../logic/route.ts';
import {routePath} from '../logic/route.ts';
import {Icon, Mark} from '../ui/Icon.tsx';
import {motion} from '../tokens.ts';
import {CalendarSidebar} from './calendar/CalendarSidebar.tsx';
import {openContextMenu} from './ContextMenu.tsx';
import type {MenuAction} from './ContextMenu.tsx';
import {Count} from './Count.tsx';
import {useCompact} from './Phone.tsx';
import {AccountsSkeleton} from './states/Skeletons.tsx';
import {reconnectFrom} from './states/States.tsx';
import {TodayBlock} from './TodayBlock.tsx';
import {dotStyle} from './accounts.ts';
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
 * Mark all as read from a sidebar row's right-click (DESIGN.md #248): the Inbox page's own, with its
 * Undo, while it shows that same mail; otherwise as ⌘K's is.
 */
function markAllReadOf(account: number | null): () => void {
  const route = currentRoute();
  const page = offered().commands.find(command => command.id === 'mark-all-read');
  if (page && route.page === 'inbox' && route.account === account) return page.run;
  return () => void markAllRead(account).catch(toastFailure('Couldn\'t mark all as read'));
}

/**
 * The attention pill (DESIGN.md › Layout › Shell): its count rolls (Count), and a rise registers from
 * the corner of the eye (shell-11): the pill swells to 1.22 and back over 260 ms. A fall, the user's
 * own Done, stays quiet. From none it scales in from .6; at none it scales out before it goes.
 */
function AttentionPill({value}: {value: number}) {
  // The value last seen, the number shown (the last one while it goes), whether it's arriving, and how many rises.
  const [seen, setSeen] = useState({value, shown: value, arriving: false, rises: 0});
  let current = seen;
  if (value !== seen.value) {
    current = {value, shown: value || seen.shown, arriving: seen.value === 0, rises: value > seen.value && seen.value > 0 ? seen.rises + 1 : seen.rises};
    setSeen(current);
  }
  const pill = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (current.rises) pill.current?.animate([{transform: 'none'}, {transform: 'scale(1.22)', offset: 0.4}, {transform: 'none'}], {duration: motion.slow, easing: motion.ease});
  }, [current.rises]);
  const going = value === 0 && current.shown > 0;
  useEffect(() => {
    if (!going) return;
    const timer = window.setTimeout(() => setSeen(last => (last.value === 0 ? {...last, shown: 0} : last)), motion.fast);
    return () => window.clearTimeout(timer);
  }, [going]);
  if (current.shown === 0) return null;
  const classes = ['apill num', current.arriving && !going && 'arriving', going && 'going'].filter(Boolean).join(' ');
  return <span ref={pill} className={classes} data-tip="Attention, not Done"><Count value={current.shown} /></span>;
}

/** The sidebar. Its accounts are three skeleton rows until their answer comes. */
export function Sidebar({route}: {route: Route}) {
  const {data: counts} = useResource<MailCountsOut>(COUNTS_PATH);
  const {data: loadedAccounts} = useResource<AccountOut[]>(ACCOUNTS_PATH);
  const accounts = useMemo(() => (loadedAccounts ? [...loadedAccounts].sort((a, b) => a.position - b.position) : null), [loadedAccounts]);
  const unreadOf = (id: number) => counts?.accounts.find(account => account.account_id === id)?.unread ?? 0;
  const filtered = route.page === 'inbox' ? route.account : null;
  const rail = useCompact();
  // The rail names each icon in its tooltip and for a screen reader; the full sidebar shows the names.
  const named = (label: string) => (rail ? label : undefined);

  return (
    <aside className="sb">
      <div className="sb-top">
        <Mark />
        {!rail && <span className="sb-name">Setpoint</span>}
      </div>
      {/* Filtered by an account, Inbox reads as its parent beside the account's chip (#166); the rail has no
          accounts, so there Inbox stays the current page. */}
      <Link className={route.page === 'inbox' ? (filtered && !rail ? 'nav parent' : 'nav on') : 'nav'} tip={named('Inbox')} to={route.page === 'inbox' ? {...route, account: null, open: null} : toInbox()}
        onContextMenu={event => counts && counts.unread > 0 && openContextMenu(event, event.currentTarget, [
          {id: 'mark-all-read', label: 'Mark all as read', icon: 'mark_email_read', hint: '⇧I', run: markAllReadOf(null)},
        ])}>
        <Icon name="inbox" />
        <span className="grow">Inbox</span>
        {counts && <AttentionPill value={counts.attention} />}
        {counts && counts.unread > 0 && <span className="cnt num"><Count value={counts.unread} /></span>}
      </Link>
      {/* On Calendar the accounts fold away to the page's section (board 11), over 180 ms rather than
          in one frame, so Calendar slides up under the pointer that clicked it (shell-08). Until they
          come, a skeleton. */}
      {!rail && (
        <div className={route.page === 'calendar' ? 'sb-accts folded' : 'sb-accts'} inert={route.page === 'calendar'}>
          <div>
            {accounts === null ? <AccountsSkeleton count={3} /> : accounts.map(account => {
              const unread = unreadOf(account.id);
              const on = filtered === account.id;
              const reconnect = account.health.state === 'needs_reconnect';
              return (
                <Link key={account.id} className={on ? 'acct on' : 'acct'} style={dotStyle(account.colour)}
                  to={route.page === 'inbox' ? {...route, account: on ? null : account.id, open: null} : toInbox(account.id)}
                  onContextMenu={event => openContextMenu(event, event.currentTarget, [
                    ...(unread > 0 ? [{id: 'mark-all-read', label: 'Mark all as read', icon: 'mark_email_read', run: markAllReadOf(account.id)} satisfies MenuAction] : []),
                    ...(reconnect ? [{id: 'reconnect', label: 'Reconnect', icon: 'sync_problem', run: () => reconnectFrom([account])} satisfies MenuAction] : []),
                  ])}>
                  <span className="dot sm" />
                  {account.label}
                  {reconnect && <span className="reconnect" role="img" aria-label={`${account.label} needs sign-in`} data-tip={`${account.label} needs sign-in`}><Icon name="sync_problem" size={16} /></span>}
                  {unread > 0 && <span className="cnt num"><Count value={unread} /></span>}
                </Link>
              );
            })}
          </div>
        </div>
      )}
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
