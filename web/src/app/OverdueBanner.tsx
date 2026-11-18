// The overdue banner: on an arrival with Todoist tasks overdue, the page dims under its own colour
// and the task sits on it large, with no card or chrome. An arrival is a page load or the user
// coming back to the tab or the window (app/arrival.ts), never a page change inside the app, so a
// task going overdue mid-use raises nothing until the next one, and a banner due while they're away
// waits for their return. Every arrival shows every overdue task, until it's done. One task is its title over its ring, project and due ("Errands · Due today, 8:00
// AM"). Several are "3 tasks" over a list, the most recently due first, four and "and 3 more".
// It enters by Reveal: the veil and label fade in, the title slides up from behind its own
// baseline, then the due line (or the list) rises under it. Until the title is up it takes no
// click or key: they go to the page under it, as the click that brings the window back does. Then
// a press pushes the text in, the hint fades in late, and a click anywhere or Esc dismisses it for
// this visit, until the next arrival. It leaves by Return to its row: each title due today goes back to its Today line, which takes the
// landing tint, and the rest fades where it is (overdueExit.ts finds the lines, and the icon where
// they aren't on screen). While it's up no other key acts, on it or the page under it, and its
// click reaches nothing else. It sits over every page and the composer, under the toast. It waits
// while Settings or ⌘K is open, and isn't drawn below 640 px (App.tsx). Timings are tokens.ts's
// `overdue`.
import type {ItemOut, ItemsOut} from '@setpoint/shared';
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {SyntheticEvent} from 'react';
import {serverNow, timeZone} from '../api/auth.ts';
import {useResource} from '../api/client.ts';
import {itemsPath} from '../api/items.ts';
import {overdueTasks} from '../logic/overdue.ts';
import type {Overdue} from '../logic/overdue.ts';
import {arrivalTasks, bannerRange, dueLine, exitLength, exitSplit, listed, shortDue} from '../logic/overdueBanner.ts';
import {motion, overdue as timing} from '../tokens.ts';
import {OverdueGlyph} from '../ui/Icon.tsx';
import {useRingColour} from './calendar/Chip.tsx';
import {useArrival} from './arrival.ts';
import {planExit} from './overdueExit.ts';
import type {ExitPlan} from './overdueExit.ts';
import type {Arrival} from './arrival.ts';
import {usePaletteOpen} from './palette/Palette.tsx';
import {useSettingsPage} from './settings/store.ts';
import './overdue.css';

// While the banner is up, every key comes here first. It's listened for from the start, ahead of
// every page's own listeners, so none of them sees a key before the banner has kept it.
let keysUp: ((event: KeyboardEvent) => void) | null = null;
window.addEventListener('keydown', event => keysUp?.(event), true);

// The record an earlier banner kept of the tasks it had shown, so as not to show them again. Nothing
// reads it now; it's removed from this browser.
function forgetShown() {
  try {
    localStorage.removeItem('setpoint.overdueShown');
  } catch {
    // Storage refused: there's nothing kept to remove.
  }
}

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
 * overdue later waits for the next one, as does one dismissed. It waits while Settings or ⌘K is open.
 */
export function OverdueArrivals({arrival, present, items, timeZone: zone}: {arrival: Arrival | null; present: boolean; items: readonly ItemOut[] | undefined; timeZone: string}) {
  const [judged, setJudged] = useState(0);
  const [shown, setShown] = useState<{tasks: Overdue[]; at: number; key: number} | null>(null);
  const settings = useSettingsPage();
  const palette = usePaletteOpen();
  useEffect(forgetShown, []);
  if (arrival && arrival.count > judged && items && present) {
    setJudged(arrival.count);
    if (!shown) {
      const tasks = arrivalTasks(overdueTasks(items, arrival.at, zone), zone);
      if (tasks.length) setShown({tasks, at: arrival.at, key: arrival.count});
    }
  }
  const gone = useCallback(() => setShown(null), []);
  if (!shown || settings !== null || palette) return null;
  return <OverdueBanner key={shown.key} overdue={shown.tasks} now={shown.at} timeZone={zone} onGone={gone} />;
}

const keep = (event: SyntheticEvent) => event.stopPropagation();

/** How long the banner takes to enter, taking no click or key meanwhile: the Reveal's title. */
export const ENTRANCE_MS = timing.titleDelay + timing.title;

// A colour mix of the theme's `caution`, read where it's drawn so WAAPI keyframes get a value.
const cautionMix = (element: Element, percent: number) => `color-mix(in oklch, ${getComputedStyle(element).getPropertyValue('--caution').trim()} ${percent}%, transparent)`;

