// The sidebar (DESIGN.md › Layout › Shell): the mark and Setpoint; Inbox with the red unread badge
// (SV-221, D471), its only count, and no account rows under it (D476); Calendar; News, with no count ever
// (D87); Jobs while it's on (jobs/, a wiring point); the page's section (Today on mail pages and News, the mini-month and Calendars on Calendar);
// Settings pinned to the bottom.
//
// Folded it's a 56 px rail (#140): the mark, then Inbox, Calendar, News, Jobs and Settings as icons, each
// named in its tooltip, with the unread badge on Inbox. The page's section gives way to the next-up slot
// (TodayBlock's, D509); ⌘K still toggles calendars. Always the rail from 640 to 1099 px (the compact tier); from 1100 it starts as the rail
// below 1600 px, and `` ` `` or a click on its edge opens and folds it, kept by this browser (sidebarRail.ts;
// D507); the pointer resting on the rail brings the whole sidebar out over the page until it leaves.
import type {MailCountsOut} from '@setpoint/shared';
import {useEffect, useRef, useState} from 'react';
import type {CSSProperties, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode} from 'react';
import {useResource} from '../api/client.ts';
import {COUNTS_PATH, markAllRead} from '../api/mail.ts';
import type {Route} from '../logic/route.ts';
import {routePath} from '../logic/route.ts';
import {Icon, Mark} from '../ui/Icon.tsx';
import {CalendarSidebar} from './calendar/CalendarSidebar.tsx';
import {openContextMenu} from './ContextMenu.tsx';
import {TodayBlock} from './TodayBlock.tsx';
import {UnreadBadge} from './UnreadBadge.tsx';
import {JobsNavItem} from './jobs/index.ts';
import {offered} from './palette/commands.ts';
import {currentRoute, navigate} from './router.ts';
import {openSettings} from './settings/store.ts';
import {toggleSidebar, useRail, useSidebarFoldable} from './sidebarRail.ts';
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

// How long the pointer rests on the rail before the sidebar comes out, so a pass or a quick click on an
// icon doesn't bring it, and how long it's away from it before the sidebar folds back.
const PEEK_OPEN_MS = 200;
const PEEK_CLOSE_MS = 100;
// What the sidebar opens stays part of it: a Today line's card, a menu or popover.
const PEEK_PARTS = '.sb, .sb-edge, .today-card, .pop';

/**
 * The rail brought out by the pointer (from 1100 px, D507): a mouse resting on it for 200 ms shows the
 * whole sidebar over the page, and 100 ms anywhere else, or out of the window, folds it back, once
 * no Today card is open from it. On the rail's next-up slot, or with its card open, it stays the rail,
 * so the slot can be clicked (D509).
 */
function usePeek(enabled: boolean) {
  const [peek, setPeek] = useState(false);
  const timer = useRef(0);
  // The rest before it comes out, while one is counting.
  const opening = useRef(0);
  const stopOpening = () => {
    window.clearTimeout(opening.current);
    opening.current = 0;
  };
  if (!enabled && peek) setPeek(false);
  useEffect(() => () => {
    window.clearTimeout(timer.current);
    window.clearTimeout(opening.current);
  }, []);
  useEffect(() => {
    if (!peek) return;
    // A Today line's card open from it holds it out until the card closes.
    const later = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => (document.querySelector('.today-card') ? later() : setPeek(false)), PEEK_CLOSE_MS);
    };
    const onOver = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(PEEK_PARTS)) window.clearTimeout(timer.current);
      else later();
    };
    const onOut = (event: PointerEvent) => {
      if (!event.relatedTarget) later();
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
    };
  }, [peek]);
  const onPointerOver = (event: ReactPointerEvent) => {
    if (!enabled || peek || event.pointerType !== 'mouse') return;
    if ((event.target instanceof Element && event.target.closest('.next-up')) || document.querySelector('.today-card')) {
      stopOpening();
      return;
    }
    if (opening.current) return;
    opening.current = window.setTimeout(() => {
      opening.current = 0;
      setPeek(true);
    }, PEEK_OPEN_MS);
  };
  return {peek: enabled && peek, onPointerOver, onPointerLeave: stopOpening};
}

/** The sidebar. */
export function Sidebar({route}: {route: Route}) {
  const {data: counts} = useResource<MailCountsOut>(COUNTS_PATH);
  const folded = useRail();
  const foldable = useSidebarFoldable();
  const {peek, onPointerOver, onPointerLeave} = usePeek(folded && foldable);
  const rail = folded && !peek;
  // The rail names each icon in its tooltip and for a screen reader; the full sidebar shows the names.
  const named = (label: string) => (rail ? label : undefined);

  return (
    <>
      <aside className={['sb', rail && 'rail', peek && 'peek'].filter(Boolean).join(' ')} onPointerOver={onPointerOver} onPointerLeave={onPointerLeave}>
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
        {rail ? <TodayBlock rail /> : route.page === 'calendar' ? <CalendarSidebar route={route} /> : <TodayBlock />}
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
      {foldable && <SidebarEdge rail={folded} peek={peek} />}
    </>
  );
}

/**
 * The sidebar's right edge, from 1100 px up: a click opens the rail or folds the sidebar, as `` ` `` does;
 * on the sidebar the pointer brought out, it keeps it open.
 * At rest it's only the border; under the pointer, as the reading pane's edge (styles.css), a 2 px
 * `accent` line covers it and a pill at its middle shows which way it goes. It sits beside the sidebar,
 * not in it, since the sidebar clips.
 */
function SidebarEdge({rail, peek}: {rail: boolean; peek: boolean}) {
  const label = peek ? 'Keep the sidebar open' : rail ? 'Open the sidebar' : 'Fold the sidebar';
  return (
    <button className="sb-edge" type="button" aria-label={label} aria-expanded={!rail} data-tip={`${label} · \``}
      onClick={() => toggleSidebar()}>
      <span className="grip"><Icon name={rail ? 'chevron_right' : 'chevron_left'} size={14} /></span>
    </button>
  );
}
