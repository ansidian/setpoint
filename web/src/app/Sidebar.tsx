// The sidebar (DESIGN.md › Layout › Shell): the mark and Setpoint; Inbox with the attention pill
// (not-Done attention, read or not) and the unread count; each account with its dot, label and
// unread count, filtering the Inbox (not on Calendar, board 11); Calendar; News, with no count ever
// (D87); the page's section (Today on mail pages and News, the mini-month and Calendars on Calendar);
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
import {ACCOUNTS_PATH, COUNTS_PATH} from '../api/mail.ts';
import type {Route} from '../logic/route.ts';
import {routePath} from '../logic/route.ts';
import {FIRST_ACCOUNTS, shapeOf} from '../logic/shape.ts';
import type {ShapeAccount} from '../logic/shape.ts';
import {Icon, Mark} from '../ui/Icon.tsx';
import {motion} from '../tokens.ts';
import {CalendarSidebar} from './calendar/CalendarSidebar.tsx';
import {Count} from './Count.tsx';
import {useCompact} from './Phone.tsx';
import {lastShape, rememberShape} from './lastShape.ts';
import {AccountsSkeleton} from './states/Skeletons.tsx';
import {TodayBlock} from './TodayBlock.tsx';
import {dotStyle} from './accounts.ts';
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
  return <span ref={pill} className={classes} title="Attention, not Done"><Count value={current.shown} /></span>;
}

/**
 * The sidebar. Its accounts and counts are this browser's last-known ones until their answers come,
 * which then settle them in place, or a skeleton on a first visit, so nothing under them moves (#234).
 * `frame`: drawn while Setpoint starts, before it may ask for anything (ShellFrame.tsx).
 */
export function Sidebar({route, frame = false}: {route: Route; frame?: boolean}) {
  const {data: loadedCounts} = useResource<MailCountsOut>(frame ? null : COUNTS_PATH);
  const {data: loadedAccounts} = useResource<AccountOut[]>(frame ? null : ACCOUNTS_PATH);
  // What the sidebar last showed, read as it first draws.
  const [kept] = useState(lastShape);
  const fresh = useMemo(() => (loadedAccounts ? shapeOf(loadedAccounts, loadedCounts, null) : null), [loadedAccounts, loadedCounts]);
  useEffect(() => {
    if (fresh?.counts) rememberShape({accounts: fresh.accounts, counts: fresh.counts});
  }, [fresh]);
  const accounts: ShapeAccount[] | null = fresh?.accounts ?? kept?.accounts ?? null;
  const counts = loadedCounts ?? kept?.counts ?? null;
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
      {/* Filtered by an account, Inbox reads as its parent beside the account's chip (#166); the rail has no
          accounts, so there Inbox stays the current page. */}
      <Link className={route.page === 'inbox' ? (filtered && !rail ? 'nav parent' : 'nav on') : 'nav'} title={named('Inbox')} to={route.page === 'inbox' ? {...route, account: null, open: null} : toInbox()}>
        <Icon name="inbox" />
        <span className="grow">Inbox</span>
        {counts && <AttentionPill value={counts.attention} />}
        {counts && counts.unread > 0 && <span className="cnt num"><Count value={counts.unread} /></span>}
      </Link>
      {/* On Calendar the accounts fold away to the page's section (board 11), over 180 ms rather than
          in one frame, so Calendar slides up under the pointer that clicked it (shell-08). Until they
          come, the ones this browser last showed, or a skeleton on a first visit (#234). */}
      {!rail && (
        <div className={route.page === 'calendar' ? 'sb-accts folded' : 'sb-accts'} inert={route.page === 'calendar'}>
          <div>
            {accounts === null ? <AccountsSkeleton count={FIRST_ACCOUNTS} /> : accounts.map(account => {
              const unread = unreadOf(account.id);
              const on = filtered === account.id;
              return (
                <Link key={account.id} className={on ? 'acct on' : 'acct'} style={dotStyle(account.colour)}
                  to={route.page === 'inbox' ? {...route, account: on ? null : account.id, open: null} : toInbox(account.id)}>
                  <span className="dot sm" />
                  {account.label}
                  {account.reconnect && <span className="reconnect" title={`${account.label} needs sign-in`}><Icon name="sync_problem" size={16} /></span>}
                  {unread > 0 && <span className="cnt num"><Count value={unread} /></span>}
                </Link>
              );
            })}
          </div>
        </div>
      )}
      <Link className={route.page === 'calendar' ? 'nav on' : 'nav'} title={named('Calendar')} to={{page: 'calendar', date: null, item: null, at: null}}>
        <Icon name="calendar_month" />
        <span className="grow">Calendar</span>
      </Link>
      <Link className={route.page === 'news' ? 'nav on' : 'nav'} title={named('News')} to={{page: 'news', view: 'all', story: null, article: null}}>
        <Icon name="newspaper" />
        <span className="grow">News</span>
      </Link>
      {!rail && (route.page === 'calendar' ? !frame && <CalendarSidebar route={route} /> : <TodayBlock frame={frame} />)}
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