/** Plays the way out: the titles fly, each line lands, and the icon comes and goes. */
function playExit(banner: HTMLElement, plan: ExitPlan) {
  const ease = {easing: motion.ease};
  const toIcon = plan.icon !== null;
  const hold = (toIcon ? timing.iconHoldPct : timing.flyHoldPct) / 100;
  plan.flights.forEach((flight, index) => {
    const title = banner.querySelector<HTMLElement>(`[data-key="${CSS.escape(flight.key)}"]`);
    const delay = index * timing.flyStagger;
    // As a CSS animation's keyframes: the easing runs per stretch, so opacity holds, then fades.
    title?.animate([
      {offset: 0, transform: 'none', opacity: 1, easing: timing.flyEase},
      {offset: hold, opacity: 1, easing: timing.flyEase},
      {offset: 1, transform: `translate(${flight.x}px, ${flight.y}px) scale(${flight.scale})`, opacity: 0},
    ], {duration: timing.fly, delay, fill: 'both'});
    if (toIcon) return;
    // Its line takes the landing tint as it arrives, fading to none (a lone keyframe at 0, as CSS's
    // `from`). The animation is the line's, so it outlives the banner.
    const line = document.querySelector(`.sb .today-row[data-key="${CSS.escape(flight.key)}"]`);
    line?.animate([{offset: 0, background: cautionMix(line, timing.landTintPct), ...ease}], {duration: timing.land, delay: delay + timing.fly});
  });
  const icon = banner.querySelector<HTMLElement>('.overdue-icon');
  if (!icon || !plan.flights.length) return;
  icon.animate([{opacity: 0, transform: `scale(${timing.iconFrom})`, ...ease}, {opacity: 1, transform: 'none'}], {duration: timing.iconIn, fill: 'forwards'});
  const tile = (percent: number) => cautionMix(icon, percent);
  const arrived = (plan.flights.length - 1) * timing.flyStagger + timing.fly;
  icon.animate([
    {offset: 0, opacity: 1, background: tile(timing.iconTintPct), ...ease},
    {offset: timing.iconSettleAt / 100, opacity: 1, background: tile(timing.iconSettlePct), ...ease},
    {offset: timing.iconHoldAt / 100, opacity: 1, background: tile(timing.iconSettlePct), ...ease},
    {offset: 1, opacity: 0, background: tile(0)},
  ], {duration: timing.iconLand, delay: arrived, fill: 'forwards'});
}

/**
 * The banner over `overdue`, the most recently due first. Nothing when there are none. `onGone`
 * hears when it has left, or that it had nothing to show.
 */
export function OverdueBanner({overdue, now, timeZone: zone, onGone}: {overdue: readonly Overdue[]; now: number; timeZone: string; onGone?: () => void}) {
  const [tasks] = useState(() => arrivalTasks(overdue, zone));
  const [phase, setPhase] = useState<'entering' | 'in' | 'out' | 'gone'>(tasks.length ? 'entering' : 'gone');
  // The dismiss hint comes late, so a quick click never sees it.
  const [hinted, setHinted] = useState(false);
  // The way out, measured at the click.
  const [exit, setExit] = useState<ExitPlan | null>(null);
  const ring = useRingColour();
  const banner = useRef<HTMLDivElement>(null);
  // Where focus was as it settled, given back once it's dismissed (a draft in the composer).
  const before = useRef<Element | null>(null);

  useEffect(() => {
    if (phase !== 'entering') return;
    const timer = window.setTimeout(() => setPhase('in'), ENTRANCE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (!tasks.length) return;
    const timer = window.setTimeout(() => setHinted(true), timing.hintDelay);
    return () => window.clearTimeout(timer);
  }, [tasks]);

  // The way out is measured now, from layout, and nothing waits on it.
  const dismiss = useCallback(() => {
    if (phase !== 'in') return;
    setExit(banner.current ? planExit(banner.current, exitSplit(tasks).returning.map(task => task.item.key)) : {flights: [], icon: null});
    setPhase('out');
  }, [phase, tasks]);

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

  // Played once its exit marks and the icon are drawn.
  useLayoutEffect(() => {
    if (phase === 'out' && exit && banner.current) playExit(banner.current, exit);
  }, [phase, exit]);

  useEffect(() => {
    if (phase !== 'out') return;
    if (before.current instanceof HTMLElement && before.current.isConnected) before.current.focus();
    const timer = window.setTimeout(() => setPhase('gone'), exitLength(exit?.flights.length ?? 0, Boolean(exit?.icon)));
    return () => window.clearTimeout(timer);
  }, [phase, exit]);

  useEffect(() => {
    if (phase === 'gone') onGone?.();
  }, [phase, onGone]);

  if (phase === 'gone') return null;
  const one = tasks.length === 1 ? tasks[0]!.item : null;
  const {listed: rows, more} = listed(tasks);
  // On the way out each drawn title says whether it returns or fades.
  const flying = new Set(exit?.flights.map(flight => flight.key));
  const exitOf = (key: string) => (exit ? (flying.has(key) ? 'return' : 'fade') : undefined);
  const icon = exit?.icon;
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
      {icon && (
        <div className="overdue-icon" style={{left: icon.left, top: icon.top, width: icon.width, height: icon.height}}>
          <OverdueGlyph />
        </div>
      )}
      <div className="overdue-veil" />
      <div className="overdue-place">
        <div className="overdue-stack">
          <div className="overdue-label"><span className="overdue-dot" />Overdue</div>
          {one ? (
            <div className="overdue-one">
              <div className="overdue-mask">
                <div className="overdue-title" data-key={one.key} data-exit={exitOf(one.key)}>{one.title}</div>
              </div>
              <div className="overdue-due">
                <span className="ring" style={ring(one.project)} />
                <span>{[one.project, dueLine(one, now, zone)].filter(Boolean).join(' · ')}</span>
              </div>
            </div>
          ) : (
            <div className="overdue-many">
              <div className="overdue-mask">
                <div className="overdue-title">{tasks.length} tasks</div>
              </div>
              <ul className="overdue-list">
                {rows.map(({item}) => (
                  <li key={item.key}>
                    <span className="ring" style={ring(item.project)} />
                    <span className="overdue-name"><span className="overdue-fly" data-key={item.key} data-exit={exitOf(item.key)}>{item.title}</span></span>
                    <span className="overdue-when">{shortDue(item, now, zone)}</span>
                  </li>
                ))}
                {more > 0 && <li className="overdue-more">and {more} more</li>}
              </ul>
            </div>
          )}
        </div>
      </div>
      {hinted && <div className="overdue-hint"><span>Click anywhere to dismiss</span><span className="kbd">Esc</span></div>}
    </div>
  );
}
