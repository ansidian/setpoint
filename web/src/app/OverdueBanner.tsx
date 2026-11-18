// The overdue banner: on an arrival with Todoist tasks overdue that this browser hasn't shown, the
// page dims under its own colour and the task sits on it large, with no card or chrome. An arrival
// is a page load or the user coming back after being away (app/arrival.ts), so a task going
// overdue mid-use raises nothing until the next one, and a banner due while they're away waits for
// their return. One task is its title over its ring, project and due ("Errands · Due today, 8:00
// AM"). Several are "3 tasks" over a list, the most recently due first, four and "and 3 more".
// It enters over the length of its fade, and until then takes no click or key: they go to the
// page under it, as the click that brings the window back does. Then a click anywhere or Esc
// dismisses it, and marks its tasks shown in this browser (overdueShown.ts) so it doesn't come
// back for them. While it's up no other key acts, on it or the page under it, and its click
// reaches nothing else. It sits over every page and the composer, under the toast. It waits while
// Settings or ⌘K is open, and isn't drawn below 640 px (App.tsx). It fades in and out (120 ms, the
// veil 180 ms).
import type {ItemOut, ItemsOut} from '@setpoint/shared';
import {useCallback, useEffect, useRef, useState} from 'react';
import type {SyntheticEvent} from 'react';
import {serverNow, timeZone} from '../api/auth.ts';
import {useResource} from '../api/client.ts';
import {itemsPath} from '../api/items.ts';
import {overdueTasks} from '../logic/overdue.ts';
import type {Overdue} from '../logic/overdue.ts';
import {arrivalTasks, bannerRange, dueLine, listed, shortDue, shownKey} from '../logic/overdueBanner.ts';
import {motion} from '../tokens.ts';
import {useRingColour} from './calendar/Chip.tsx';
import {useArrival} from './arrival.ts';
import type {Arrival} from './arrival.ts';
import {markShown, shownTasks} from './overdueShown.ts';
import {usePaletteOpen} from './palette/Palette.tsx';
import {useSettingsPage} from './settings/store.ts';
import './overdue.css';

// While the banner is up, every key comes here first. It's listened for from the start, ahead of
// every page's own listeners, so none of them sees a key before the banner has kept it.
let keysUp: ((event: KeyboardEvent) => void) | null = null;
window.addEventListener('keydown', event => keysUp?.(event), true);

/** The arrivals' banner: the last 30 days' items, judged as each arrival comes. */
export function OverdueArrival() {
  const zone = timeZone();
  const {arrival, present} = useArrival();
  // The range follows the day of the latest arrival, so a tab left open overnight looks at the new one.
  const range = bannerRange(arrival?.at ?? serverNow(), zone);
  const {data} = useResource<ItemsOut>(itemsPath(range.from, range.to));
  return <OverdueArrivals arrival={arrival} present={present} items={data?.items} timeZone={zone} />;
}

/**
 * The banner for each arrival over `items`: judged once the user is there and the items are in, and
 * shown unless one is up already. An arrival with nothing to show is done with, so a task that goes
 * overdue later waits for the next one. It waits while Settings or ⌘K is open.
 */
export function OverdueArrivals({arrival, present, items, timeZone: zone}: {arrival: Arrival | null; present: boolean; items: readonly ItemOut[] | undefined; timeZone: string}) {
  const [judged, setJudged] = useState(0);
  const [shown, setShown] = useState<{tasks: Overdue[]; at: number; key: number} | null>(null);
  const settings = useSettingsPage();
  const palette = usePaletteOpen();
  if (arrival && arrival.count > judged && items && present) {
    setJudged(arrival.count);
    if (!shown) {
      const tasks = arrivalTasks(overdueTasks(items, arrival.at, zone), shownTasks(), zone);
      if (tasks.length) setShown({tasks, at: arrival.at, key: arrival.count});
    }
  }
  const gone = useCallback(() => setShown(null), []);
  if (!shown || settings !== null || palette) return null;
  return <OverdueBanner key={shown.key} overdue={shown.tasks} now={shown.at} timeZone={zone} onGone={gone} />;
}

const keep = (event: SyntheticEvent) => event.stopPropagation();

/** How long the banner takes to enter, taking no click or key meanwhile: the length of its fade-in. */
export const ENTRANCE_MS = motion.medium;

/**
 * The banner over `overdue`, less what this browser has shown. Nothing when that's all of them.
 * `onGone` hears when it has left, or that it had nothing to show.
 */
export function OverdueBanner({overdue, now, timeZone: zone, onGone}: {overdue: readonly Overdue[]; now: number; timeZone: string; onGone?: () => void}) {
  const [tasks] = useState(() => arrivalTasks(overdue, shownTasks(), zone));
  const [phase, setPhase] = useState<'entering' | 'in' | 'out' | 'gone'>(tasks.length ? 'entering' : 'gone');
  const ring = useRingColour();
  const banner = useRef<HTMLDivElement>(null);
  // Where focus was as it settled, given back once it's dismissed (a draft in the composer).
  const before = useRef<Element | null>(null);

  useEffect(() => {
    if (phase !== 'entering') return;
    const timer = window.setTimeout(() => setPhase('in'), ENTRANCE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  // Shown once it's dismissed, not when it appears, so a reload before then shows it again.
  const dismiss = useCallback(() => {
    if (phase !== 'in') return;
    markShown(tasks.map(task => shownKey(task.item)), now, zone);
    setPhase('out');
  }, [phase, tasks, now, zone]);

  useEffect(() => {
    if (phase !== 'in') return;
    before.current = document.activeElement;
    banner.current?.focus();
    keysUp = event => {
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
      } else if (!event.metaKey && !event.ctrlKey) {
        // A plain key does nothing (Tab, Space, Enter). The browser's own shortcuts still work.
        event.preventDefault();
      }
    };
    return () => {
      keysUp = null;
    };
  }, [phase, dismiss]);

  useEffect(() => {
    if (phase !== 'out') return;
    if (before.current instanceof HTMLElement && before.current.isConnected) before.current.focus();
    const timer = window.setTimeout(() => setPhase('gone'), motion.medium);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase === 'gone') onGone?.();
  }, [phase, onGone]);

  if (phase === 'gone') return null;
  const one = tasks.length === 1 ? tasks[0]!.item : null;
  const {listed: rows, more} = listed(tasks);
  return (
    <div ref={banner} className={`overdue ${phase}`} role="dialog" aria-modal="true" aria-label="Overdue tasks" tabIndex={-1} data-state={phase}
      onClick={event => {
        keep(event);
        dismiss();
      }}
      onPointerDown={keep} onMouseDown={keep} onPointerUp={keep} onMouseUp={keep} onDoubleClick={keep}
      onContextMenu={event => {
        keep(event);
        event.preventDefault();
      }}>
      <div className="overdue-veil" />
      <div className="overdue-place">
        <div className="overdue-stack">
          <div className="overdue-label"><span className="overdue-dot" />Overdue</div>
          {one ? (
            <div className="overdue-one">
              <div className="overdue-title">{one.title}</div>
              <div className="overdue-due">
                <span className="ring" style={ring(one.project)} />
                <span>{[one.project, dueLine(one, now, zone)].filter(Boolean).join(' · ')}</span>
              </div>
            </div>
          ) : (
            <div className="overdue-many">
              <div className="overdue-title">{tasks.length} tasks</div>
              <ul className="overdue-list">
                {rows.map(({item}) => (
                  <li key={item.key}>
                    <span className="ring" style={ring(item.project)} />
                    <span className="overdue-name">{item.title}</span>
                    <span className="overdue-when">{shortDue(item, now, zone)}</span>
                  </li>
                ))}
                {more > 0 && <li className="overdue-more">and {more} more</li>}
              </ul>
            </div>
          )}
        </div>
      </div>
      <div className="overdue-hint"><span>Click anywhere to dismiss</span><span className="kbd">Esc</span></div>
    </div>
  );
}
